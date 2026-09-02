/**
 * The program that guards a browser sandbox's one public port (ADR 0076).
 *
 * ## Why a guard exists at all
 *
 * A sandbox exposes a port to the public internet. Chromium's DevTools
 * endpoint has no authentication of any kind and never will — the protocol
 * assumes it is reachable only from the same machine. Exposing it directly
 * would hand full control of the browser, including `file://` reads of the
 * VM, to anyone who learned the URL. So Chromium listens on loopback only, and
 * this program is the single thing the outside can reach.
 *
 * ## Why it is a string constant rather than a file
 *
 * The same reason `coding-agent/sandbox-runtime/program.ts` is: it has to
 * arrive in a microVM created seconds earlier, and what it contains is a
 * security property. As a constant it is reviewed here, versioned with
 * `BROWSER_RUNTIME_VERSION`, and asserted against by tests — none of which is
 * true of a script fetched at run time or assembled from parts.
 *
 * ## It contains no interpolation, deliberately
 *
 * Not one `${`, not one backtick. Both tokens, both ports and the viewport
 * arrive in the process environment and are read inside the sandbox. There is
 * therefore no point at which a token, a URL or anything a user typed could
 * become program text. A test asserts the absence rather than trusting the
 * reading.
 *
 * ## The two channels, and why the vocabulary differs between them
 *
 * `/control` is a byte pipe to CDP. Vibe's own server holds that token and
 * uses it for the read-only analysis, so the existing analyzer and its
 * read-only policy stay exactly where they are, unchanged and still tested as
 * a unit.
 *
 * `/view` is **not** a pipe. It speaks a closed four-message vocabulary —
 * frames out; mouse, key and wheel in — and translates each into one CDP
 * `Input.dispatch*` call. That is the whole reason it is written out longhand
 * instead of proxied: the token for this channel is the one that travels to a
 * browser, and a proxy would make it a CDP token. Under this design the worst
 * a leaked view token can do is click and type in a browser that is already
 * showing the owner's session — the same exposure as the live view it
 * replaces, and strictly less than that one, which was a full DevTools
 * frontend with an address bar.
 *
 * An unrecognised message is dropped in silence. There is no error reply,
 * because a reply that distinguishes "unknown verb" from "bad argument" is an
 * oracle, and this channel has nothing to tell its caller.
 */

/** Bumped whenever the guard's behaviour changes in a way a stored session could notice. */
export const BROWSER_RUNTIME_VERSION = "browser-runtime-v1";

/** Environment names the guard reads. Mirrored by the provider, asserted by tests. */
export const BROWSER_GUARD_ENV = {
  controlToken: "VIBE_CONTROL_TOKEN",
  viewToken: "VIBE_VIEW_TOKEN",
  publicPort: "VIBE_PUBLIC_PORT",
  devtoolsPort: "VIBE_DEVTOOLS_PORT",
  /**
   * Where the guard records that it is listening *and* that Chromium answered.
   *
   * Vibe reads this file back rather than probing the public port, because
   * probing would mean spending the control token to ask a question — and a
   * capability used as a health check is a capability in one more place. The
   * file says the one thing the caller needs: this session can be used now.
   */
  readyFile: "VIBE_READY_FILE",
} as const;

export const BROWSER_GUARD_PROGRAM = `
import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";

const controlToken = process.env.VIBE_CONTROL_TOKEN;
const viewToken = process.env.VIBE_VIEW_TOKEN;
const publicPort = Number(process.env.VIBE_PUBLIC_PORT);
const devtoolsPort = Number(process.env.VIBE_DEVTOOLS_PORT);
const readyFile = process.env.VIBE_READY_FILE;

if (!controlToken || !viewToken || !publicPort || !devtoolsPort || !readyFile) {
  console.error("guard: incomplete environment");
  process.exit(1);
}

/**
 * Constant time, and it refuses a length mismatch rather than throwing on one.
 * The same rule as tokens.ts on the Vibe side; a second implementation that
 * answered early on the first differing byte would be the whole vulnerability.
 */
function matches(presented, expected) {
  if (typeof presented !== "string" || presented.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(presented), Buffer.from(expected));
}

/** Asks Chromium, on loopback, where its own sockets are. */
async function devtools(path) {
  const response = await fetch("http://127.0.0.1:" + devtoolsPort + path);
  if (!response.ok) throw new Error("devtools " + path + " answered " + response.status);
  return await response.json();
}

async function browserSocketUrl() {
  const version = await devtools("/json/version");
  return version.webSocketDebuggerUrl;
}

/**
 * The first page target.
 *
 * Chromium is launched with exactly one, and the guard never opens another —
 * so "first" is "the one", and a second appearing means something navigated in
 * a way this program does not model.
 */
async function pageSocketUrl() {
  const targets = await devtools("/json/list");
  const page = targets.find((target) => target.type === "page");
  if (!page) throw new Error("no page target");
  return page.webSocketDebuggerUrl;
}

const server = createServer((request, response) => {
  // Nothing is served over plain HTTP. Not a health check, not a status page:
  // every byte this port can produce is behind one of the two tokens.
  response.writeHead(404).end();
});

const control = new WebSocketServer({ noServer: true });
const view = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  let url;
  try {
    url = new URL(request.url, "http://127.0.0.1");
  } catch {
    socket.destroy();
    return;
  }
  const token = url.searchParams.get("token");

  if (url.pathname === "/control" && matches(token, controlToken)) {
    control.handleUpgrade(request, socket, head, (client) => control.emit("connection", client));
    return;
  }
  if (url.pathname === "/view" && matches(token, viewToken)) {
    view.handleUpgrade(request, socket, head, (client) => view.emit("connection", client));
    return;
  }
  // One answer for a wrong path, a wrong token, and a missing one. A caller
  // learns only that it did not get in.
  socket.destroy();
});

/* -------------------------------------------------------------------------
 * /control — a byte pipe to CDP
 * ---------------------------------------------------------------------- */

control.on("connection", async (client) => {
  let upstream;
  try {
    upstream = new WebSocket(await browserSocketUrl(), { perMessageDeflate: false });
  } catch {
    client.close();
    return;
  }

  const queued = [];
  let open = false;
  upstream.on("open", () => {
    open = true;
    for (const message of queued) upstream.send(message);
    queued.length = 0;
  });
  client.on("message", (data) => {
    if (open) upstream.send(data);
    else queued.push(data);
  });
  upstream.on("message", (data) => {
    if (client.readyState === WebSocket.OPEN) client.send(data);
  });

  const close = () => {
    if (client.readyState === WebSocket.OPEN) client.close();
    if (upstream.readyState === WebSocket.OPEN) upstream.close();
  };
  client.on("close", close);
  client.on("error", close);
  upstream.on("close", close);
  upstream.on("error", close);
});

/* -------------------------------------------------------------------------
 * /view — frames out, a closed set of input events in
 * ---------------------------------------------------------------------- */

/**
 * The only CDP methods this channel can ever produce.
 *
 * Written as a list rather than assembled from the incoming message, because a
 * method name built from input is a method name an input can choose.
 */
const MOUSE_TYPES = new Set(["mousePressed", "mouseReleased", "mouseMoved"]);
const KEY_TYPES = new Set(["keyDown", "keyUp", "char"]);
const BUTTONS = new Set(["none", "left", "middle", "right"]);

view.on("connection", async (client) => {
  let page;
  try {
    page = new WebSocket(await pageSocketUrl(), { perMessageDeflate: false });
  } catch {
    client.close();
    return;
  }

  let nextId = 1;
  const send = (method, params) => {
    if (page.readyState !== WebSocket.OPEN) return;
    nextId += 1;
    page.send(JSON.stringify({ id: nextId, method, params }));
  };

  page.on("open", () => {
    send("Page.enable", {});
    send("Page.startScreencast", {
      format: "jpeg",
      quality: 60,
      maxWidth: 1280,
      maxHeight: 800,
      everyNthFrame: 1,
    });
  });

  page.on("message", (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (message.method !== "Page.screencastFrame") return;

    // Acked immediately and unconditionally: Chromium sends no further frame
    // until the previous one is acknowledged, so a missed ack is a frozen
    // picture rather than a dropped one.
    send("Page.screencastFrameAck", { sessionId: message.params.sessionId });
    if (client.readyState !== WebSocket.OPEN) return;
    client.send(
      JSON.stringify({
        t: "frame",
        data: message.params.data,
        w: message.params.metadata.deviceWidth,
        h: message.params.metadata.deviceHeight,
      }),
    );
  });

  client.on("message", (raw) => {
    let event;
    try {
      event = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!event || typeof event !== "object") return;

    if (event.t === "mouse" && MOUSE_TYPES.has(event.type)) {
      send("Input.dispatchMouseEvent", {
        type: event.type,
        x: Number(event.x) || 0,
        y: Number(event.y) || 0,
        button: BUTTONS.has(event.button) ? event.button : "none",
        clickCount: Math.min(Number(event.clickCount) || 0, 3),
        modifiers: Math.min(Number(event.modifiers) || 0, 15),
      });
      return;
    }

    if (event.t === "key" && KEY_TYPES.has(event.type)) {
      send("Input.dispatchKeyEvent", {
        type: event.type,
        key: typeof event.key === "string" ? event.key.slice(0, 32) : undefined,
        code: typeof event.code === "string" ? event.code.slice(0, 32) : undefined,
        text: typeof event.text === "string" ? event.text.slice(0, 8) : undefined,
        windowsVirtualKeyCode: Number(event.keyCode) || 0,
        modifiers: Math.min(Number(event.modifiers) || 0, 15),
      });
      return;
    }

    if (event.t === "wheel") {
      send("Input.dispatchMouseEvent", {
        type: "mouseWheel",
        x: Number(event.x) || 0,
        y: Number(event.y) || 0,
        deltaX: Number(event.dx) || 0,
        deltaY: Number(event.dy) || 0,
      });
    }

    // Anything else: dropped, in silence. No reply distinguishes an unknown
    // verb from a rejected argument.
  });

  const close = () => {
    if (client.readyState === WebSocket.OPEN) client.close();
    if (page.readyState === WebSocket.OPEN) page.close();
  };
  client.on("close", close);
  client.on("error", close);
  page.on("close", close);
  page.on("error", close);
});

/**
 * Chromium is a separate process started at the same moment as this one, so
 * "listening" is not "usable". The file is written only once DevTools has
 * answered, which is what makes it the single readiness signal rather than a
 * hint the caller has to confirm.
 *
 * A ceiling rather than an unbounded wait: a browser that never comes up must
 * fail the session, not hold it open until the sandbox's own timeout.
 */
async function waitForChromium(deadlineMs) {
  const until = Date.now() + deadlineMs;
  while (Date.now() < until) {
    try {
      await devtools("/json/version");
      return true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  return false;
}

server.listen(publicPort, "0.0.0.0", async () => {
  if (!(await waitForChromium(30000))) {
    console.error("guard: chromium did not answer");
    process.exit(1);
  }
  // The content is deliberately not a token, a URL or a port. Vibe already
  // knows all three; what it cannot know from outside is whether this VM is
  // ready, and that is the whole message.
  writeFileSync(readyFile, "ready");
  console.log("guard listening");
});
`;

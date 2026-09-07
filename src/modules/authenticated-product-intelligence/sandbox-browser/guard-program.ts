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
 *
 * ## Why the control pipe passes the frame type along
 *
 * A byte pipe that forwards what it was handed is not a byte pipe if it
 * changes how the bytes are framed. `ws` hands a message to its listener as a
 * Buffer whatever the frame was, and `send(buffer)` writes a **binary** frame —
 * so every CDP message Vibe forwarded arrived at Chromium as binary, where the
 * protocol is text.
 *
 * Chromium closed the connection, and Playwright reported the only thing it
 * could see:
 *
 * ```
 * browserType.connectOverCDP: Target page, context or browser has been closed
 *   <ws connected>    wss://…/control
 *   <ws disconnected> code=1005
 * ```
 *
 * Measured against `ws@8.18.0` rather than reasoned about: `send(buffer)`
 * arrives BINARY, `send(buffer, { binary: false })` arrives TEXT. The listener
 * is given an `isBinary` flag for exactly this, so the pipe forwards it and the
 * framing survives the hop in both directions.
 *
 * ## One note about the `ws` import, which belongs here rather than in the
 * program
 *
 * **Named imports, and the reasoning that said otherwise was backwards.**
 *
 * This file used to take the default and destructure it, arguing that `ws`
 * exports the WebSocket class as its module object with the server constructor
 * attached, so a named import would depend on CJS interop detecting a shape it
 * might not detect. Every clause of that was about the CommonJS entry point,
 * and Node never reaches it: `ws` ships an `exports` map with an ESM wrapper,
 * and the wrapper's default is the WebSocket class **alone**.
 *
 * So the destructure produced `undefined`, and the guard died on its first
 * statement with `TypeError: WebSocketServer is not a constructor` — before any
 * line of its own code ran, which is why it recorded no failure and why nine
 * clicks were needed to see it.
 *
 * Measured against `ws@8.18.0` rather than argued about a second time:
 *
 * ```
 * import WebSocket from "ws"   → typeof function, .WebSocketServer undefined
 * import * as ns from "ws"     → Receiver, Sender, WebSocket,
 *                                WebSocketServer, createWebSocketStream
 * ```
 *
 * The explanation is out here because a backtick inside the program would end
 * it — which is what happened when this was written as a comment in there, and
 * what the no-backtick test exists to catch.
 */

/** Bumped whenever the guard's behaviour changes in a way a stored session could notice. */
export const BROWSER_RUNTIME_VERSION = "browser-runtime-v5";

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
  /**
   * Where the guard records why it gave up, when it does.
   *
   * The ready file answers "can this session be used"; nothing answered "and
   * if not, which half failed". A 45-second timeout with no other signal is
   * the same dead end `diagnostics.ts` was written to remove one layer up:
   * Chromium missing a shared library and the guard's own `ws` import failing
   * are different problems, and from outside the VM they looked identical.
   *
   * Written by the guard rather than logged, because `runBackground` detaches
   * and nothing reads a detached process's output. A file, Vibe already knows
   * how to read.
   */
  failureFile: "VIBE_FAILURE_FILE",
} as const;

export const BROWSER_GUARD_PROGRAM = `
import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";

const controlToken = process.env.VIBE_CONTROL_TOKEN;
const viewToken = process.env.VIBE_VIEW_TOKEN;
const publicPort = Number(process.env.VIBE_PUBLIC_PORT);
const devtoolsPort = Number(process.env.VIBE_DEVTOOLS_PORT);
const readyFile = process.env.VIBE_READY_FILE;
const failureFile = process.env.VIBE_FAILURE_FILE;

function giveUp(reason) {
  console.error("guard: " + reason);
  try {
    if (failureFile) writeFileSync(failureFile, reason);
  } catch {}
  process.exit(1);
}

if (!controlToken || !viewToken || !publicPort || !devtoolsPort || !readyFile) {
  giveUp("incomplete environment");
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
    for (const message of queued) upstream.send(message[0], { binary: message[1] });
    queued.length = 0;
  });
  client.on("message", (data, isBinary) => {
    if (open) upstream.send(data, { binary: isBinary });
    else queued.push([data, isBinary]);
  });
  upstream.on("message", (data, isBinary) => {
    if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary });
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
    giveUp("chromium did not answer on the devtools port within 30s");
  }
  // The content is deliberately not a token, a URL or a port. Vibe already
  // knows all three; what it cannot know from outside is whether this VM is
  // ready, and that is the whole message.
  writeFileSync(readyFile, "ready");
  console.log("guard listening");
});
`;

import { describe, expect, it } from "vitest";
import { BROWSER_GUARD_ENV, BROWSER_GUARD_PROGRAM, BROWSER_RUNTIME_VERSION } from "./guard-program";
import { BROWSER_SANDBOX } from "./runtime";

/**
 * The guard, asserted rather than executed.
 *
 * It cannot run here — it needs Chromium, a listening DevTools port and two
 * WebSocket peers — so what is testable is its shape. Every assertion below is
 * a property that, if it silently changed, would not fail anything else in this
 * repository until a customer's browser had already been handed to somebody.
 */

const viewSection = () =>
  BROWSER_GUARD_PROGRAM.slice(BROWSER_GUARD_PROGRAM.indexOf('view.on("connection"'));

describe("the program contains no interpolation point", () => {
  it("has no template substitution and no backtick", () => {
    // Both tokens pass through this program. If either could reach program
    // text, the value guarding the port would be written by whatever produced
    // it rather than by this file.
    expect(BROWSER_GUARD_PROGRAM).not.toContain("${");
    expect(BROWSER_GUARD_PROGRAM).not.toContain("`");
  });

  it("carries no control character an eaten escape would have left behind", () => {
    // A backslash sequence written once instead of twice does not fail to
    // compile; the template literal turns it into the character it names, and
    // every other assertion here is about substrings that would not notice.
    const control = BROWSER_GUARD_PROGRAM.match(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/);
    expect(control).toBeNull();
  });

  it("reads every value it needs from the environment", () => {
    for (const name of Object.values(BROWSER_GUARD_ENV)) {
      expect(BROWSER_GUARD_PROGRAM).toContain("process.env." + name);
    }
  });

  it("refuses to start on an incomplete environment", () => {
    // Starting without a token would listen on a public port with nothing
    // behind it, which is the one failure that must not degrade to running.
    expect(BROWSER_GUARD_PROGRAM).toContain("process.exit(1)");
  });
});

describe("nothing reaches either channel without its own token", () => {
  it("compares tokens in constant time and refuses a length mismatch", () => {
    expect(BROWSER_GUARD_PROGRAM).toContain("timingSafeEqual");
    expect(BROWSER_GUARD_PROGRAM).toContain("presented.length !== expected.length");
  });

  it("gates each path on its own token", () => {
    expect(BROWSER_GUARD_PROGRAM).toContain(
      'url.pathname === "/control" && matches(token, controlToken)',
    );
    expect(BROWSER_GUARD_PROGRAM).toContain('url.pathname === "/view" && matches(token, viewToken)');
  });

  it("answers a wrong path, a wrong token and a missing one identically", () => {
    // One `socket.destroy()` per outcome that is not an accepted upgrade,
    // rather than a branch per reason. A distinguishable refusal is an oracle
    // for which half was wrong.
    const upgrade = BROWSER_GUARD_PROGRAM.slice(BROWSER_GUARD_PROGRAM.indexOf('server.on("upgrade"'));
    const guardBlock = upgrade.slice(0, upgrade.indexOf("/* ---"));
    expect(guardBlock.match(/socket\.destroy\(\)/g)).toHaveLength(2);
    expect(guardBlock).not.toContain("401");
    expect(guardBlock).not.toContain("403");
  });

  it("serves nothing at all over plain HTTP", () => {
    // Not a health check, not a status page. Every byte this port produces is
    // behind one of the two tokens.
    expect(BROWSER_GUARD_PROGRAM).toContain("response.writeHead(404).end()");
  });
});

describe("the view channel cannot speak CDP", () => {
  /**
   * The property the whole two-token design exists for.
   *
   * The view token travels to a browser — it is the one that is *meant* to
   * leave the server. If the view channel forwarded its client's bytes the way
   * `/control` does, that token would be a CDP token, and its holder could
   * navigate to `file://` and read the VM.
   */
  it("never forwards a view client's bytes to the page socket", () => {
    // `page.send` is reached only through `send(method, params)`, whose method
    // argument is a literal in this file.
    expect(viewSection()).not.toContain("page.send(data)");
    expect(viewSection()).not.toContain("page.send(raw)");
    expect(viewSection()).not.toContain("page.send(event");
  });

  it("produces only the five CDP methods it names", () => {
    const methods = [...viewSection().matchAll(/send\("([A-Za-z.]+)"/g)].map((match) => match[1]);

    expect(new Set(methods)).toEqual(
      new Set([
        "Page.enable",
        "Page.startScreencast",
        "Page.screencastFrameAck",
        "Input.dispatchMouseEvent",
        "Input.dispatchKeyEvent",
      ]),
    );
  });

  it("builds no method name from an incoming message", () => {
    // A method name assembled from input is a method name an input can choose.
    expect(viewSection()).not.toMatch(/send\(\s*event\./);
    expect(viewSection()).not.toMatch(/method:\s*event\./);
  });

  it("drops an unrecognised message without replying", () => {
    const inbound = viewSection().slice(viewSection().indexOf('client.on("message"'));
    const bounded = inbound.slice(0, inbound.indexOf("const close ="));

    // No `client.send` on the inbound path at all: a reply that distinguishes
    // "unknown verb" from "bad argument" tells a caller how to try again.
    expect(bounded).not.toContain("client.send");
  });

  it("bounds every value it copies out of a message", () => {
    // Strings are truncated and numbers coerced with a ceiling, so a hostile
    // view client cannot make CDP hold an unbounded value on its behalf.
    expect(viewSection()).toContain("event.key.slice(0, 32)");
    expect(viewSection()).toContain("event.text.slice(0, 8)");
    expect(viewSection()).toContain("Math.min(Number(event.clickCount) || 0, 3)");
  });
});

describe("Chromium is never itself exposed", () => {
  it("reaches DevTools only over loopback", () => {
    expect(BROWSER_GUARD_PROGRAM).toContain('"http://127.0.0.1:"');
    // The public listener is the guard's own, and it is the only one.
    expect(BROWSER_GUARD_PROGRAM).toContain('server.listen(publicPort, "0.0.0.0"');
    expect(BROWSER_GUARD_PROGRAM.match(/\.listen\(/g)).toHaveLength(1);
  });
});

describe("the runtime is versioned", () => {
  it("names a version a stored session could be compared against", () => {
    expect(BROWSER_RUNTIME_VERSION).toMatch(/^browser-runtime-v\d+$/);
  });
});

/**
 * The import that killed the guard on its first statement.
 *
 * `import WebSocket from "ws"` followed by `const { WebSocketServer } =
 * WebSocket` produced `undefined`, and `new undefined(...)` threw before any
 * line of the guard's own code ran — which is why it wrote no failure file, and
 * why the readiness timeout said nothing for two rounds.
 *
 * The reasoning behind it was about the CommonJS entry point, which Node never
 * reaches: `ws` ships an `exports` map with an ESM wrapper whose default is the
 * WebSocket class alone. Measured against `ws@8.18.0`:
 *
 *     import WebSocket from "ws"   → typeof function, .WebSocketServer undefined
 *     import * as ns from "ws"     → WebSocketServer is a function
 *
 * A source assertion rather than a runtime one, because `ws` is not a
 * dependency of this repository — it is installed into the sandbox image. What
 * can be pinned here is the form, and the form is what was wrong.
 */
describe("the guard imports ws the way the package actually exports it", () => {
  it("takes both bindings by name", () => {
    expect(BROWSER_GUARD_PROGRAM).toContain('import { WebSocket, WebSocketServer } from "ws"');
  });

  it("never destructures the default export", () => {
    // The exact shape that failed. `ws`'s ESM default is the class alone, so
    // anything pulled off it is undefined and fails at its first use.
    expect(BROWSER_GUARD_PROGRAM).not.toMatch(/=\s*WebSocket;/);
    expect(BROWSER_GUARD_PROGRAM).not.toMatch(/import\s+WebSocket\s+from\s+"ws"/);
  });

  it("still uses both, so neither import is decoration", () => {
    // `WebSocketServer` for the two channels, `WebSocket` for the upstream
    // connections and its `OPEN` constant.
    expect(BROWSER_GUARD_PROGRAM).toContain("new WebSocketServer(");
    expect(BROWSER_GUARD_PROGRAM).toContain("WebSocket.OPEN");
  });
});

/**
 * The pipe that changed the bytes it was piping.
 *
 * `ws` hands every message to its listener as a Buffer whatever the frame was,
 * and `send(buffer)` writes a **binary** frame. So each CDP message reached
 * Chromium as binary, where the protocol is text, and Chromium closed the
 * connection — which Playwright could only report as
 * `Target page, context or browser has been closed`, `code=1005`.
 *
 * Measured against `ws@8.18.0`: `send(buffer)` arrives BINARY,
 * `send(buffer, { binary: false })` arrives TEXT. The listener is handed an
 * `isBinary` flag for exactly this.
 */
describe("the control channel forwards frames without changing what they are", () => {
  it("passes the frame type in both directions", () => {
    const sends = [...BROWSER_GUARD_PROGRAM.matchAll(/\.send\((data|message\[0\]), \{ binary: [^}]+\}\)/g)];

    // Client to upstream, upstream to client, and the queue replay.
    expect(sends.length).toBeGreaterThanOrEqual(3);
  });

  it("never forwards a message without saying how to frame it", () => {
    // A bare `send(data)` on the pipe is the defect, in the exact shape it had.
    expect(BROWSER_GUARD_PROGRAM).not.toMatch(/\.send\(data\)/);
    expect(BROWSER_GUARD_PROGRAM).not.toMatch(/\.send\(message\)/);
  });

  it("reads the flag the pipe needs off both listeners", () => {
    expect(BROWSER_GUARD_PROGRAM).toContain('client.on("message", (data, isBinary)');
    expect(BROWSER_GUARD_PROGRAM).toContain('upstream.on("message", (data, isBinary)');
  });
});

/**
 * The ack is flow control, not a formality.
 *
 * Chromium sends no further frame until the previous one is acknowledged,
 * which is how a screencast paces itself to whatever is consuming it. The
 * guard acked on arrival, before the frame had gone anywhere, so Chromium
 * produced at full speed regardless of whether a phone could receive it — a
 * page under heavy repaint built a backlog and went smooth again only once it
 * stopped repainting, which is exactly what was reported.
 */
describe("the screencast paces itself to the viewer", () => {
  it("acknowledges a frame only after it has been sent on", () => {
    // The order is the whole fix: send to the client, then ack.
    const sent = BROWSER_GUARD_PROGRAM.indexOf("client.send(");
    const ack = BROWSER_GUARD_PROGRAM.indexOf("ackWhenSent(message.params.sessionId)");

    expect(sent).toBeGreaterThan(0);
    expect(ack).toBeGreaterThan(sent);
  });

  it("never withholds an acknowledgement indefinitely", () => {
    // The original concern, and it is right: a missed ack is a frozen picture
    // rather than a dropped one. A late frame is a cost; a stalled stream is a
    // broken product.
    expect(BROWSER_GUARD_PROGRAM).toContain("ACK_DEADLINE_MS");
    expect(BROWSER_GUARD_PROGRAM).toContain("clearInterval(poll)");
  });

  it("still acknowledges when nobody is listening", () => {
    // A closed viewer must not leave the stream waiting on a socket that will
    // never drain.
    expect(BROWSER_GUARD_PROGRAM).toContain(
      'if (client.readyState !== WebSocket.OPEN) {\n      send("Page.screencastFrameAck"',
    );
  });

  it("measures the backlog rather than guessing at it", () => {
    expect(BROWSER_GUARD_PROGRAM).toContain("client.bufferedAmount");
  });
});

/*
 * `runtime.ts` says the viewport is "matched to the screencast ceiling in the
 * guard rather than chosen twice". Nothing enforced that — the guard holds the
 * ceiling as literals, because the program contains no interpolation and that
 * absence is a security property, so the two numbers could drift apart in
 * silence. A comment is not a constraint; this is.
 *
 * Drift is not cosmetic. A cast smaller than the window is scaled down, and
 * the canvas maps a click through the frame's coordinate space — so the click
 * lands somewhere other than where the person aimed, on their own signed-in
 * product, with no error anywhere.
 */
describe("the screencast ceiling matches the window Chromium is given", () => {
  const capture = () => {
    const start = BROWSER_GUARD_PROGRAM.indexOf('send("Page.startScreencast"');
    expect(start, "the guard must still start a screencast").toBeGreaterThan(-1);
    return BROWSER_GUARD_PROGRAM.slice(start, start + 300);
  };

  it("casts at exactly the viewport's width and height", () => {
    expect(capture()).toContain(`maxWidth: ${BROWSER_SANDBOX.viewport.width}`);
    expect(capture()).toContain(`maxHeight: ${BROWSER_SANDBOX.viewport.height}`);
  });

  it("keeps the viewport at the 16:10 the dialog was built around", () => {
    // The dialog now sizes its box from the frame itself, so a different ratio
    // would no longer distort — but a ratio nobody chose is still a ratio
    // nobody chose.
    const { width, height } = BROWSER_SANDBOX.viewport;
    expect(width / height).toBeCloseTo(16 / 10, 5);
  });

  it("sends a quality a person can read text at", () => {
    const quality = /quality: (\d+)/.exec(capture())?.[1];
    expect(quality).toBeDefined();
    // 60 put visible ringing on every glyph. Above 85 the bytes stop buying
    // anything a person can see.
    expect(Number(quality)).toBeGreaterThanOrEqual(70);
    expect(Number(quality)).toBeLessThanOrEqual(85);
  });
});

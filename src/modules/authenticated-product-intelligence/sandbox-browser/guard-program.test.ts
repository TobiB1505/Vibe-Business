import { describe, expect, it } from "vitest";
import { BROWSER_GUARD_ENV, BROWSER_GUARD_PROGRAM, BROWSER_RUNTIME_VERSION } from "./guard-program";

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

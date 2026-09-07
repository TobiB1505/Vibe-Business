# The import that argued itself wrong

**Recorded 2026-09-07, after the work.** The tenth click, and the guard finally
said what was wrong with it — because [Sprint 0154](0154-the-image-that-finally-built.md)
gave it somewhere to say it:

```
file:///vibe-browser/guard.mjs:69
const control = new WebSocketServer({ noServer: true });
                ^
TypeError: WebSocketServer is not a constructor
```

## The defect

```js
import WebSocket from "ws";
const { WebSocketServer } = WebSocket;
```

`undefined`, and `new undefined(...)` throws on the guard's first statement —
before any line of its own code runs. Which is exactly why it wrote no failure
file, and why a 45-second timeout said nothing at all for two rounds.

## The comment above it was the problem

This is not a typo. `guard-program.ts` carried a paragraph arguing for that
form:

> The package exports the WebSocket class as its module object with the server
> constructor attached, so a named import of both relies on CJS interop
> detecting a shape it does not always detect. Taking the default and
> destructuring works under Node's ESM loader either way.

Every clause of that is about `ws`'s **CommonJS** entry point, and Node never
reaches it. `ws` ships an `exports` map with an ESM wrapper, and the wrapper's
default is the WebSocket class **alone** — nothing attached.

So the paragraph did not merely fail to prevent the bug. It reasoned its way to
the one form that could not work, and its confidence is what stopped anyone
looking again.

Measured against `ws@8.18.0` rather than argued about a second time:

```
import WebSocket from "ws"   → typeof function, .WebSocketServer undefined
import * as ns from "ws"     → Receiver, Sender, WebSocket,
                               WebSocketServer, createWebSocketStream
```

Both bindings are named exports. Both are now imported by name, and the
paragraph is rewritten to say what was measured instead of what was assumed.

## The test is a source assertion, and says why

`ws` is not a dependency of this repository — it is installed into the sandbox
image — so nothing here can import it and check the shape at runtime. What can
be pinned is the **form**, and the form is what was wrong.

Proved by restoring the original two lines: two tests go red, naming the
destructure and the default import.

## `browser-runtime-v4`

The guard changed, so v3's image holds a guard that cannot start. The next scan
rebuilds.

## Verification

8,725 unit tests green, lint 0/0, typecheck and build clean.

## Where this stands

Ten clicks, ten causes. Two screens, one silent failure, four builds, two wrong
assumptions of mine, one wrong assumption written down years earlier and
believed ever since.

The build works, Chromium runs, and the guard now imports what it uses. What
has still never happened: the guard listening, a frame arriving on the canvas, a
click reaching the browser, and a person signing in.

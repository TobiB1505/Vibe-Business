# The pipe that changed the bytes

**Recorded 2026-09-07, after the work.** The twelfth click. The refusal shipped
in [Sprint 0156](0156-the-browser-that-landed-nowhere.md) did its job on its
first run and named the white screen:

```
browserType.connectOverCDP: Target page, context or browser has been closed
  - <ws connecting>   wss://sb-6c8tk5euc05g.vercel.run/control
  - <ws connected>    wss://sb-6c8tk5euc05g.vercel.run/control
  - <ws disconnected> code=1005 reason=
```

Connected, then closed immediately, with no status code of its own.

## The defect

The control channel is documented as *a byte pipe to CDP*. It was not one:

```js
client.on("message", (data) => upstream.send(data));
```

`ws` hands every message to its listener as a **Buffer**, whatever frame it
arrived in, and `send(buffer)` writes a **binary** frame. So every CDP message
Vibe forwarded reached Chromium as binary, where the protocol is text. Chromium
closed the connection, and Playwright could only report the consequence.

A pipe that changes how the bytes are framed is not a pipe.

Measured against `ws@8.18.0` rather than reasoned about — an echo server, two
sends:

```
send(buffer)                      → server received: BINARY
send(buffer, { binary: false })   → server received: TEXT
```

The listener is handed an `isBinary` flag for exactly this. It now travels with
the message in both directions and through the queue that holds messages until
the upstream opens.

## And a money bug the same log line exposed

Underneath the landing failure, unrelated to it:

```
[deep-scan] failed to record provider usage
  permission denied for table deep_scan_provider_usage
```

`deep_scan_provider_usage` grants the customer's role nothing — deliberately,
because it is Vibe's cost ledger and not their data. `recordUsage` was writing
it with the caller's cookie-scoped client, so **every** write failed. And
`recordDeepScanUsage` logs rather than throws, on purpose, so it failed quietly:
a scan could complete, a customer could be charged, and the seconds Vibe paid
for were never recorded.

That is the figure [ADR 0076](../decisions/0076-the-browser-we-own.md) built the
whole cost instrument to produce. It writes with the service-role client now,
and rule 53's condition is met by construction: the project and session come
from the row `createSessionRecord` persisted after `loadOwnedProject` verified
ownership, and nothing is taken from a caller's arguments.

## The boundary guard had a hole, and I walked through it

The first version of that fix used `await import("@/lib/supabase/service")`
inside the function. `service-boundary.test.ts` passed — because its detection
was a regex for a **static** import at line start.

So a dynamic import obtained a client that bypasses RLS and no test noticed. A
boundary that one syntax slips through is a boundary for the syntax rather than
for the thing.

Both forms are detected now, the site is a static import, and it is recorded in
`REVIEWED_SITES` with its argument. Proved by planting the dynamic form with the
entry removed: the guard names the file.

## `browser-runtime-v5`

The guard changed, so v4's image pipes binary. The next scan rebuilds.

## Verification

8,733 unit tests green, lint 0/0, typecheck and build clean.

## Where this stands

Twelve clicks. The build works, Chromium runs, the guard listens, the port
routes, a person sees a canvas — and the last thing between that and a picture
of their own product was one missing argument on a `send`.

What has still never happened: a frame of the customer's site on the canvas, a
click reaching the browser, and a login.

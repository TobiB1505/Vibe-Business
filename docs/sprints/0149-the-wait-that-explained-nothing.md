# The wait that explained nothing

**Recorded 2026-09-07, after the work.** The fourth failure of the first Deep
Scan, and the point where the image finally built.

## What worked

`browser_runtime_images` has its first row:

```
browser-runtime-v1   snap_sLA0z718ViLlb1Vtm5vSQBS5vDzn   built 23:58:10
```

In one click, and in about twenty-three seconds: `mkdir`, `npm install` of `ws`
and `playwright-core`, `npx playwright install chromium` — the download that had
been refused by DNS twenty minutes earlier — the link program resolving
Playwright's revision-numbered path, the guard written in, the snapshot taken and
the row recorded. Every one of those was listed as unverified by
[ADR 0076](../decisions/0076-the-browser-we-own.md), and all of them now hold.

## What did not

```
step: 'session_ready_timeout', waitedMs: 45000
```

The session sandbox started from the snapshot, Chromium and the guard were
launched without throwing, and the guard's ready file never appeared.

## Why that is a dead end and not a diagnosis

`waitedMs: 45000` is the whole message, and it is the same shape of problem
[Sprint 0146](0146-the-failure-that-said-nothing.md) removed one layer up: one
signal covering several distinct causes.

Chromium missing a shared library, the guard's `ws` import failing under the
snapshot's `node_modules`, the DevTools port never opening — three different
problems, three different fixes, and from outside the VM identical. No ready
file, no exception, and **no output**, because `runBackground` detaches and
nothing reads a detached process.

The guard already knew part of the answer and threw it away:

```js
console.error("guard: chromium did not answer");
process.exit(1);
```

A `console.error` inside a microVM nobody is attached to.

## What was built

**The guard records why it gave up.** `giveUp(reason)` writes a short reason to
a failure file and still logs and exits. A file, because Vibe already reads one
from this VM — that is what the ready file is — while a detached process's
stdout has no reader at all.

**Vibe asks the binary whether it can start.** On timeout, before stopping the
sandbox, it runs `chromium --version` through `run()`, which returns output where
`runBackground` does not. A browser missing a shared library says so on its first
line, and no amount of waiting would have shown it.

Two facts, not one inference, and they separate cleanly:

| `guardFailure` | Meaning |
|---|---|
| `chromium did not answer…` | The guard ran and Chromium was the problem |
| `none recorded` | The guard never got far enough to decide — the guard is the problem |

Both are best effort and bounded. A diagnosis that fails must not replace the
failure it is diagnosing.

**`BROWSER_RUNTIME_VERSION` is `browser-runtime-v2`.** Not cosmetic: the image
lookup is keyed on it, so the guard that was just snapshotted into `v1` would
otherwise be reused unchanged and none of this would take effect. The next scan
rebuilds — about twenty-three seconds, now measured rather than feared.

## Verification

8,706 unit tests green, lint 0/0, typecheck and build clean.

The timeout tests plant both shapes: a guard that decided (`libnss3.so`, exit
127) and a guard that never did.

## Where this stands

Four failures, four causes, each invisible to every test runnable without a real
VM, and each named within minutes of a click. The instrument is now three layers
deep — the step, the guard's own verdict, and the binary's first line — which is
as far as it can go from outside. What it says next is the answer.

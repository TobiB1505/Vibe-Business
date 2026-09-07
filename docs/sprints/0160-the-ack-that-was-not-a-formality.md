# The ack that was not a formality

**Recorded 2026-09-07, after the work.** *"Am Anfang sehr ruckelig, nach ca 20
Sekunden stabiler."* Two causes, both certain from the code, neither needing a
measurement to establish — and one lever left deliberately untouched because it
would need one.

## The first: flow control, switched off by the thing that implements it

```js
// Acked immediately and unconditionally: Chromium sends no further frame
// until the previous one is acknowledged, so a missed ack is a frozen
// picture rather than a dropped one.
send("Page.screencastFrameAck", { sessionId: message.params.sessionId });
```

The comment states the mechanism correctly and misses what it is for.
**"No further frame until acknowledged" is the pacing.** It is how a screencast
matches its rate to whatever is consuming it. Acking on arrival — before the
frame has gone anywhere — removes it: Chromium then produces at full speed
whether or not a phone on a mobile connection can receive the result.

Which is the reported symptom, exactly. A page under load repaints constantly,
so frames are produced as fast as they can be encoded, and they queue in a
socket that cannot drain that fast. When the page goes static the production
stops and the backlog clears — *"nach ca 20 Sekunden stabiler"*.

The ack now waits for the frame to have gone out, measured as
`client.bufferedAmount` returning below one frame's worth.

**The original concern is kept, because it is right.** A missed ack is a frozen
picture rather than a dropped one, so this never waits indefinitely: it acks at
a one-second deadline regardless, and acks immediately when nobody is listening.
A late frame is a cost; a stalled stream is a broken product.

## The second: every frame decoded, only the last one seen

Each arriving frame got its own `Image` and its own decode. When frames arrive
faster than a device can decode them — a phone during a page load — that queues
work whose only visible effect is the last one: each earlier frame is decoded,
painted, and immediately replaced.

Now a decode in flight does not queue another. The newest frame is held and
taken as soon as the current one finishes. **A live browser has no use for a
stale frame** — there is nothing here to miss, only something to be late for.

Two smaller things came with it: a frame that cannot be decoded no longer stops
the ones behind it, and the canvas draws the image scaled to its own backing
store, so a frame that arrives smaller than the viewport paints the whole canvas
rather than a corner of it. The coordinate space stays the browser's, so a click
is still reported in the page's own pixels whatever size the frame arrived at.

## The lever not pulled

**Resolution.** Frames are captured at 1280×800 and displayed on a phone at
about 390 CSS pixels — roughly ten times the pixels that can be shown. That is
the largest remaining cost and it is a guess until measured, because the client
would have to tell the guard how big it is, and the view channel's vocabulary is
closed at four message shapes on purpose (ADR 0076).

**Transport.** Each frame travels base64-encoded inside JSON, which is 33% more
bytes than the JPEG. A binary WebSocket frame would remove that exactly, and
would also be a change to that closed vocabulary.

Both are real, both are quantifiable, and neither is being changed on a hunch
in the same pass as two fixes that are certain. This session has already paid
twice for guessing.

## `browser-runtime-v6`

The guard changed. The next scan rebuilds.

## Verification

8,760 unit tests green, lint 0/0, typecheck and build clean.

The pacing is pinned by order — the send must precede the ack — and by the
deadline that keeps the original concern true. The coalescing is pinned by the
held frame, the drain, the error path, and the coordinate space.

## What this does not prove

Neither fix is measured. They are both certainly-correct in the sense that the
code was doing something the protocol says not to do, and the symptom matches
what that produces. Whether the founder's phone feels different is the next
scan.

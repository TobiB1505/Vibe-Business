# The browser that landed nowhere

**Recorded 2026-09-07, after the work.** The eleventh click, and the first one
that got all the way to a person looking at Vibe's own browser.

## What happened for the first time

```
55c16ed1  vercel_sandbox_browser  credits  01:39:17  cancelled
```

A session row. The image built at `browser-runtime-v4`, the sandbox started
from the snapshot, Chromium came up, **the guard listened**, the ready file
appeared, the public port routed, the view token derived, the modal opened, and
a canvas connected to a WebSocket in a microVM Vibe had created ninety seconds
earlier.

Ten failures ended there. The one that did not: the canvas was **white**.

## Two silences, stacked

The browser is landed on the customer's origin before they ever see it, and that
was best effort in the strongest sense — swallowed twice.

`openSessionAtOrigin` returned a bare `navigated: boolean` and discarded the
reason in a `catch {}`. The caller did not read even that:

```ts
try {
  await openSessionAtOrigin(handle.connectUrl, origin);
} catch {
  // The user can still navigate manually; nothing here is worth failing on.
}
```

So `about:blank` and "reached the site and painted nothing" were the same
observation from outside, and neither reached a log.

## The comment was the argument, and the argument had expired

*"The user can still navigate manually."* That was true when the live view was a
DevTools frontend with an address bar. [ADR 0076](../decisions/0076-the-browser-we-own.md)
replaced it with a JPEG on a canvas speaking four message shapes — mouse, key,
wheel, frame — and says plainly that being strictly less than a DevTools
frontend is the point.

There is no address bar. There is deliberately never going to be one. So a
browser that lands nowhere is not a degraded session somebody can rescue; it is
`about:blank` for the whole ten minutes, and the person is left clicking
"I'm logged in — Analyze" at a white rectangle.

It refuses now, with `page_unreachable` and a reason in Sentry. Every failure
path releases the hold, so refusing costs the customer nothing and saves them a
browser they cannot use. `abandoned_with_usage`, because the VM did run and Vibe
did pay for its seconds — the customer does not.

## The tests were in on it

`vi.mock("./playwright/connector")` provided `connectReadOnly` and **not**
`openSessionAtOrigin`. Every test in that file called `undefined` as a function,
threw, and landed in the `catch {}` — so the landing had never been exercised by
any test while appearing to be covered by all of them.

The same silence as production, one layer up, and it is why the mock now carries
the function and four tests drive it. Restoring the swallow turns three of them
red.

## Verification

8,730 unit tests green, lint 0/0, typecheck and build clean.

## What is still unknown

**Why it did not land.** The reason was never recorded, so this sprint cannot
say whether the site was slow, the CDP connection failed, or `connectOverCDP`
cannot speak to this guard at all. The next attempt says which — and if it
lands, the canvas will show a page rather than a colour.

# Eight pages for ten surfaces

**Recorded 2026-09-07, after the work.** The scan ran. From a phone.

```
39eab461  completed  credits  128 s
```

Sign-in on a touch keyboard, analysis, snapshot, cost row. Every step ADR 0076
listed as unproven, done by a person holding a phone.

And then the founder read the result: *"der scan an sich lief nicht durch, da ist
glaube ich noch das alte budget drin"*. Right on both counts.

## What the snapshot says

| | |
|---|---|
| Candidates found | **72** |
| Pages inspected | **8** |
| Reason | `page_budget_reached` |
| Analysis time | **16 s** of an allowed 90 |
| Depth reached | **1** of an allowed 2 |

It ran out of pages before it ran out of product, and finished in a sixth of the
time it was allowed. The clock was never the constraint.

## The number was sized against the wrong thing

`maxPages: 8`, and the sentence above it said why: *"a real browser rendering a
logged-in application is expensive in provider seconds"*. That was Browserbase.
The first real scan on Vibe's own sandbox measured the replacement: **$0.0121
for the whole 128-second session**, 112 seconds of which were a person typing a
password, against $0.441 of revenue.

But cost is not the argument for the new number, because cost was the wrong
argument for the old one.

**`AuthenticatedSurfaceId` is ten long.** A budget of eight pages cannot
describe ten surfaces — not if every page visited were a different one, not if
none were the landing page, not if no surface ever needed two pages to
recognise. The number was never sized against the job.

Twenty-five is: about two pages per surface, because a settings area is a list
and a detail, plus the landing page, plus room for pages that turn out to be
none of them.

`maxCandidates: 50 → 150` for a different reason. Fifty truncated a list of 72
**before prioritisation**, so it did not shorten the crawl — it changed which
pages were eligible to be chosen. Candidates are URLs in memory.

`maxDurationMs: 90 s → 180 s`, so 25 pages have room to be slow ones; the route
function's own ceiling moves 120 → 240 to stay above it, which is the rule that
file already stated: a scan ends because Vibe decided it had seen enough, never
because the platform killed the function.

`maxDepth`, `maxLinksPerPage` and `navigationTimeoutMs` are untouched. Depth is
the guard against wandering out of the product, and this scan never reached it.

## What it costs, at the measured rate

At the 2.0 seconds per page that scan measured, and `VERCEL_SANDBOX_RATES` as
attested:

| | Session | Cost | Margin |
|---|---|---|---|
| Today | 128 s | $0.0121 | 97.3% |
| At 25 pages | 162 s | $0.0153 | 96.5% |
| Slow login, full analysis | 262 s | $0.0248 | 94.4% |
| The 10-minute ceiling | 600 s | $0.0568 | 87.1% |

Three times the product understood, for about a third of a cent.

## The test asserts the reason, not the number

`maxPages` is checked against the length of the surface list rather than against
itself, so an eleventh surface with no room to find it fails here. The candidate
budget is checked against the 72 a real product offered, and the duration
against both the pages it must cover and the route ceiling it must stay under.

## And the keyboard stopped following people around

Mine, from yesterday: `takeKeyboard()` on every touch. So it reappeared on every
drag, covering half the product on a screen with little enough of it. It is
raised on a **tap** now — measured as movement within eight pixels, because a
finger is not a mouse — and still inside the gesture, which is the only moment
iOS will open one.

## Verification

8,752 unit tests green, lint 0/0, typecheck and build clean.

## What is still open

**Performance.** The founder reports the first ~20 seconds are choppy and it
settles after that. Nothing here addresses it: the screencast is
`everyNthFrame: 1` at quality 60 with no adaptation, and a mobile connection
receiving full frames of a 1280×800 desktop viewport is the obvious suspect.
Measuring that is its own piece of work and is not begun.

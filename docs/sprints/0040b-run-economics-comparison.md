# Run #1 vs Run #2 — why the same task cost twice as much

Read out of durable telemetry on 2026-08-19. Every figure below is a stored
value or an arithmetic identity over stored values; nothing is estimated.

| | Run #1 `42b4cc54` | Run #2 `b33635a1` | Δ |
| --- | ---: | ---: | ---: |
| Assistant messages | 48 | 66 | +38% |
| Wall clock | 9 m 05 s | 10 m 35 s | +16% |
| Provider calls | 21 | 35 | **+67%** |
| Failed calls | 0 | 0 | — |
| Input tokens (uncached) | 1 610 | 1 638 | +2% |
| Output tokens | 9 902 | 18 285 | +85% |
| — of which thinking | 5 065 | 11 012 | +117% |
| Cache **read** tokens | 518 039 | 1 354 516 | **+161%** |
| Cache **write** tokens | 41 052 | 63 525 | +55% |
| Cache hit ratio | 92.4 % | **95.4 %** | +3 pp |
| Avg billed input / call | 26 700 | 40 562 | +52% |
| Largest single call | 41 054 | 63 527 | +55% |
| Mean latency / call | 6 827 ms | 7 098 ms | +4% |
| **Provider cost** | **$0.3085** | **$0.6158** | **+100%** |
| Sandbox active CPU | 311 527 ms | 262 149 ms | −16% |
| Sandbox wall duration | 544 778 ms | 634 502 ms | +16% |
| Sandbox egress | 6.29 MB | 9.03 MB | +44% |
| Sandbox cost | *not reported* | *not reported* | — |

## Where the money actually went

Decomposed at Sonnet 5's introductory rates ($2 / $10 per MTok, cache read
0.1×, cache write 1.25×). The decomposition reproduces the stored
`provider_cost_usd` to the cent in both runs, which is what makes it a
derivation rather than a guess.

| Component | Run #1 | share | Run #2 | share |
| --- | ---: | ---: | ---: | ---: |
| Cache read | $0.1036 | 34 % | **$0.2709** | **44 %** |
| Output (incl. thinking) | $0.0990 | 32 % | $0.1829 | 30 % |
| Cache write | $0.1026 | 33 % | $0.1588 | 26 % |
| Uncached input | $0.0032 | 1 % | $0.0033 | 0.5 % |
| **Total** | **$0.3084** | | **$0.6159** | |

Stored: $0.3085 and $0.6158. The difference is rounding on 21 and 35 individual
rows.

## The answer

**Run #2 cost twice as much because it ran longer, and cost grows
super-linearly with length.**

Each additional provider call re-sends the whole accumulated transcript. Run #2
made 67 % more calls, and each of those calls carried 52 % more context than run
#1's average — so the cache-read line grew by 161 % and became the single
largest component of the bill. Length is the driver; everything else follows
from it.

**What did *not* cause it:**

- *Caching.* It worked, and worked **better** in the more expensive run — 95.4 %
  against 92.4 %. Without prompt caching, run #2's 1.35 M cached input tokens
  would have been billed at the full input rate: **$2.71 instead of $0.27**, and
  the run would have cost roughly $3.05 rather than $0.62. Caching is saving
  about 80 % of this product's inference bill.
- *Failures.* Zero failed provider calls in either run.
- *Latency or model.* Same model, 4 % latency difference.

## What we could not determine, and what run #3 will capture

The comparison above is everything the persisted data supports. Three questions
have no answer in it:

1. **Why run #2 needed 18 more assistant messages.** Nothing recorded what the
   agent was doing per turn — which files it read, which commands it ran, how
   many times it repaired. `agent_execution_events` now records exactly that,
   one row per tool call, so run #3's transcript growth is attributable.
2. **Which provider calls served which work.** `ai_usage_events` has no link to
   an activity. It still will not, but the two logs are now on the same run and
   the same clock, so a call and the tool use around it can be lined up by time.
3. **Sandbox cost.** `provider_cost_usd` is null on both rows because Vercel does
   not price a sandbox per run. The raw metering (CPU, duration, egress) is
   stored and displayed; the derived cost is shown as *not reported* rather than
   invented. `total_execution_cost_usd` is therefore null by design until a rate
   exists.

## Cost per successful change

```
agent runs                     5
prepared changes (status = prepared)   0
total provider cost            $0.9243
cost per successful change     undefined
```

Undefined, not zero and not $0.18. The denominator is **prepared changes**, not
completed runs, precisely so this number cannot flatter a product that has spent
money and delivered nothing reviewable. Every dollar above is in the numerator;
the denominator is still waiting on run #3.

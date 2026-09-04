# modules/outcome-verification

Did the intended behaviour actually appear in public? — see [ARCHITECTURE.md §3 "Layers with no section above"](../../../ARCHITECTURE.md#layers-with-no-section-above), [ADR 0020](../../../docs/decisions/0020-production-outcome-verification.md) and [ADR 0071](../../../docs/decisions/0071-agentic-outcome-verification.md).

## Three questions, kept apart

```
DELIVERY          did the repository state change as intended?
                  → modules/merge. The default branch points at the approved commit.

PRODUCT OUTCOME   did the intended observable behaviour appear publicly?
                  → this module. /robots.txt is reachable, the sitemap lists the
                    homepage and not the login form.

BUSINESS OUTCOME  did traffic, conversion, activation or revenue move?
                  → modules/business-measurement, and not implied by either above.
```

Collapsing any two of them is the failure this module exists to prevent. **A verified product outcome is not evidence of business impact, and neither is evidence of a deployment.**

## Why this is not "deployment verified"

Vibe controls no deployment provider and reads no deployment API. What it can honestly say is that it made a bounded set of public HTTP requests and saw the behaviour the merged capability was supposed to produce. That is _consistent with_ the new build having reached production. It is not proof of it, and it carries no provenance for which commit is serving.

So the vocabulary is `verified` / `partial` / `not_observed` — never `deployed`, `live`, `released` or `shipped` (rule 74).

## The observation is bounded, and the budgets say how

`budgets.ts` holds every limit that bounds an outbound request or a parsed document, so no call site can quietly observe longer, larger or more often than agreed — the same discipline as the crawl budgets in [`live-product-intelligence`](../live-product-intelligence/README.md) (rule 39). Reaching a budget degrades the result to `partial`; it never triggers an unbounded crawl and never fails an otherwise useful observation (rule 27).

Every request goes through the safe-fetch boundary (rule 35), and nothing fetched is persisted: what is stored is the derived check result and a short evidence label, never HTML, body text, cookies or query strings (rule 37).

## Observation is a window, not a moment

A merge does not become visible instantly, and neither does it become visible at a predictable time. `schedule.ts` spreads a bounded set of attempts across an observation window, and `windowDeadline`/`withinWindow` decide when the question stops being asked. That is why this is a durable operation — fifteen minutes with sleeps in it is not something a browser request holds open, and the authoritative result must be written by something the client cannot impersonate.

## What lives here

| File              | Purpose                                                                                      |
| ----------------- | -------------------------------------------------------------------------------------------- |
| `schema.ts`       | The domain: profiles, resources, check kinds, the versioned policy, and the three questions. |
| `budgets.ts`      | Every limit on an outbound request or a parsed document.                                     |
| `eligibility.ts`  | Whether a merged change can be verified at all, and against which public origin.             |
| `observe.ts`      | Making the bounded observations: robots, sitemap, routes.                                    |
| `evaluate.ts`     | Turning observations into checks, and checks into a classification.                          |
| `canonical.ts`    | URL and path canonicalization, so a comparison is not defeated by a trailing slash.          |
| `schedule.ts`     | When to look, and when to stop looking.                                                      |
| `identity.ts`     | The identity a verification is bound to.                                                     |
| `service.ts`      | Starting a verification, and the cards a screen reads.                                       |
| `store.ts`        | Persistence for `change_outcome_verifications`.                                              |
| `view.ts`         | Deriving the outcome card, check by check.                                                   |
| `messages.ts`     | The user-facing sentence per failure, and the scope note per profile.                        |
| `test-support.ts` | Fixtures: a fake site, fake HTTP, and a seeded merged change.                                |

The durable step graph is in [`src/modules/operations/change-outcome-verification/`](../operations/change-outcome-verification/workflow.ts).

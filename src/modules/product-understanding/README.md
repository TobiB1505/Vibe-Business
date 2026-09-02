# Product Understanding

Answers **"what is this product?"** — the question between the scanners' "what did Vibe
observe?" and the Business Audit's "what does this mean for the business?".

See [docs/sprints/0021-core1-product-understanding.md](../../../docs/sprints/0021-core1-product-understanding.md).

## Pipeline

```
repository snapshot ┐
live snapshot       ├─→ evidence pack ─→ token count ─→ ONE paid call ─→ validate ─┐
deep scan (optional)┘                                                              │
                                                                                   ▼
deterministic derivation (capabilities, journey, business signals, brand, tech) ─→ assemble
                                                                                   │
                                                                       corrections ▼
                                                                          product-profile.v1
```

## Files

| File | Owns |
|---|---|
| `schema.ts` | `product-profile.v1`, confidence levels, source priority, closed vocabularies |
| `evidence.ts` | The prompt's input, and the minimization boundary that decides what never reaches it |
| `deterministic.ts` | Everything answerable without a model |
| `brand.ts` | Resolving one brand from two collectors |
| `prompt.ts` / `wire-schema.ts` / `validate.ts` | The model call and its independent validation |
| `runner.ts` | The single-call pipeline. No database, no `server-only` — testable against a fake provider |
| `assemble.ts` | Source priority, capability ranking, correction overlay |
| `store.ts` | Persistence, reuse identity, confirmation |
| `view.ts` | Every user-visible string, and the rules about what each may claim |

## The four rules that matter

**1. Rules answer what rules can answer.** A capability, a journey stage and a business
signal are all "does this surface exist?", and inference is worse at that than code is —
worse, slower, and differently wrong each run. Only the semantic half goes to a model.

**2. Being served beats being declared.** Code containing a dashboard is not a visitor
reaching one. Nothing reaches `confirmed` from repository evidence alone; code-only tops out
at `likely`. The same asymmetry orders `SOURCE_PRIORITY`.

**3. `not_found` means Vibe looked.** It never means the thing does not exist, it is never
counted against the product, and the view layer is tested for the difference.

**4. A person outranks everything.** A correction lives in its own project-scoped table and
is applied on read, so replacing the derived profile cannot touch it.

## What the model may and may not do

May: write the identity, audience and promise fields; pick a category; rank capabilities
from a closed list; state what it could not establish.

May not: add a capability the rules did not find, invent a category, produce a score, say
anything about how the product performs, or reach any tool — it has none. Every citation is
checked against the pack that was sent, and a `confirmed` claim that cannot cite anything is
demoted with its value dropped.

## What never reaches a prompt

Repository file paths, file contents, dependency versions, config values, signed-in page
headings, anything matching an email/URL/key/long-identifier shape. URL paths *are*
forwarded: `/pricing` is product structure a visitor can see, and it tells a model what the
file serving it would without naming that file. Which file that is — or whether the prices
live on a route of their own at all — is repository structure, and stays here.

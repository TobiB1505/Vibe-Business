# Sprint UI-3.5 — Human-First UX & Audit Simplification

No new feature. The analysis screens said true things in the scanner's vocabulary; they now say
the same true things in the customer's.

## UX Principle

**Answer first. Evidence second. Tech last.**

The audience built a product with an AI tool and is trying to build a business around it.
`canonical: absent` is a correct statement and a useless one to them. "Search engines don't know
which version of a page is the real one" is the same fact, told to the person who has to decide
something.

## Presentation Layer

`src/modules/live-product-intelligence/human-view.ts` — a **deterministic** translation from
snapshot to sentences. No model, no generation, no paraphrasing at render time; every string is
a lookup or a small conditional over facts the snapshot already contains. Asserted by a test
that identical input produces identical output.

`DIMENSION_QUESTIONS` in the audit schema does the same for the five business dimensions: a
second label table beside `DIMENSION_LABELS`, which is untouched and still what technical views
show. No id, no score and no stored payload changed.

## Terminology

| Was | Now | Technical value still at |
|---|---|---|
| Product surfaces | "Pages customers normally look for" | `surface.<id>` |
| Conversion | "Can visitors become customers?" | conversion booleans |
| SEO foundations | "Search engines are missing…" | `signal.<id>` |
| Canonical URL | "Which version of a page is the real one" | `signal.canonical` |
| Structured data | "Extra context for search engines" | `signal.structured_data` |
| robots.txt | "Instructions for search engines" | `signal.robots_txt` |
| Completeness | "Check finished: Fully / Only partly" | `completeness` |
| Pages inspected | "Pages Vibe looked at" | `pagesInspected` |
| requests / KB / ms | — (moved out of the default view) | `requests`, `bytesFetched`, `durationMs` |
| Validation | **Safety checks** | stored status unchanged |
| Monetization | "Can you make money from it?" | `dimension: monetization` |
| Deep Scan (heading) | "Look inside your signed-in product" | product term retained as a label |

## Technical Details

`Disclosure` and `TechnicalDetails` (`src/components/ui/disclosure.tsx`), built on `<details>`
— keyboard operable, `aria-expanded` exposed by the platform, no hydration, works without
JavaScript. Collapsed by default; values render exactly as recorded, with `null` shown as
`null` rather than an em dash.

**Nothing was removed.** The live product check carries every raw signal id and its boolean,
every metric and every metadata value into the technical layer, verified in the browser: 27264
bytes, not "27 KB"; 1081 ms, not "about a second".

## Screen Migrations

| Screen | Default conclusion | Technical terms hidden? | Clear next action? |
|---|---|---|---|
| Live product check | yes — "Your product is online. 2 things need attention." | yes | yes — each finding names what is missing |
| Business score | yes — dimensions read as questions | yes — dimension id behind details | yes — Re-run business audit |
| Safety checks (validation) | yes — "All safety checks passed" + what it does *not* mean | partly — phase names remain | yes |
| Deep Scan | yes — "Look inside your signed-in product" | yes | yes |
| Activity | yes — human event titles since UI-2.5 | yes | n/a — it is a record |
| Next moves | yes — finding, why it matters, evidence behind a disclosure | yes | yes |
| Dashboard | yes — "3 things need your attention" (UI-3) | yes | yes |

## Deviations

- **Prepared and Impact were not fully migrated.** Both carry substantial test-coupled copy
  (`merge-ui.test.ts`, `approval-ui.test.ts`, the E2E suite assert exact strings on the merge
  path), and their vocabulary is closer to the user's already. Validation inside Prepared *was*
  migrated because it is the piece that read most like CI. Recommended as the next slice.
- **Validation phase names** ("Source integrity", "Typecheck", "Production build") stay as they
  are. They name real steps, a person reading a failed check needs to know which one failed, and
  softening them would cost precision for no gain.
- **"Deep Scan" was kept as a product term** rather than renamed, with an explanatory heading
  above it. Renaming a term already used in entitlement copy and error messages is a bigger
  change than this sprint's remit.

## Two defects found while migrating

1. **Duplicate technical keys.** `title` was both a metadata value and a signal id, so the
   technical list silently showed one where the reader expected the other — and would have
   collided as a React key. Signal ids are now namespaced `signal.<id>`. Found by a test.
2. **Every score question was truncated.** `ScoreMeter` had a fixed 8rem label column sized for
   "Monetization"; "Do people understand what you built?" needed 260px and got 128. The label
   moved above the bar. A question that cannot be read is worse than the category name it
   replaced. Found in the browser.
3. **Mobile overflow.** With every disclosure open, two long repository paths pushed the content
   past 375px. They now wrap.

## Validation

- `pnpm lint` · `pnpm typecheck` — clean.
- `pnpm test` — 141 files, 2718 tests (14 new for the human view, including "it never flatters"
  and "nothing technical is lost").
- `pnpm build` · `pnpm test:e2e` (58 chromium) — green, unchanged.
- Browser, real data: the live check reads "Your product is online. 2 things need attention.",
  each finding states why it matters, technical details are collapsed and contain every raw
  value. Score dimensions read as questions, none truncated.
- 1440 / 375 — no horizontal page scroll, and none even with every disclosure forced open.

## Next Recommended Phase

**UI-4 — the landing page**, as planned. The Prepared and Impact copy migration is the natural
follow-up slice; it needs the test-coupled merge strings handled deliberately rather than in
passing.

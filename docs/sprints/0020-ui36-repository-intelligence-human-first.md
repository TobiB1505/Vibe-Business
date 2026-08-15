# Sprint UI-3.6 — Human-First Repository Intelligence

UI-3.5 established the principle. This applies it to the screen that most resembled a developer
tool: no new engine, no new parser, no new detection, no AI.

## UX Principle

Repository Intelligence answers **"what does your code tell Vibe about your business?"** — not
"what files are in your repository?".

The analyzer is right and it was unreadable. "Stripe · manifest_dependency · package.json" is a
true statement to someone who already knows what it implies. The person this product is for asks a
different question: *can customers pay me yet?* The screen now answers that, and keeps the
dependency name underneath it.

## Presentation Layer

`src/modules/repository-intelligence/human-view.ts` — a **deterministic** translation from
snapshot to capabilities. No model, no generation, no paraphrasing at render time; every string is
a lookup or a small conditional over facts the snapshot already contains. A test asserts identical
input produces identical output.

`src/modules/repository-intelligence/cross-check.ts` — four comparisons between what the code says
and what the live check saw (§11). Not an inference engine: each is a direct comparison of two
booleans both snapshots already recorded.

The detectors, parsers, path policy, budgets, schema, store and service are **untouched** (§40).

## Capability Mapping

| Capability | Derived from | Never says |
|---|---|---|
| Accounts | `auth` signals, `authentication` surface, `/login` + `/signup` page routes | "sign-in works" |
| Getting paid | `payments` signals, `payments` / `pricing_page` / `checkout_billing` surfaces | "customers can pay" |
| Understanding customers | `analytics` signals, `analytics` surface | "you don't have analytics" |
| Customer data | `database` signals | "your data is safe" |
| Being found in search | `seo_metadata` / `sitemap` / `robots` surfaces | "you rank" |
| Knowing when something breaks | `monitoring` signals | "errors are handled" |
| Getting updates out | `deployment` signals | "your deployment works" |

Two rules hold the mapping together:

1. **Several signals, one conclusion.** Auth code + a sign-up route + a sign-in route become
   "Customers can create an account and sign in." Each individual signal survives underneath.
2. **A missing page is only missing if pages were readable.** For frameworks that declare routes
   in code the analyzer reports `limited` and returns none, so "no pricing page" would mean "not
   looked at". Those capabilities say so instead of reporting an absence.

## Confidence Language

| Status | Shown as | Means |
|---|---|---|
| `likely` | Likely | Strong repository evidence, several signals agreeing |
| `partial` | Needs checking | Some evidence, and a piece the code cannot supply |
| `unclear` | Unclear | Evidence exists and does not add up to a conclusion |
| `not_found` | Not found | Vibe looked and found nothing |

**There is deliberately no `confirmed`.** Confirmation is a statement about runtime — that a real
visitor can really do the thing — and only the live product check and Deep Scan can make it.
Repository evidence tops out at "likely", enforced by the type and by a test. The line beside every
status says the same thing in words: *Vibe read your code, so it can say what looks like it exists.
Only checking the live product can show whether it works for a customer.*

## Progressive Disclosure

| Level | Content | Example |
|---|---|---|
| 1 — default | Capability name, status, conclusion, what Vibe saw, why it matters, one action | "Payment functionality appears to be started, but the buying flow isn't clear yet." |
| 2 — "What Vibe found" | Readable observations, present and absent separated | "✓ Payment-related code · Not found: a pricing page" |
| 3 — "Where in the code" / "Technical details" | Paths, dependency names, detection ids, confidences, scan metrics | `package.json · stripe`, `signal.payments.stripe: high`, `bytesFetched: 27264` |

Levels 2 and 3 are `<details>`, collapsed by default — keyboard operable, `aria-expanded` from the
platform, no hydration, works without JavaScript.

## Preserved Evidence

Nothing was deleted. Every detection id and confidence, every business surface boolean, every
evidence path, every scan metric and the full page-route list reach the technical layer with their
exact values — `27264`, not "27 KB". Detection ids are namespaced (`signal.payments.stripe`,
`surface.pricing_page`) because an integration category and a business surface share the name
`payments`, and an unprefixed list would silently render one where the reader expected the other.
A test asserts every technical key is unique.

## Layer Differentiation

| Layer | Reads as | Where |
|---|---|---|
| Code | "What Vibe learned from your code" | Repository intelligence |
| Public product | "What Vibe sees when it visits your product" | Live product check |
| Signed-in product | "Look inside your signed-in product" | Deep Scan (UI-3.5) |

Where the first two disagree, the disagreement is the finding: *"Your product can take payments,
but nothing a visitor can reach leads to paying."* — never `repository: true / runtime: false`.

## Terminology

| Was | Now | Technical value still at |
|---|---|---|
| Framework: Next.js | "Built with a modern web stack." | `framework.nextjs`, stack names in details |
| Auth provider detected | "Customers can create an account and sign in." | `signal.auth.supabase_auth` |
| Billing dependency present | "Vibe found payment-related code." | `signal.payments.stripe` |
| Analytics: none | "You may not know what visitors do after they arrive." | `surface.analytics` |
| `stripe` in package.json | "Payment-related code" | `package.json · stripe` |
| Routes (34) | — (moved out of the default view) | "Pages Vibe found in the code" |
| 431 source files · 4 inspected | — (moved out of the default view) | `sourceFileCount`, `filesFetched` |
| Inspect repository | "Understand my product" / "Check the code again" | — |
| Inspecting… | "Vibe is understanding your product…" | — |
| `github_contents_permission_required` | "Vibe couldn't read your code." + Reconnect GitHub | `failureCode` |
| Analysis partial (tree_truncated) | "Vibe understood most of the project, but this analysis did not finish completely" | `completeness`, reasons kept verbatim |

## Actions

Findings link into systems that already exist (§38): a gap links to **Next moves** (`/moves`,
the Opportunity engine), and anything the code cannot settle links to the **live product check**
on the same route. No second recommendation system was created, and no copy invents advice.

## Deviations

- **Customer communication has no capability.** The sprint lists transactional email and lifecycle
  messaging as an example group; the analyzer detects no email provider (no Resend, Postmark,
  SendGrid rule exists). Inventing one would have meant changing the engine, which §40 forbids.
  Recorded here as the missing domain signal rather than added silently.
- **Tests are not a capability.** §20 asks for "your product has automated safety checks"; the
  snapshot has no test detection at all — no test-framework rule, no test-file counting. Same
  decision, same reason.
- **Error handling is only monitoring.** §27 groups error handling with monitoring; only the
  monitoring dependency is detectable without reading source, so the capability claims exactly that
  and no more.
- **README/docs presence is not surfaced**, per §28 — it was already absent from the snapshot.
- **The live-product anchor is route-local.** "Check the live product" is an in-page jump, because
  the live check renders on the overview route rather than one of its own. If it ever gets its own
  route, `nextStepHref` is the one place to change.

## Testing

- `human-view.test.ts` — 29 tests: the summary answers a business question, scan counts stay out of
  the leading text, each capability maps correctly, weak evidence never becomes a working feature,
  analytics says "Vibe couldn't find" rather than "you don't have", evidence and metrics survive
  with exact values and unique keys, and identical input produces identical output.
- `cross-check.test.ts` — 8 tests, half of them about the two ways a comparison could fabricate a
  finding: a live check that saw nothing, and a repository whose routes were never readable.
- `e2e/repository-intelligence.spec.ts` — 12 chromium tests on the real component, because reading
  order is a question about pixels rather than data: conclusions visible on first paint, no package
  names or paths in the default view, groups in order, technical details collapsed and reachable by
  keyboard, and no horizontal overflow at 375px with every disclosure forced open.

## Validation

- `pnpm lint` · `pnpm typecheck` — clean.
- `pnpm test` — 143 files, 2755 tests (37 new).
- `pnpm build` — green.
- `pnpm test:e2e` — 70 chromium tests (58 existing + 12 new), zero external requests.
- Browser, 1200 and 375px: conclusions first, statuses carried by word as well as colour, actions
  visible without expanding anything, no sideways scroll with every disclosure open.

## Not Done

Browser QA against a **real connected repository** (§43) was not possible in this environment: it
has no signed-in session and no isolated database, which is the same limitation Sprint 11C.1
recorded. The fixtures are the shape a real Next.js SaaS produces, and the gap is real — the first
dogfood on live data is the remaining check.

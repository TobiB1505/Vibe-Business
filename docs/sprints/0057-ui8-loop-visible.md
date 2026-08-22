# UI-8 — The loop, made visible

**Status: implemented, not merged.** No migration, no schema, no new dependency, no AI call, no money spent, no product behaviour changed. Lint 0 errors / typecheck / **6,053 tests across 333 files** / build / **328 browser E2E** green.

Derived from a Claude Design prototype, `Scan To Merge Walkthrough.dc.html`, supplied as a guideline rather than a specification.

## The problem

Vibe performs seven steps — connect, scan, audit, opportunities, prepare, review, merge — and never says which one you are on.

A linear stepper already existed (`OnboardingShell` + `ONBOARDING_PHASES`), and it stops after the first move. From `/moves` onward a founder sees eight equal navigation entries and no answer to *what happens next?*

The information to answer it was already there, and mostly already computed:

- `deriveChangeProgress` produces **twelve** linear states per prepared change, from `not_validated` to `observed`. They fed exactly one headline sentence and a `<details>` toggle.
- `AgentExecutionLiveView` is a complete live feed with a six-phase timeline and a `customer`/`internal` split on every event — mounted only on the dogfood route.
- `scoreDisplay()` has encoded Rule 44's honest-null rule since UI-0 and has **zero production callers**.

So this sprint was mostly composition, not domain work.

## The design was a guideline, and seven parts of it were declined

The prototype's tokens were generated from `src/app/globals.css` and match it value for value, so the visual layer cost nothing. Its content was another matter. Each of the following was checked against the code before it was declined, and each is a claim the UI would have made that the product does not support.

| The prototype | Why not |
|---|---|
| "The change is live on main." | `merge-panel.tsx:23` requires the opposite, and `live` matches `FORBIDDEN_EXCEPT_MERGE` in `approval-ui.test.ts:62`. The sentence would have turned a suite red. |
| One button, "Approve & merge" | Approval and merge are two authorities ([ADR 0018](../decisions/0018-human-approval-authority.md), [ADR 0019](../decisions/0019-safe-approved-change-merge.md)), and `mergeApprovedChangeAction` requires a `changeApprovalId` that must already exist. The label also matches `FORBIDDEN`. |
| A "Reject" button before approval | No such action exists. The only negative is `revokeApprovalAction`, which revokes an approval already given. |
| Preview at `*.vercel.app` | Precisely the option [ADR 0016](../decisions/0016-temporary-preview-isolation.md) rejected: it "would place Vibe-authored code into the customer's own hosting". |
| An agent event `Deploy → preview` | The agent holds no network tool and no deployment credential (rules 76, 79, 81). |
| A drawn before/after of the customer's pricing page | Its own caption admits it is a mockup. Real reviews are two captured images at identical dimensions, enforced by a database CHECK ([ADR 0017](../decisions/0017-visual-review-artifacts.md)). |
| "60 Credits" beside *Prepare this change* | Agent execution is deliberately **unpriced** (`credits/retail.ts:60-64`). The number does not exist. *(The prototype's "20 Credits" for moves is correct — `retail.ts:110`.)* |

Two further findings decided what did **not** get built, and both are recorded below rather than buried in a diff.

## What was built

### 1. A projection, not a second state machine

`deriveLoopStage` (`src/modules/execution/loop-stage.ts`) takes facts and returns seven stages. It decides nothing: onboarding decides connection and profile, `business-audit/entitlement.ts` decides whether an audit may run, `opportunities/service.ts` decides whether moves may be generated, and the owning modules decide each prepared change's verdicts.

Three properties are pinned by tests rather than by convention:

- **It is a projection.** No database handle, no clock, no polling — asserted on the file's source, because a mock proves one call did not read and the source proves it cannot. A projection that *could* read is one that will eventually decide something, and then it is a second source of truth reading at a different moment than the section above it.
- **A stage nobody has reached is never blocked.** Otherwise a project that never got past connecting shows a red *Opportunities* on the founder's first ever screen — "not yet" rendered as "went wrong".
- **`credits_required` is not a wall.** Its own docblock says so: BILLING CORE-2 made it a route into paying. A rail painting it red would re-decide, in the opposite direction, a question billing already answered.

### 2. The rail asks for less than `ChangeStage`, on purpose

The obvious design fed `deriveChangeProgress`'s twelve states in. It was rejected on cost. Producing one requires the full prepared-change workspace — seven card reads per change, up to four GitHub calls for an approved one, signed review-image URLs, a sandbox origin for a running preview. A spine is only worth having on the screen a founder actually opens, and paying a workspace read to render seven words there is the debt UI-2 split the routes to pay down.

So `LoopStageFacts` carries five persisted verdicts per change, each owned by the module that reached it, all readable cheaply (`loop-facts.ts`, two queries over two columns). The cost of that choice is named in the code: the rail cannot distinguish *comparison unavailable* from *ready to review*, because that lives in `ReviewCard` and `PreviewCard`. `/prepared` shows it in full. **The rail says which box you are in; it does not replace the section that owns the box.**

`auditBlockedReason` is passed as `null` from Overview for the same reason, and the page says why.

### 3. Where it lives, and why not the layout

`src/app/app/projects/[projectId]/layout.tsx` is deliberately budget-constrained — its docblock explains that anything loaded there is paid for by all eight routes. The rail went on **Overview**, which had already loaded eight of the nine facts, above the summary tiles: orientation before numbers.

Every step links to the section that owns it, via `projectSectionHref`. That is the whole reconciliation of the two navigation models the design raised:

> **8 workspace sections = information architecture. 7 loop stages = progress orientation.**

The spine never becomes a second router, and a test pins every `sectionId` against `PROJECT_SECTIONS` so a stage cannot name a section that does not exist — which, because `projectSectionHref` falls back to the project root, would otherwise be a *silently* dead link.

### 4. Four gates, not five panels

`deriveChangeSteps` (`change-steps.ts`) takes the `ChangeStage` and only that. It reads no card: a rail consulting `ValidationSummary` directly could disagree with the headline printed immediately above it, and two components disagreeing about one change is the defect `change-progress.ts` was written to end.

Four steps, though the section renders five panels. `reviewGate` folds a preview in flight into `reviewing` because a preview never gates a change — a fifth step would show *pending* forever on changes that legitimately skipped one, which reads as unfinished business that does not exist. A test refuses that step by name.

`review_required` and `awaiting_approval` are deliberately **not** blocked. Both are the founder's move.

### 5. Unpriced is not free

`CostDisclosure` composes the existing `CreditPrice` with the balance and a consequence sentence. Its third state is the load-bearing one: Deep Scan and agent execution are absent from `RETAIL_OPERATION_KINDS` because neither has an approved price, so `"unpriced"` is a separate value rendering as *"No price is currently assigned to this action."*

`costLabel` is pure and exported so the distinction is a unit test: unpriced is not free, is not zero, and contains no digit at all. The prototype's "60 Credits" is the specific mistake those tests refuse.

### 6. State in words, not in colour

The prototype marks the current step with a mint dot and a heavier font weight, and completed steps with a mint dot alone. Both are colour; neither reaches a screen reader, and *done* versus *current* is what a person navigating by voice needs most. Every `StageRail` step carries its state as visually-hidden text and the live step carries `aria-current`, both asserted in the browser.

Blocked is amber rather than coral: coral means failure or something destructive, and a blocked step means the loop cannot advance until something changes.

## Two things the sprint plan called for and did not ship

**`ScoreMeter` was not revived, and should not be.** The plan treated its revival as a deliberate reversal of UI-6's deletion, to be recorded. Reading further made the reversal indefensible:

- `business-audit/schema.ts:146` states the nine lenses are "**not scores**". They carry `LensHealth` — a qualitative vocabulary. Numeric scores belong to the five *dimensions*, which are PRODUCT.md §10's contract and which UI-1.2 removed from this screen as a second, competing verdict.
- `business-map.tsx:132` already renders a `HealthBar` per lens, beside `HEALTH_LABELS` in words.

So the prototype's nine 0–100 meters show numbers the domain does not produce, in a place where a third rendering of the same judgment would re-create exactly the "three things saying the same thing on one screen" that UI-1.2 fixed and UI-6 declined to undo. The component was written, then deleted unshipped.

`scoreDisplay()` therefore still has no production caller. That is a pre-existing gap and belongs in the roadmap, not in a UI sprint willing to invent a home for it.

**The merge CI/CD disclosure was already there.** The plan listed adding it as work, on the finding that the *prototype* omits it. `merge-panel.tsx` already carries both halves — "This does not deploy your application" and "Updating the default branch may trigger your repository's existing CI/CD or hosting automation" — before the click. Nothing to add.

## What has not been proved

- **The agent live feed is still only on the dogfood route.** `AgentExecutionLiveView` and its `customer`/`internal` event split remain unmounted on any customer surface. The guardrail the sprint agreed for it — that `customerEvents` is the sole source, enforced by a test rather than by the `developerDetails` prop — is unwritten because the mount is unwritten.
- **`review-panel.tsx` was not restyled** to the prototype's two-column *Current / Vibe proposal*. The shape is right and matches ADR 0017; only the layout work is outstanding.
- **`CostDisclosure` is wired at one of three call sites.** `run-audit-button.tsx` and `action-plan-panel.tsx` still render a bare `CreditPrice`, so the balance appears next to the price on `/moves` and nowhere else.
- **No screenshots were reviewed by eye.** Sprint 0033 recorded that looking at the screen found what its tests did not; this sprint has the browser assertions and not the look. The 375px overflow check is automated; visual density at 1440 is not.
- **The transition test does not prove a live re-render.** Both halves of the blocked → unblocked pair are server-rendered fixtures. It establishes that nothing between the facts and the pixels holds state of its own — not that a page updates without a reload, which this harness has no database to demonstrate.

## Environment note

The pinned `@playwright/test` 1.62.1 expects a Chromium build (`chromium_headless_shell-1234`) that the execution image does not carry; the image ships 1194. The browser suite was run against `/opt/pw-browsers/chromium` via a local config override that changes nothing but the executable path. `playwright.config.ts` is untouched, and `pnpm test:e2e` will fail in this image until the versions agree.

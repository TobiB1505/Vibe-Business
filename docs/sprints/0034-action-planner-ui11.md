# ACTION PLANNER UI-1.1 — Density, Timeline & Scanability Pass

**Status: Complete.** UI-1 made the Action Plan visible for the first time. Dogfooding it against a real screenshot showed the intelligence was strong and the presentation was not: every step rendered title, actor chip, execution-support pill, full description, full purpose, full completion criteria and dependency prose all at once — five large, heavily bordered boxes reading as a technical report rather than a path. This pass is presentation only: scan first, expand second.

## Problem

The real dogfood screenshot showed the failure precisely. A founder opening the plan met five (now six, in the fixture used for this pass) fully-expanded step cards, each carrying every field the domain computes, with no visual distinction between what to read first and what to read only if curious. "Start Here" repeated the first actionable step's full detail, and the timeline repeated it again immediately below — the same content twice before a founder had read anything new. Nothing was wrong; too much was visible.

## What did not change

Per the brief's explicit boundaries, none of the following were touched:

- CORE-2b's reasoning, prompt, rubric, or the planner contract
- `ActionPlanStep` / `ActionPlan` schema — same fields, same types
- `sourceConclusion` lineage
- the capability registry or `classify.ts`
- Rule 57 (model output still never controls execution classification)
- execution — still no "Let Vibe prepare this" or any other action button

Every field that existed before this pass still exists and is still reachable. Nothing was deleted; secondary content moved behind disclosure rather than being removed.

## Changes

- **Compact hero.** Goal stays visually dominant but shorter (`h4`, not the previous full-width headline). `Why Now` defaults to a two-line CSS clamp with a "More context" toggle — the full stored string is in the DOM at all times, so the toggle changes what a sighted reader sees without asking, not what exists. A restrained meta line (`planMetaSummary`) reads "6 steps · 1 founder decision", derived only from the plan's own steps.
- **Concise Start Here.** The prominent entry-point card now shows the step's title and one sentence (`description`) plus its responsibility statement — not its full purpose, completion criteria, or dependency prose. That detail lives once, in the step's own place in the timeline.
- **Vertical timeline.** Steps render inside a real `<ol>`/`<li>` (unchanged from UI-1) with a connecting line and a numbered dot marker between them — presentation only; the ordered-list semantics and dependency graph are exactly what CORE-2b computed.
- **Compact default step row.** Each collapsed step shows, in order: a responsibility pill, a sequence status ("Ready now" / "Waiting for step N: *title*"), the title, and one sentence — then a `Details` disclosure. Purpose, completion criteria, the full dependency list, and approval all moved behind it, each section rendered only when it has data.
- **Dependencies moved forward.** A blocked step's wait state is visible without opening anything: `stepSequenceStatus` names the blocking step by title ("Waiting for step 4: Submit the sitemap to Search Console"), not by a bare order number or `dependsOnStepId`.
- **A single responsibility statement per step**, replacing the old actor chip *and* execution-support pill shown side by side (the same fact, said twice). `RESPONSIBILITY_HEADLINES` is keyed by `ExecutionSupport` alone — the six values already carry the actor distinction — and `not_yet_supported` gets a second, disambiguating sublabel ("Not automated yet") so "Vibe's work" can never be misread as automatic.
- **Approval demoted to secondary metadata** inside `Details` ("Approval required before Vibe acts on this."), never a header-level pill.
- **Expected Outcome reframed** as "If this plan works" with a plain top-border separator rather than its own bordered `Surface` — the destination the plan is aimed at, not another box.
- **Reduced card nesting.** The whole ready-plan content — hero, Start Here, timeline, outcome, reasoning disclosure — now lives inside one shared `Surface`, with only Start Here (and, in the timeline, the current step's marker) taking a stronger visual treatment. Previously: a bordered box per step plus a bordered hero plus a bordered outcome plus a bordered Start Here — five-to-eight separate containers on one screen.
- **"Why Vibe planned this"** replaces "How Vibe reasoned about this" as the collapsed reasoning/evidence disclosure's label — same content (root problem, assumptions, evidence, validation notes), no internal ids.

## A real regression this pass caught in its own first fixture

UI-1's original E2E fixture put the founder-decision step at order 1 with no dependencies — which meant `firstActionableStep` and `steps[0]` were the *same* step, so the "not steps[0]" test could not actually have caught a screen that quietly defaulted to array position; it only looked like it was testing that. Fixing this pass's own test coverage meant fixing the fixture: order 1 ("Draft the search-facing copy") now depends on order 2 ("Decide which segment"), so the two genuinely diverge, and `firstActionableStep` / `planProgress` are now computed by the real `sequence.ts` functions rather than a hand-picked guess. This is the sharper version of the same lesson CORE-2b's own MINI VERIFICATION pass recorded: a fixture that happens to agree with the correct answer is not a test of it.

## Testing

- 10 new/updated unit tests in `view.test.ts` for `RESPONSIBILITY_HEADLINES` (every `ExecutionSupport` value covered, `not_yet_supported` never reads as automatic), `stepSequenceStatus` (ready/waiting/done, single vs. multi-dependency phrasing), and `planMetaSummary` (pluralization) — 22 tests total in the file.
- The E2E suite grew from 13 to 21 tests, covering: default-collapsed steps with purpose text genuinely absent until expanded, Details revealing purpose/done-when/dependencies/approval with empty sections absent, the Start-Here-does-not-duplicate-full-detail regression, the corrected not-`steps[0]` regression, every responsibility label distinguishable without an exposed enum, the full `whyNow` text intact through the expand toggle, and the existing no-fake-button / no-raw-enum / no-internal-id sweeps (now run after force-expanding every `Details` on the page, since a closed `<details>` still has its content in the DOM for a leak sweep to miss).

## Dogfood

No new paid Planner call. As recorded in UI-1's own doc, the live database holds no persisted plan (the CORE-2b dogfood ran through a non-persisting probe harness), so the same hand-authored fixture used for UI-1's E2E suite is the fixture this pass was designed and tested against — now corrected to make `firstActionableStep` genuinely diverge from array position, per above.

## Residuals

- No manual visual QA at 1440/1280/tablet/375 in an actual browser session — the layout reuses existing responsive primitives (`Surface`, `flex flex-wrap`) and the timeline's fixed-width dot/line was written to the same breakpoints, but this was not independently eyeballed at each width.
- The five-second / ten-second / premium-feel tests (§35, §36, §64) are judgment calls a human reading the rendered screen should make; nothing here can assert them automatically, and none was substituted with an automated proxy.

## Validation

Lint, typecheck, the full unit suite (**3791 tests**), production build, and the updated 21-test E2E suite (`e2e/action-plan-ui.spec.ts`) all green.

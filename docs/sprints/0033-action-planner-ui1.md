# ACTION PLANNER UI-1 — Planner Experience

**Status: Complete.** The Action Plan domain CORE-2b built has had no way to reach a screen since it shipped. This sprint gives it one: a trigger on `/moves`, a truthful loading state, a full plan view, and the honesty constraint the founder emphasized outside the formal brief — no button that implies Vibe can do something it cannot yet do.

## Goal

Turn the Action Plan CORE-2b already computes — an ordered path of 2–9 business actions for the current top Move, each with a server-derived `executionSupport` — into something a founder can actually read, trigger, and act on. No UI code makes a classification decision; every enum reaching the screen passes through a label map first.

## A structural finding before any component was written

Before writing a single route, `service.ts` and `operations/service.ts` were read directly rather than trusted from summary. `getActionPlanReadiness`, `resolveActionPlanIdentity`, `startActionPlanOperation`, `getLatestActionPlan` and `getOnboardingFirstMove` all key on `(projectId)` alone and internally resolve `defaultPlannedOpportunity` — rank 1, always, per §83's refusal to plan "whichever Move Vibe could most easily execute." There is no `opportunityId`-scoped read or start path anywhere in the backend.

The brief's suggested `/moves/[opportunityId]` deep-linkable route would therefore imply a selection capability that does not exist, and would silently misbehave the moment a project's rank-1 Move changed under a stale link. Per the brief's own instruction to stop and report a genuine structural finding rather than silently build around it: the Action Plan surface is scoped to the project's current Move instead, living directly on the existing `/moves` route rather than at a Move-specific URL. A "Plan this move" trigger, the loading state, and the full plan all render inline on `/moves`, below the ranked Move list they belong to. There is exactly one Action Plan a project can have at a time, and it always describes whatever the ranked list's own #1 entry currently is — so a second URL to name it would be a place with nothing else to distinguish it.

## Entry from Next Moves

`/moves` now renders two things in the same workspace section: the existing ranked Move list (`OpportunitiesPanel`, unchanged), and a new "Plan this move" block underneath it (`ActionPlanPanel`) that always describes the same Move the list's own #1 entry names. No second navigation item, no second route.

## Planning trigger

`plan-action.ts` mirrors `opportunities-action.ts` exactly: a Server Action that validates ownership, calls the already-complete `startActionPlanOperation`, and returns without waiting on the ~40s provider call. The only input is a project id the caller must already own — the Move, the audit, the conclusion, the model and the prompt are all resolved server-side. A `force` flag distinguishes the first plan from an explicit, paid replan; neither is ever triggered automatically (Rule 60).

## Lifecycle

Five states, matching the ones `OpportunitiesPanel` already established for the analogous flow:

- **No plan, not blocked** — a CTA naming the Move ("A step-by-step plan for *X* — what changes, who does each part, and where to start").
- **Blocked** — a `Notice` naming why and where to fix it. Every `ActionPlanBlockReason` routes somewhere real: the audit reasons to the business-audit route, the missing-profile reason to product understanding, and every Move-shaped reason (`move_missing`, `move_stale`, `planner_source_unresolved`) back to the Next Moves section on the same page.
- **Planning** — ambient copy only (`OPERATION_STAGE_LABELS.planning`, "Working out how to do this…"), no percentage, no step counter. A single ~40s inference call has no honest progress bar.
- **Ready** — the full plan (below).
- **Failed** — the typed failure message from `OPERATION_FAILURE_MESSAGES`, never a provider string. The existing CTA doubles as retry, exactly as `OpportunitiesPanel` already does.

A plan already in place stays visible during a replan rather than being hidden behind the loading notice — the same choice `OpportunitiesPanel` makes so a founder never sees a blank panel mid-refresh.

## Customer language boundary

`src/modules/action-plans/view.ts` is the one new presentation module. It is framework-free (no React import) and pure, so it is unit-tested without a DOM. Every enum a component might otherwise interpolate directly — `StepActor`, `ExecutionSupport`, `PlanStalenessReason`, `ActionPlanBlockReason` — reaches JSX only through this file or the schema's own `ACTOR_LABELS` / `EXECUTION_SUPPORT_LABELS` maps. No conclusion key, capability id, contract/planner/prompt/rubric version, provider or model name is ever rendered. An E2E test (`never leaks a raw enum value or an internal id into the page text`) sweeps the fully-expanded ready-plan page against both lists and asserts none of them appear as a substring anywhere.

## Start Here

The prominent entry-point card renders whatever `firstActionableStep` (the existing, already-tested `sequence.ts` function) actually returned — never `steps[0]`. The fixture used for E2E deliberately makes those two facts diverge: order 1 is a founder decision with no dependencies, order 3 is the Vibe-executable step, and the test that matters most in this sprint (`Start Here names the server-derived first actionable step, not steps[0]`) asserts the screen shows the decision, not an array-position default. A domain test already proved `firstActionableStep` picks correctly; only a browser proves the screen didn't quietly re-derive "first" as position 0 on its own.

Steps also carry their dependency state in plain language ("Waiting on: Submit the sitemap to Search Console") rather than as numbers, resolved by `stepDependencyTitles` from the plan's own `dependsOn` graph.

## Prepare vs. execute — the constraint the founder restated in their own words

No button on this screen claims Vibe will act. `vibe_prepares` renders as a neutral-toned `StatusPill` reading "Vibe works this out" — deliberately not mint, because mint is the design system's own action colour and this value must never be mistaken for an offer. `vibe_executes_now` (the one real registry match this system has) also carries no button: UI-1 does not build a Preparation trigger for either value, because the executor for `vibe_prepares` does not exist yet and building the UI ahead of it would be exactly the false affordance the founder asked not to ship. An E2E test (`never renders a fake execution affordance`) asserts no "Let Vibe prepare this", "Apply", "Execute", "Ship", "Deploy" or "Merge" control exists anywhere on the expanded ready-plan page, disclosure included.

## Unsupported automation

A `not_yet_supported` step (in the fixture: "Build a dedicated pricing page") stays in the plan, badge and all, rather than being filtered out. Hiding it would make the plan about what Vibe can automate rather than about the business — the same principle CORE-2b's own `classify.test.ts` pins as "the Stripe case."

## Onboarding integration

`getOnboardingFirstMove` is now called from onboarding's `first_move` state and, when a plan already exists, shows its first actionable step title plus actor/execution-support labels underneath the existing Move card. Every field involved is nullable by design and nothing here is a completion prerequisite — the "Go to your workspace" action is unchanged. In practice this branch rarely fires during a first-time run: a plan requires an explicit, paid "Plan this move" click that only exists on `/moves`, which onboarding hasn't reached yet. The wiring exists for whoever returns to onboarding after already having one, and deliberately does not add a second "Plan this move" entry point inside onboarding itself.

## Accessibility

Steps render as a real `<ol>`/`<li>` list (`Surface as="li"`). Every status is text-first — `StatusPill` and `StatusDot` never carry meaning by colour alone, per the existing design-system rule. The running and blocked states use `role="status"` (via `Surface`/`Notice`), so a screen reader announces them without an assertive interruption. The reasoning/evidence disclosure is a native `<details>`, keyboard-operable and requiring no client JS to function. One heading-outline fix was made during review: the "The full plan" list caption was demoted from an `<h4>` to a plain `MonoLabel` span, since each step already carries its own `<h4>` and a heading at the same depth as its own children was the wrong outline.

## Mobile

No new fixed-width layout was introduced; every new block reuses the existing `Surface`/`flex flex-wrap` primitives the rest of `/moves` already relies on for 375px. No manual device screenshot pass was run this phase — flagged honestly as a residual below rather than claimed.

## Dogfood

**No new dogfood was run**, per explicit instruction — the domain layer was already dogfooded in CORE-2b and MINI VERIFICATION. Querying the live database directly (`action_plans`, read-only) during this sprint found it holds **zero rows**: the CORE-2b dogfood ran through the `ai:dogfood-action-plan` probe harness against a real Anthropic call but a non-persisting store, the same pattern `ai:probe-audit-schema` uses elsewhere in this repo. There is therefore no real persisted plan to render as a fixture — the E2E fixtures in `action-plan-scenarios.ts` are hand-authored from the domain's own types instead, the same convention `scenarios.ts` and `audit-scenarios.ts` already use for their own states. They are written to exercise every `StepActor` / `ExecutionSupport` pairing at once, including `vibe_executes_now`, which the real dogfood never reached ("claimed `vibe_executes_now` on nothing").

## Residuals

- No manual visual QA at 1440/1280/tablet/375 — the design system's existing responsive primitives were reused rather than new layout introduced, but this was not independently verified in a browser at each width.
- No real end-to-end dogfood of this specific screen against a live project with a real persisted plan, because none exists yet in the production database (see above). The first one to be planned for real will be the first live render of this screen outside the fixture harness.
- Onboarding's plan summary is unreachable in a first-time run today, as explained above — worth revisiting once a path exists to plan a Move before finishing onboarding, if that is ever wanted.

## Validation

Lint, typecheck, the full unit suite (**3781 tests**), production build, and a new 13-test E2E suite (`e2e/action-plan-ui.spec.ts`) all green. 12 new unit tests cover `view.ts` in isolation.

## Next phase

The executor for `vibe_prepares` does not exist. That gap — a real Preparation trigger for Vibe's own plan steps, distinct from the existing `vibe_executes_now` capability-registry path — is reserved for a future Core sprint, exactly as the founder asked.

# 0133 — The profile that decorated

Date: 2026-09-03
Branch: `claude/agent-preview-diff-logic-sxj5uc`
Decisions: [ADR 0078](../decisions/0078-the-validation-profile-is-a-build-contract.md), [ADR 0079](../decisions/0079-the-founder-names-the-application.md)

## What this was for

Of four repositories connected to this product, one could be validated — and because `resolveExecutionValidation` asks `resolveValidationProfile`, one could run the coding agent at all. The founder's objection to a per-framework fix was the right one: a whitelist leads straight back to *the agent can't do anything*. So the profile became a contract about what Vibe can actually promise, rather than a list of names.

## The two findings the whole sprint rests on

**The framework gate changed no command.** `planValidationSteps({ packageManager, scripts })` takes no profile. It plans a locked install and then the repository's own `typecheck`, `test` and `build` scripts, re-read from the sandbox in each phase. `nextjs_node_v1` never ran `next build`; it ran `pnpm run build`. The gate narrowed admission without sharpening the claim — and admission is the half that decided whether an agent could run.

**Framework knowledge is load-bearing in exactly one place.** `previewServerCommand()` was hardwired to `node_modules/.bin/next dev`. There, Vibe issues the command itself, so it must know the framework or start nothing. Everywhere else the framework was decoration.

**And the gate was wrong in the permissive direction on a live project.** `planner-agent` declares `nextjs` from `frontend/package.json`, has no root manifest, reports `monorepo.detected: false` and `scripts.source: null` — and the resolver returned `supported` with `workspaceRoot: "."`. A run would have paid for a microVM and failed in `readPlan`. The repo-wide `frameworks` union is what made that possible, which is why the new detector reports frameworks **per manifest**.

The rule the founder chose — *what Vibe cannot check, Vibe does not build* — was not new. `orchestrator.ts` and `change-validation/execution.ts` both already refused; they refused ~$0.016–0.064 and 5.5 minutes too late. This sprint moved an existing refusal to free and immediate.

## Shipped, in five slices

**The evidence.** `detectors/build-targets.ts` reports, per manifest: a `build` script, the nearest lockfile with `inTargetDirectory`, `declaresWorkspaces`, this manifest's own frameworks, and Yarn's module linker. 25 targets with `truncated` (rule 27), `ANALYZER_VERSION` → `repo-intelligence-v5`. **Berry vs. Classic and PnP are decided by file *existence*, never content** — `.yarnrc.yml` can carry `npmAuthToken`, and rule 28 permits observing that such a file exists while forbidding reading it. No fetch, no YAML parser, no configuration copy in the process.

**The contract.** `node_build_v1` beside the historical `nextjs_node_v1`, which sixteen rows carry and nothing resolves — no alias, because reading an old pass under today's rules is what rule 65 exists to prevent. `validation_runs.workspace_root` recorded and hashed into `computeValidationIdentity`, so a pass says *what* passed and where.

**The dev-server table.** `PREVIEWABLE_VALIDATION_PROFILES` and `previewProfileFor(validationProfile)` deleted — that exhaustive `Record` *was* the coupling — replaced by an ordered table keyed on the chosen application's frameworks, most specific first, because a Next.js app also declares `react` and SvelteKit also declares `vite`. `next`, `nuxt`, `astro`; anything else gets no preview, and the copy says checking and merging still work.

**The package managers.** pnpm, npm, Yarn Berry, Bun as exhaustive `Record`s, so a new member is a compiler error rather than a silent `npm ci` in a Bun repository. Yarn Classic refused by name. `sandbox-policy-v6` with a fourth digest line rather than three edited ones.

**The question.** `repository_connections.workspace_root`, `selectValidationTarget`, a server action, and the screen — one button per candidate and no field.

## Four defects the slices uncovered, all real

**`workflow.ts` hardcoded `workspaceRoot: ""`.** Validation would have run in `frontend` while the agent ran in the root: nothing installed, `readPlan` fails, VM paid for. The value now travels on the spec's repository binding and is read from the spec, never re-resolved (rule 67).

**`provision.ts` parsed the package manager as `=== "npm" ? "npm" : "pnpm"`.** Harmless while only two existed; a `pnpm install` in a Yarn repository the moment a third did. It parses exhaustively and refuses now.

**`review/` was root-relative, and every test stayed green.** `RENDERABLE_PATTERNS` and `ROUTE_SEGMENT_PATTERN` anchor at the repository root, so for an application in `frontend/` **nothing matched**: every change classified `code`, no preview was ever recommended, `render-impact.ts` never ran — silently, correctly-looking, on every screen. The workspace prefix is stripped before the patterns apply, Vite's route directories were added, and `REVIEW_CLASSIFICATION_VERSION` → v4.

**`validation/test-support.ts` ended in `as unknown as`.** A new required field on the snapshot produced no compiler error there, so every profile test would have fallen into the `repository_analysis_outdated` arm and looked green. Removed in the same commit as the field, or the slice would have proved nothing.

## What the tests caught that reading did not

**A domain test found a store defect on its first run.** `chooseWorkspaceRoot` accepted an answer for a repository Vibe resolves on its own — inert today, and not inert later: a root stored for a single-application repository silently answers the question the day a second application appears, showing a choice its founder was never offered as one they made. Refused now as `no_choice_to_make`.

**Writing that test exposed a hole in the double.** `updateLiveConnection` asks PostgREST for `count: "exact"` and reads zero rows as "no live connection, or not this caller's". `fakeSupabase.update` dropped its options entirely, so `count` came back `undefined`, and every such refusal was reported as a **success**. The double models the write count now. A gate that fails open in a fake is a gate no test can defend.

**A read-count test caught a per-card regression.** `loadWorkspaceRoot` was being called once per prepared change; `execution/workspace.test.ts` already asserted that reads do not grow with the number of cards, and it went red immediately.

**Two of my own mistakes were caught by their own tests.** A `packageJson({})` fixture produces `"{}"`, which `parsePackageJson` rejects — five detector tests failed and a sixth passed vacuously until every fixture got a `name` and the escape test got a length guard. And `workspaceCwdFor` was written to filter `""` while the spec writes `"."`, producing `product/.`.

**One test of mine was incoherent and was replaced rather than adjusted**: it asserted a preview command names no `3000` while `PREVIEW_BUDGETS.port` *is* 3000. It now asserts the command names no port but Vibe's.

## Two things that were tried and rejected on the way

**A `SECURITY DEFINER` setter for the workspace root.** `lifecycle-authority.migration.ts` asserts that no definer function in `public` is reachable by `authenticated`, and records why the two that once were are gone rather than grandfathered. A column-level `grant update (workspace_root, workspace_root_chosen_at)` says the narrow thing with no new callable surface, and `detached_at` stays denied at the privilege layer. `security invoker` failed first, for the plainer reason that the caller has no UPDATE to lend.

**Formatting the touched files.** `pnpm format` on the paths this change edits rewrote hundreds of lines it had not edited, in `test-support.ts` and two page components — exactly what rule 84 exists to stop. The formatting was reverted and the semantic edits re-applied by hand onto the original text. The rule is not advisory; the repository is genuinely not written to one width.

## Deployed and verified

All four migrations applied through the Supabase MCP and **verified by reading the catalog back**, not by trusting four `success` replies: `validation_runs.workspace_root` present as `'.'::text | NO`, all six CHECK predicates verbatim, 16 rows at `.` and none null, `updatable_columns` on `repository_connections` exactly `workspace_root, workspace_root_chosen_at`, `detached_at` not writable, table-level grants still `INSERT, SELECT`. Advisors unchanged from baseline. Applied versions were repaired to match the filenames, so the next `db push` does not find them pending — the consequence [Sprint 0130](0130-the-browser-we-own.md) recorded.

Domain **7,668** across 445 files · SQL **311** across 23 · browser **484** · lint 0/0 · build green.

## The screen the bump made empty

Found by the founder asking a plain question — *"by a click, do you mean the repo scan?"* — and checking the answer rather than giving it from memory.

Yes: **"Scan my product again"** on *My Product*, which is the only thing that writes a fresh snapshot (`inspectRepository(..., { force: true })`) and is free work. But it was offered nowhere that a founder would be sent to it, and the v5 bump is exactly what makes that state universal.

`repository_analysis_outdated` refuses **before** a step resolves agentic. So `agenticStep` is null, `AgentReadyStage` gets no `startAction`, and its call-to-action block renders nothing at all — under a hero still reading *"Vibe understands your product, code and goals."* The recovery link existed and could not help: `startRefusalRecovery` did not cover this reason, and it renders inside `AgentStartAction`, which needs the button that is not there. *My Product* was no help either — a stale-but-successful snapshot renders "Your code" as **ready**.

The same shape as the application question, one refusal over: a question rendered as a dead end. Fixed the same way — the sentence from `EXECUTION_REASON_LABELS`, the note from `startRefusalRecovery`, so the pre-click and post-click paths cannot drift, and a browser test for a state whose whole defect was that the screen was empty.

**A false claim was corrected on the way.** `startRefusalRecovery`'s docblock said a scan *costs Credits*; `kill-switch.ts` files `product_scan` under free work, `start-limits.ts` under `FREE_WORK`, and `launch-v1` prices understanding at zero. Rule 60 still holds and the reason is better: Vibe does not re-read a founder's code on its own because it is theirs, not because of a bill. A note implying a charge makes a free way forward look like one nobody should take.

## What this does not prove

**Nothing has been dogfooded.** That is the layer this stage exists for and none of the above substitutes for it. Urlaubsplanung should become validatable and is the first real agent run against a non-Next.js repository; `planner-agent` must show the application question or a concrete refusal and **must not provision a VM**; Jandia-Arena decides whether `execution-contract/README.md`'s "no validation profile matches" sentence is repaired or retired.

**Every stored snapshot is stale exactly once.** `ANALYZER_VERSION` v5 means `repository_snapshot_stale` blocks admission until each project is re-analyzed, and rule 60 forbids Vibe from starting that itself. Four projects, four founder clicks, before anything runs.

**Vite has no dev-server row**, deliberately. Vite ≥ 5.4.12 and Astro 5 refuse requests whose `Host` is not in `server.allowedHosts`, and the health probe reaches the server over loopback — so it *passes* while the customer's public URL answers "Blocked request." Astro ships anyway and is checked in the same dogfood; Vite waits for the answer rather than for an argument.

**A Vite repository is now agent-eligible with zero deterministic capabilities.** Those remain Next.js-only, so SEO work in such a repository goes to the paid agent rather than to the free generator. Named rather than discovered later.

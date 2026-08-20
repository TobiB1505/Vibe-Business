# Sprint 0047 — Risk-Adaptive Independent Validation v1

**Validation depth only. No change to what validation proves, only to how much
of it runs. No paid agent run, no PR, no merge.**

## PART A — the current validation path, traced

```
Prepared Change (status "prepared", commit_sha set)
  │
  ▼  validateChangeAction  →  startChangeValidation  →  VercelWorkflowExecutor
  │
changeValidationWorkflow(operationId)          operations/change-validation/workflow.ts
  │
  ├─ prepareValidation      → prepareValidationStep      execution.ts:271
  │     ├─ getPreparedChange                  the artifact under test
  │     ├─ getLatestSuccessfulSnapshot        repository *shape* only
  │     ├─ resolveValidationProfile(snapshot) validation/profile.ts
  │     │      → { profile: "nextjs_node_v1", packageManager, workspaceRoot }
  │     ├─ computeValidationIdentity(...)     validation/identity.ts
  │     └─ claimValidationRun(...)            validation/store.ts → validation_runs
  │
  ├─ provisionSandbox       → fresh microVM, pinned to prepared_commit_sha
  ├─ verifySource           → SHA + changed files + build identity   ◀── GUARANTEES
  │
  ├─ installDependencies    → runPhaseStep(…, "install")   ┐
  ├─ typecheckChange        → runPhaseStep(…, "typecheck") │ one durable step
  ├─ testChange             → runPhaseStep(…, "test")      │ each, fail-fast
  ├─ buildChange            → runPhaseStep(…, "build")     ┘
  │        └─ runCheckPhase → readPlan(package.json scripts)
  │                         → planValidationSteps           validation/commands.ts
  │                         → sandbox.runCommand
  │
  ├─ cleanupSandbox         → unconditional, even after a throw
  ├─ finalizeValidation     → verdict + steps persisted on validation_runs
  └─ finishValidation
```

### Where each thing lives, before this sprint

| Question | Answer |
|---|---|
| Current profiles | Exactly one: `nextjs_node_v1` (`VALIDATION_PROFILES`) |
| Where `riskClass` enters | **Nowhere.** It exists on `ExecutionSpec` and drives agent verification, but the validation path never reads it |
| Where checks are defined | `planValidationSteps` (`validation/commands.ts`) — always all four, gated only by which `package.json` scripts exist |
| Where commands execute | `runCheckPhase` (`validation/orchestrator.ts`), one phase per durable step |
| Where status persists | `validation_runs` via `validation/store.ts`; per-phase results in the `steps` jsonb |
| Where the UI reads it | `buildValidationSummary` → `validation/view.ts` → `validation-panel.tsx` |

### The finding

`resolveValidationProfile` reads the repository's **shape** — framework,
package manager, workspace layout — and nothing about the *change*. The
profile answers "can Vibe validate this repository at all?", never "how much
validation does this particular change deserve?". Those are two different
questions, and only the first one had an answer.

So an SEO metadata change and a billing change run the identical four steps,
because nothing in the path has ever consulted `riskClass`, `changeKind`,
`evidenceIds`, or the changed paths.

### The two axes, kept separate

This sprint does **not** add a second validation system, and specifically does
not add a second profile. It adds a second, orthogonal axis:

```
ValidationProfile   "which commands does this repository understand?"   ← shape
ValidationDepth     "how many of them does this change deserve?"        ← risk
```

`nextjs_node_v1` stays the only profile. `FAST` / `STANDARD` / `DEEP` select a
**subset of that profile's own steps** — they never introduce a command the
profile does not already define.

## What this sprint changes

- `src/modules/validation/depth.ts` — new, pure, deterministic. No AI, no
  commit-message reading, no agent output.
- `computeValidationIdentity` gains the depth and its policy version, so a
  `FAST` pass can never be reused as though it were a `DEEP` one.
- `prepareValidationStep` resolves the depth and persists it.
- `runPhaseStep` records a step outside the depth as `skipped` with the
  existing `not_in_profile` reason, rather than running it.
- `validation_runs` gains three columns; the UI shows the depth and why.

## What this sprint does not change

`verifySource` runs identically at every depth: exact SHA pinning, fresh
sandbox, changed-file verification, build-identity verification. Those are not
depth-adjustable and the code path does not reach them. Human approval,
`validated SHA == merged SHA`, and every precondition in
`EXECUTION_PRECONDITIONS` are untouched.

## PART I — the historical runs, and what the benchmark caught

Simulated in `src/modules/validation/depth-benchmark.test.ts` against the rows
those runs actually wrote — `execution_specs.risk_class`,
`action_plan_steps.change_kind` / `evidence_ids`, and the path list inside
`prepared_changes.files`. No historical record was modified, and none is read at
test time: the rows are the source of the fixtures, and the fixtures are frozen
in the file so a later schema change cannot silently rewrite the claim.

| Run | Change | Verified changed paths | Depth | Why |
|---|---|---|---|---|
| #6 | robots meta directives | 2 layouts | `fast` | presentational intent *and* presentational-confined artifact |
| #7 | canonical URLs | 8 pages, incl. `login`/`signup` | `deep` | `sensitive_domain_changed` → `auth` |
| #8 | primary CTA copy | `src/app/page.tsx` + 2 e2e specs | `standard` | a change touching tests must run the test step |

Run #7 is not a false escalation. The change is SEO metadata, but
`src/app/login/page.tsx` renders the sign-in surface, and a policy that skipped
the build on that file would be reading the *intent* while ignoring the
*artifact*. It costs nothing relative to today, where every run is already
validated in full.

**The benchmark caught two defects in the first draft**, which is why it is
checked in rather than run once:

1. `presentational_low_risk` was **unreachable**. It required
   `riskClass !== "moderate"`, but `classifyExecutionRisk` returns `low` only
   for a non-mutating change kind — already caught one branch earlier by
   `no_code_change`. Every real product change is `moderate` or above, so no run
   could ever have been `fast` and the whole depth axis would have been inert.
   The replacement guard reads the artifact instead: every changed path must be
   a file whose contents can only affect rendered output (`.tsx` under
   `src/app` excluding `api/`, `.tsx` under `src/components`, or a stylesheet).
   `.ts` is excluded on purpose — under the App Router that single character
   separates route handlers, server actions and library modules from components.
2. Run #8 was `deep` because `e2e/auth.spec.ts` matched the auth path rule. A
   Playwright spec is not an authentication flow and cannot put a flaw into the
   product. Test files are now held out of the sensitive-domain scan — and, in
   the opposite direction, held out of the presentational set too, so a change
   touching a test can never skip the test step.

## PART K — the saving, measured and projected, kept apart

Measured, from `validation_runs.steps` for these same commits:

| Step | Duration |
|---|---|
| `install` | 13.0s |
| `typecheck` | 87.1s |
| `test` | 87.0s |
| `build` | 111.6s |
| **total phase time** | **298.6s** |

Projected, from those measurements: run #6 at `fast` executes `install` +
`typecheck` = **100.1s**, a 66% reduction — on one run of three. Runs #7 and #8
are unchanged.

**No depth-selected validation has executed yet.** The step durations are
measured; the saving is arithmetic on top of them. Validation is not yet
"faster" and this sprint does not claim it is.

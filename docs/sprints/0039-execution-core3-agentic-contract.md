# EXECUTION CORE-3 — Agentic Execution Contract

Status: implemented, not merged. No agent, no model call, no provider spend, no UI change. Both migrations **deployed and verified against real Postgres** via the Supabase MCP.

The hard contract that will sit between the Action Planner and the future Coding Agent.

---

## Why now

Three things became true at once.

The **Planner** can now produce a specific, ordered, dependency-aware plan for one Move — real steps like *"build a working login connected to the actual calendar"*, not consulting bullets.

**Billing Core-2** can hold and settle variable spend, so a run whose cost is not knowable in advance is no longer economically unmodellable.

And **deterministic execution safety** is finished: prepared changes bound to an exact base SHA, sandbox validation, before/after review, approvals bound to immutable artifacts, and a fast-forward-or-refuse merge.

What is missing is the thing in between. Vibe has exactly one deterministic capability, and real plans overwhelmingly ask for work it cannot name in advance. This sprint builds the contract that lets a bounded agent close that gap without any of the safety architecture becoming advisory.

## Key principle

> **AI decides how. Vibe decides whether, where, what, how much, when to stop, and what must pass.**

## Branch / Base

Branch `claude/execution-core-3-contract-nmb83x`, created from `origin/main` at `0ac2bd4` — the Billing Core-2 merge.

## Preconditions verified

- **Billing Core-2 merged** at `0ac2bd4` (PR #53), with the two follow-up fixes `774403a` and `e2fce95` before it. Stripe/Credits work present: `credits/retail.ts`, `credits/lots.ts`, `credits/operation-billing.ts`, `billing/stripe/`, and migrations `20260817180000_billing_credits_core.sql` / `20260818120000_billing_credits_stripe_entitlements.sql`.
- Working tree clean, branch level with `origin/main`, no foreign work.
- 37 existing migrations; local history is the source of truth (rule 34).

---

## Current execution architecture, as it actually is

Mapped before writing anything, because the sprint's first instruction is not to build a parallel system where a primitive already exists.

```
Audit → Opportunity (Move) → ActionPlan → ActionPlanStep
                                            │
                     capability-registry.ts │  server-owned, structured evidence only
                                            ▼
                                  executionSupport + capability
                                            │
   execution/preflight.ts  ← revalidates the premise against live GitHub + live site
                                            ▼
                                     PreparedChange        base SHA pinned, branch derived from an identity hash
                                            ▼
                                     ValidationRun         Vercel sandbox, one profile, versioned policy
                                            ▼
                                     PreviewSession        the validated filesystem, restored
                                            ▼
                                     ReviewArtifact        before/after capture
                                            ▼
                                     ChangeApproval        one human, one exact commit, identity-hashed
                                            ▼
                                     ChangeMerge           fast-forward or refuse, read back independently
                                            ▼
                                     OutcomeVerification / BusinessMeasurement
```

Everything above runs as an `OperationRun` under the durable workflow layer, with the service-role client and ownership taken from the persisted row.

**What was reused rather than rebuilt:** `matchCapability` (the registry itself), `resolveValidationProfile` and `SANDBOX_POLICY_VERSION`, `isSensitivePath` from repository-intelligence's path policy, the credits reservation lifecycle, `audit_events`, the identity-hash pattern from approvals and execution, `FakeDatabase` and `checkedValues` for tests, and the whole PreparedChange → merge pipeline as the destination for agent output.

**What did not exist and had to be built:** an execution authority independent of the Planner, an execution mode vocabulary, a risk model, a compiled tool policy, an immutable spec, a budget contract, an interrupt contract, and the acceptance gate an agent's file set must pass.

## Resolver modes

| Mode | Means |
| --- | --- |
| `deterministic` | An existing registry-backed capability handles this |
| `agentic` | Inside the bounded V1 boundary and otherwise unobstructed |
| `needs_user_input` | A founder decision this rests on has not been made |
| `blocked` | Something in front of it is unfinished, or someone outside must act |
| `manual` | Genuinely the customer's own work |
| `unsupported` | Vibe understands it and has no safe route today |

**The Planner is not the authority.** The resolver does not read `executionSupport` or `capability` at all — not as a hint, not as a cross-check. It re-derives from the current registry, the current snapshot and the current validation profile. `real-plan-dogfood.test.ts` asserts that inverting every Planner claim on the real plan produces a byte-identical resolution.

**Mode is classification; admission is a separate question.** A mode says what kind of route a step needs. Whether it may start *now* is asked against live HEAD, snapshot currency, plan currency and money — re-read at the moment of asking. An unread HEAD is unknown, and unknown is a refusal.

**`intrinsicMode`** records what a blocked step would resolve to with nothing in front of it. It is a forecast, never an admission: `isAgentReady` reads `mode`, never it.

## Deterministic-vs-agentic precedence

Deterministic first, always. Cheaper, predictable, already validated, no model variance. A step that matches the registry *and* fits the agentic shape resolves deterministic — asserted directly.

## ExecutionSpec

Identity, objective, business context, repository binding, mode/class/risk, compiled policy, validation requirement, budget, credit binding, interrupt rules, stop conditions, freshness checks, and four version stamps.

**Immutable by identity.** The identity hashes project, plan, step, base SHA, snapshot, mode, class, risk, capability, a business-context hash and every policy version. Change any and the answer is a *new* spec. The timestamp and the reservation are deliberately absent — two resolutions of an unchanged world are the same spec, and money is bound at admission.

`execution_specs` rejects every UPDATE and DELETE at the database level and has no insert policy at all.

**Only executable modes can be a spec.** `buildExecutionSpec` throws for `blocked`, `needs_user_input`, `manual` and `unsupported`, and the SQL CHECK permits only `deterministic` and `agentic`. A missing decision produces no spec ready to run, structurally.

## Policy model

Default deny. An ability exists only if explicitly granted; an unknown request is refused rather than reasoned about.

**Globally forbidden, subtracted from every grant list and refused independently by the predicate:** `git_write_default_branch`, `git_force_push`, `git_merge`, `git_push_branch`, `deploy`, `secret_read`, `external_side_effect`, `database_write`.

`git_push_branch` is on that list deliberately. Rule 57 says model output must never control repository paths, refs, branch names or commit messages, and `execution/github-writer.ts` already derives all four deterministically. An agent hands Vibe a file set; Vibe writes the branch.

**Granted for an application code change:** list, search, read; write and delete inside the isolated workspace; run the profile's validation commands. Nothing else. No network (`{ mode: "none" }`), no secrets (`{ mode: "unavailable" }`), no external side effects.

**Write scope** is layered: discovery is generous within a budget because an agent cannot know which files it must change before looking; mutation is bounded by changed-file count, diff size and forbidden path classes. Forbidden paths delegate credential material to the existing `isSensitivePath` and add CI/CD definitions, git internals and dependency output — all segment- and prefix-anchored, so `src/lib/github-workflows.ts` is untouched.

## Risk model

Four categorical classes, derived from `changeKind` and cited evidence ids only — never prose.

| | |
| --- | --- |
| `low` | Nothing outside Vibe changes |
| `moderate` | A real change to product behaviour — the V1 ceiling |
| `high` | Authentication/session surfaces, or external setup |
| `prohibited` | Payments and billing |

Evidence ids are safe to read because they are ours: `repo.surface.*` and `live.surface.*` are minted by deterministic detectors, and the planner is validated to cite only ids that exist in the pack. A model chooses which of our ids to cite; it cannot invent one.

**Corrected during the dogfood:** risk is a statement about *consequence*, not subject matter. Step 1 of the real plan — *"lay out the access options for staff"* — cites `repo.surface.authentication` because that is what it reasons about, and was being classified `high`. It writes nothing. The escalations now apply only to change kinds that actually mutate something, and the gate that consults risk requires `product_change` anyway.

## Agentic V1 eligibility boundary

`actor: vibe` · `changeKind: product_change` · no deterministic capability matched · risk ≤ moderate · repository connected · snapshot present · a real validation profile matches.

Conservative on purpose. Auth rewrites, payment architecture, destructive migrations and new third-party integrations are all understood and all refused.

## Validation contract

Derived from `resolveValidationProfile`, the same function change validation already uses — not declared. A repository with no matching profile yields `validation_not_supported`, and eligibility refuses: if a change cannot be independently validated, the only remaining evidence is the agent's own claim, and §31 says that is not authority.

Preconditions are unconditional in both branches: source revision verified, no forbidden paths changed, diff within policy, no secret material introduced. Authority is a single-valued type, `vibe_observed`, so "the agent reported success" is not representable.

## Budget binding

`ExecutionBudget` carries a Credit ceiling plus AI calls, agent turns, repair attempts, wall clock, sandbox time, changed files, changed bytes and network requests.

**No approved policy ships.** `EXECUTION_BUDGET_POLICIES` is empty, matching `credits/retail.ts`, which prices no agentic operation, and `credits/rating.ts`, which ships no rate card. Vibe has never run an agent; a number chosen today would be a guess baked into every spec produced before the first real dogfood corrected it. Admission refuses with `agentic_pricing_not_configured`.

Admission requires an **active** reservation whose held Credits cover the whole ceiling. A run needing more pauses with `additional_credits_required`; there is no path past the approved number.

## User interrupts and stop conditions

Eight interrupt situations, each with Vibe-authored copy — a model may select a situation, never phrase the product's question. Answers are structured and become keyed approved decisions that the next resolution reads and the next spec hashes, so a changed answer produces a new spec.

Eight structural stop reasons, all observable by Vibe without asking the model. There is no free-text field on an interrupt and no `reasoning`, `thinking`, `rationale` or `transcript` anywhere — asserted by a test.

## ProposedChange bridge

An agent produces a file set. `acceptProposedChange` checks paths against the compiled scope, counts the files, measures the diff and reads the content for credential material — because a path check alone passes a key pasted into `src/config.ts`. Every rejection is collected, not short-circuited, so a repair loop does not burn budget rediscovering the next one.

If it passes, the existing change-preparation machinery writes the branch. No second pipeline; merge safety untouched.

## Activity events

Ten customer-safe states with a payload type that has **no message field** — counts, paths and Vibe-constructed commands only. A schema that cannot express a sentence cannot leak a reasoning trace. Nothing renders them yet (§40); no table exists, because no writer does.

---

## Real Action Plan dogfood

Plan `82767dd4` for project *Jandia-Arena*, produced by the CORE-2b dogfood and read live from the Vibe Business Supabase project. Repository `TobiB1505/Jandia-Arena` at `5b76b2a3`: FastAPI + React, package manager undetected. No Planner call, no provider spend, nothing written.

```
#   planner says       depends  resolved     if unblocked      risk      agent-ready?              why
1   vibe_prepares      —        unsupported  —                 low       no — not_executable_mode  no_executor_for_vibe_work
2   founder_decides    1        blocked      needs_user_input  low       no — not_executable_mode  dependency_unsatisfied
3   not_yet_supported  2        blocked      unsupported       high      no — not_executable_mode  dependency_unsatisfied
4   not_yet_supported  3        blocked      unsupported       high      no — not_executable_mode  dependency_unsatisfied
5   founder_acts       4        blocked      manual            low       no — not_executable_mode  dependency_unsatisfied

unmet: 3,4 → risk_class_not_permitted, validation_profile_unsupported
No step on this plan can be executed by Vibe right now.
```

1. *Lay out the access options for resort staff and managers* — Vibe's own analysis work. No executor produces a written comparison on a click.
2. *Decide how staff and managers will sign in* — the founder's, and blocked behind step 1 regardless.
3. *Build a working login connected to the actual calendar and request tool* — blocked, and high risk underneath: a login flow is outside the V1 boundary.
4. *Put a visible way in on the homepage* — blocked behind 3, still auth-adjacent.
5. *Confirm a staff member can get from the homepage into the calendar* — a person has to do this.

**The finding that matters most is about the project, not the plan.** Even with every prerequisite marked complete and a fixture budget authorized, steps 3 and 4 resolve `unsupported`: a FastAPI + React repository with no detected package manager matches no validation profile, so Vibe could never independently prove a change to it builds. A product that would happily point an agent at it would be a product whose green tick meant nothing.

This is committed as a fixture test as well as a live probe, so a future change to the risk model, the registry or the eligibility gates that quietly started offering to build a login flow fails in CI.

## Security verification (§54)

Every line is an executable assertion in `security.test.ts`.

| Claim | How |
| --- | --- |
| Planner cannot grant execution authority | Identical structured facts + opposite Planner claims → identical resolution |
| Client cannot forge mode / SHA / policy / budget | `execution_specs` has a select policy and nothing else |
| Stored spec cannot be altered | `before update or delete` trigger raises; no update policy |
| Client cannot expand tool policy | Compiled from the resolved mode; forbidden set subtracted and refused independently |
| Client cannot raise its own ceiling | Admission compares the reservation against the spec's maximum |
| Client cannot disable validation | Requirement derived from the snapshot |
| Blocked cannot become ready | Dependency check precedes the mode, and no spec can be built |
| No secret values persist | No field exists; serialized spec matched against credential patterns |
| Default-branch write outside agent permission | Globally forbidden, twice |
| Merge remains the existing approved path | No file in the module imports `@/modules/merge` |
| No coding agent introduced | No agent SDK in `package.json`; no AI import in the module |

## Tests

**150 new tests across 12 files**, all in the standard suite (4308 total, up from 4158 on `main`):

`resolver.test.ts` (§41–§46, §52) · `policy.test.ts` (§15, §17, §18, §50, §51) · `spec.test.ts` (§9–§11, §47, §48) · `budget.test.ts` (§24–§26, §49) · `freshness.test.ts` (§29, §52) · `validation-requirements.test.ts` (§30, §31, §53) · `interrupts.test.ts` (§21–§23, §34) · `proposed-change.test.ts` (§31, §32) · `schema.test.ts` (SQL/TS agreement, §5 copy) · `store.test.ts` (§10, §35, §55) · `security.test.ts` (§54) · `real-plan-dogfood.test.ts` (§38, §39).

## Quality gate

| | |
| --- | --- |
| `pnpm lint` | clean — 0 errors, 9 pre-existing warnings, all on files this branch does not touch |
| `pnpm typecheck` | clean |
| `pnpm test` | **4308 passed** (225 files), up from 4158 on `main` |
| `pnpm build` | clean |
| `pnpm test:e2e` | **283 passed** |
| `pnpm db:status` | cannot run — no linked Supabase project; deployment went through the Supabase MCP instead |

The E2E suite initially failed 283/283 on this branch **and identically on `origin/main`**, which is what identified it as environmental rather than a regression: the pinned `@playwright/test` 1.62.1 looks for a headless-shell build the sandbox image does not carry. Aliasing the pre-installed browser into the expected path made the whole suite pass on both. No repository file was changed to achieve that, and `playwright.config.ts` is untouched.

## Migration status

**Deployed and verified against real Postgres.**

The Supabase CLI could not be used — `pnpm db:status` reports `LegacyProjectNotLinkedError` and no access token exists in this environment — so deployment went through the Supabase MCP's `apply_migration`, which registers in the same `supabase_migrations` ledger the CLI reads. This is not the SQL Editor copy/paste that rule 29 forbids.

The project was confirmed rather than guessed (rules 32, 33): `list_projects` returned exactly one, `dcbwlctscooefwnivxzv` / **Vibe-Business**, matching the ref derived from `NEXT_PUBLIC_SUPABASE_URL`. Migration history was inspected first (rule 30) — 37 rows, all matching local files, no `execution_specs`.

| Version | Name |
| --- | --- |
| `20260818131106` | `execution_specs` |
| `20260818131334` | `execution_spec_guard_security_invoker` |

Local filenames were renamed to the versions the management API stamped, so `db:status` reconciles rather than reporting them unapplied. (The pre-existing billing migration still carries the same drift, `20260818120000` local vs `20260818090300` remote; not touched — it is not this sprint's change.)

### The advisor caught something real

`get_advisors --type security`, run immediately after the first deploy, found a finding **this sprint introduced**:

> Function `public.reject_execution_spec_mutation()` can be executed by the `anon` role as a `SECURITY DEFINER` function via `/rest/v1/rpc/`.

`security definer` had been copied from the shape of the schema's existing privileged helpers without asking what privilege the function needs. The answer is none — it takes no arguments, reads nothing, writes nothing and does exactly one thing: raise. A `before update or delete` trigger fires regardless of the function's security context, so the elevation bought nothing and left a `SECURITY DEFINER` function reachable by `anon`.

Fixed forward in `20260818131334`: `security invoker`, plus `revoke execute` from `public`, `anon` and `authenticated`. Both findings are gone. A test now pins the posture by reading the *newest* definition across the migration history, so a future `create or replace` cannot quietly re-elevate it.

Four advisor findings remain, all pre-dating this branch and none introduced here: `billing_stripe_events` has RLS with no policy, `set_updated_at` has a mutable `search_path`, `rls_auto_enable` is an `anon`-callable `SECURITY DEFINER` function, and leaked-password protection is off. Out of scope, recorded rather than fixed.

### Verified behaviourally, not just structurally

The residual this sprint originally carried — *the trigger and RLS policy have never been exercised against Postgres* — is closed. Both check runs inserted a genuine row against this project's real plan, audit, connection and snapshot inside a transaction that was then aborted, so **nothing was left in the production database** (`rows_remaining = 0`, confirmed by an independent read).

| Check | Result |
| --- | --- |
| Table, RLS on, exactly one policy (`SELECT` only), 1 trigger, 4 indexes | ✅ |
| Valid agentic insert | ✅ |
| `UPDATE` refused | ✅ `23001` |
| `DELETE` refused | ✅ `23001` |
| Duplicate `spec_identity` refused | ✅ `23505` |
| Agentic row also naming a capability refused | ✅ `23514` |
| `mode = 'blocked'` not storable | ✅ `23514` |
| Truncated `base_sha` refused | ✅ `23514` |
| Guard still blocks after the security fix; `prosecdef = false`; `anon`/`authenticated` cannot execute | ✅ |

Its CHECK constraints are asserted against the TypeScript unions by `schema.test.ts` reading the migration history, and its unique index and mode/authority constraint are modelled in `FakeDatabase` — because the in-memory database evaluates neither, and this project has been bitten by that twice.

## Deferred to Execution Core-4

- coding-agent provider interface
- Claude Agent SDK first adapter
- sandbox tool runtime
- file / search / edit / command tools
- the agent loop
- repair loops
- real usage metering
- Billing settlement
- the first real agent dogfood
- `execution_interrupts` and activity-event persistence, once writers exist
- an approved `ExecutionBudget` policy and an agentic retail price
- the Planner → Execution UI

## Residuals

- **No production writer.** `createExecutionSpec` is tested and called by nothing in the product. Core-4 supplies the caller.
- **The live HEAD is not probed in the dogfood.** It would need an installation token in a dev harness; unread is modelled as unknown, and admission refuses accordingly.
- **The V1 execution class is one entry.** That is honest today and will need a structured routing signal before it becomes two.

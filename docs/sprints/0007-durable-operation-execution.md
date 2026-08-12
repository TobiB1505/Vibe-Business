# Sprint 7 — Durable operation execution

Status: Complete. Merged as [#18](https://github.com/TobiB1505/Vibe-Business/pull/18), migration deployed, and dogfooded in production on 2026-08-12 — see [Dogfood result](#dogfood-result).
Branch: `feat/durable-operation-execution`

## Goal

Take the Business Readiness Audit out of the browser request that starts it.

Before:

```
click → HTTP request held open → ~50s Anthropic call → response
```

After:

```
click → operation created → request returns (<1s) → workflow runs independently
      → UI shows status → user may leave or reload → result appears
```

## Measured motivation

Not hypothetical. The two real audits on the Vibe Business project itself:

| | First audit | Updated audit |
| --- | --- | --- |
| Latency | 53.8s | 49.4s |

Fifty seconds is longer than a user will hold a tab still, longer than many mobile connections stay put, and close enough to platform function limits that the timeout — not the work — decides when the operation dies. Raising `maxDuration` buys minutes and postpones the question; it does not change the fact that a request is the wrong owner for this lifecycle.

## Durable execution architecture

```
Server action                    Durable run                  Supabase
─────────────                    ───────────                  ────────
startBusinessAudit()
  own project?
  resolve identity ───────────────────────────────────────── snapshots + context
  identical audit? ──── yes ──→ reuse, nothing spent ─────── business_readiness_audits
  identical run live? ─ yes ──→ return it ────────────────── operation_runs
  claim ──────────────────────────────────────────────────── operation_runs (unique index)
  executor.start(id) ──→ Vercel Workflow
  return DTO (<1s)
                                 prepare ────────────────── claim audit row
                                 count tokens ───────────── budget gate
                                 infer + validate + persist  audit, usage, events
                                 finish ─────────────────── operation completed
```

The only thing that crosses into the workflow is an **operation id**.

## Why Workflow rather than request-owned execution

Recorded in full as [ADR 0013](../decisions/0013-durable-operation-execution.md). Vercel Workflows was chosen because it is already part of the deployment platform, adds no new service to operate, and expresses steps as plain async TypeScript. Availability was checked before implementing: Workflows is available on Hobby and Pro, so there was no plan blocker to report.

Supabase stays canonical (§15). The workflow orchestrates; it never becomes the only place the application's state exists.

## OperationRun model

`status` is lifecycle, `stage` is progress, and they are deliberately separate — conflating them produces a "running" that means both "queued somewhere" and "currently billing a provider", which is exactly the distinction that decides whether a retry is safe.

| status | queued · running · completed · failed · cancelled |
| --- | --- |
| **stage** | preparing · counting_tokens · running_ai · validating · persisting · completed |

Both closed sets. No percentages: a four-step pipeline whose third step is ~50 seconds of inference has no honest percentage, and a bar sitting at 60% teaches people to distrust it.

`operation_runs` stores execution only. `business_readiness_audits` remains the canonical result store, and the operation points at it.

## Business Audit workflow

Four durable steps.

1. **prepare** — verify ownership, verify the evidence still matches the operation's identity, claim the audit row.
2. **count tokens** — a budget gate *before* the paid step. It counts the exact request the runner will send, and only fails when even the fully trimmed pack cannot fit.
3. **infer + validate + persist** — one step, deliberately.
4. **finish** — mark the operation complete and link the audit.

Steps 3–5 of the suggested split are one step on purpose. Splitting them would mean either the model's output crosses the durable boundary — which §14 forbids — or a validation failure re-enters a step that would call the provider again. One step means one billable call whose result is committed in the same unit of work.

## Idempotency and reuse

Reuse is checked before anything is created, in cost order: an identical completed audit ends the request without spending; an identical live operation is returned rather than duplicated.

Idempotency is enforced by constraints, not by hope:

| Risk | Guarantee |
| --- | --- |
| Two clicks → two workflows | Partial unique index on `(project_id, operation_type, input_identity)` where status is live |
| Two audits for one input | Existing partial unique index on in-flight audits |
| Duplicate usage events | New partial unique index on `ai_usage_events (job_id)` |
| Duplicate completion events | Terminal transitions report whether *this* call performed them; events are emitted only if so |
| Prepare re-entry | An operation that already has `audit_id` reuses it |

## Retry policy

The default is three retries on a thrown error. That is right for a database blip and catastrophic for a paid call, so the convention is: **expected failures are returned, never thrown.** Anything returned is by construction not retried — a provider auth error, a refusal, a budget rejection and a validation failure are outcomes, not exceptions.

On top of that, the inference step sets `maxRetries = 0`.

## Paid-call ambiguity policy

`inference_started_at` is written **before** the provider call and never cleared. A re-entry that finds it set, with no completed audit to show for it, knows the provider may already have been billed — and fails as `inference_interrupted` rather than calling again.

The UI does **not** offer a one-click retry for that code, and does not claim the call was free. We do not know whether it was.

## Workflow data minimization

Vercel Workflows records every step input and output in its event log, so what crosses a step boundary is a data-protection decision.

**Crosses:** an operation id, a token count, an audit id, a typed failure code.

**Never crosses:** evidence packs, prompts, model responses, reasoning, repository content, HTML, cookies, Deep Scan state, Browserbase URLs, GitHub credentials, `ANTHROPIC_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. Database and provider clients are constructed *inside* each step, never passed between them.

Steps rebuild what they need from Supabase on each entry. Rebuilding is deterministic — the same rows produce the same pack — so the cost is a few indexed reads.

## Supabase source-of-truth decision

Operation status, audit result, AI usage and audit events are all read from Supabase, never from the workflow platform. The status endpoint the UI polls reads our own table. The Vercel dashboard is for tracing, not for product state.

## UX

- **Idle** — "Run business audit".
- **Running** — the stage in words ("Preparing evidence", "Analyzing business", "Validating result") plus *"You can leave this page. Vibe will continue the analysis."*
- **Reload or return** — the project page discovers the live operation server-side and shows it running. It does not start anything.
- **Complete** — the existing Business Readiness UI.
- **Failed** — "Business audit couldn't complete" with safe copy, and "Try again" only where retrying is honest.
- **Stalled** — a run live for over ten minutes is reported as stalled, polling stops, and a deliberate new run is offered.

Polling is 3s, only while queued or running, and stops on every terminal state.

## Cost boundaries

Workflow usage (events, data written/retained) is infrastructure cost and is deliberately **not** mixed into `ai_usage_events`, which remains exact provider-cost accounting. No dollar figures for Workflow are fabricated; the platform's own dashboard reports them.

The audit itself costs what it did before — the execution model changed, the inference did not.

## Tests

1061 tests. New coverage: 21 service cases (creation, reuse, double-spend, ownership, reload discovery), 19 execution cases (happy path, re-entry, paid-call ambiguity, guards), 15 view cases (polling stops, retry honesty, DTO surface).

Four mutation checks confirm the guarantees are load-bearing rather than incidental:

| Mutation | Result |
| --- | --- |
| Remove the `operation_runs` unique index | Race test fails |
| Remove the application-level active check | Passes (constraint covers it) — so a test was added proving the check short-circuits before any insert |
| Remove the `inference_started_at` guard | Interrupted-call test fails |
| Remove the completed-audit short-circuit | Replay test fails with two provider calls |

No test starts a workflow or reaches Anthropic.

## Validation

`pnpm lint`, `pnpm typecheck`, `pnpm test` (1008 → 1061), `pnpm build` — all green.
`pnpm db:status` → exactly one pending migration → `pnpm db:push` → aligned → `pnpm db:lint` clean.
Verified on the remote database: `operation_runs` has RLS enabled with 4 policies and its partial unique index; `ai_usage_events` gained the job-idempotency index.

## Manual action

`SUPABASE_SERVICE_ROLE_KEY` must be present in the Vercel project (Production and Preview). It was added on 2026-08-12; without it workflow steps cannot reach the database, the run fails, and the UI reports that the audit could not complete.

## Known limitations

- **No reaper.** If the platform loses a durable run entirely, the operation row stays `running` until the UI's ten-minute stall threshold surfaces it. A scheduled sweep would be a cron, which §27 excludes.
- **No cancellation.** Once inference has started it cannot be honestly cancelled, and before that the window is seconds. No Cancel button is offered rather than one that sometimes lies.
- **The generated `/.well-known/workflow/v1/webhook/[token]` route exists** because the compiler emits it. Nothing in this codebase calls `createWebhook`, so no token exists to guess — but it is worth knowing it is there.
- **Two unbilled token counts per audit** in the rare over-budget case: the gate counts the full pack, then the trimmed floor. Token counting is free; reshaping the runner around the execution engine would not have been.
- **Not dogfooded end to end yet** — see below.

## Dogfood result

Run on production on 2026-08-12, operation `d2c2ddd9`, against genuinely new evidence (repository and live snapshots had both been refreshed, so the identity `c985cad4…` was new rather than forced).

| | |
| --- | --- |
| Operation runs created | **1** |
| Durable runs started | **1** (`vercel_workflow`) |
| Audits created | **1**, linked to the operation |
| AI usage events | **1** |
| Audit events | **4** — `operation.started`, `business_audit.started`, `business_audit.completed`, `operation.completed`, one each |
| Queue latency | 2.66s from claim to the first step marking the operation running |
| Total operation | 57.5s |
| Inference | 46.7s |
| Cost | $0.0677 (6,910 in / 5,388 out / 1,947 thinking) |
| Score | 41 / 100 |

The point of the sprint is the shape of those timings: the operation row was claimed at `00:50:04.72`, the audit row was not created until `00:50:07.99`, and the audit completed at `00:51:00.61`. Inference happened in a function invocation that started three seconds *after* the browser request was already over. The request no longer owns the lifecycle.

Every duplication guarantee held on real data: one operation, one audit, one usage event, one of each lifecycle event, `inference_started_at` set, and the operation pointing at the audit it produced. Across the whole ledger, 13 audits and 13 usage events — still exactly 1:1.

Not verified from the database, and worth confirming by hand next time: the client-side experience of navigating away mid-run and returning.

### Score context

41/100, against 34 (v1 evidence), 40 and 38 (v2, identical evidence). The 40/38 pair came from byte-identical evidence, so the spread across these runs is mostly run-to-run model variance, not signal. This one also saw refreshed repository and live snapshots, so it is not directly comparable to either.

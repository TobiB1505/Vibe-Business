# ADR 0013 — Durable operation execution

Status: Accepted
Date: 2026-08-12
Supersedes: nothing. Extends [ADR 0001](0001-modular-monolith.md) (modular monolith) and the Sprint 0/1 decision to run every query under RLS.

## Context

The first real Business Readiness Audit took **53.8 seconds** end to end, of which ~50 was one Anthropic call. It ran inside the browser request that started it.

That is measured, not hypothetical, and it makes request-owned execution the wrong abstraction for customer-facing work:

- the user cannot navigate away, reload, or lose connectivity without losing the run;
- the platform's function timeout, not the work, decides when the operation dies;
- the only lever is raising `maxDuration`, which buys minutes and postpones the problem.

Every operation Vibe Business will add next — opportunity generation, code changes, previews — is at least as long.

## Decision

### 1. Vercel Workflows is the initial durable execution provider

Chosen because it is already part of the platform the product deploys to, needs no new service, queue, or worker, and its programming model is plain async TypeScript rather than a state machine definition. Availability was verified on both Hobby and Pro before committing.

Rejected without prejudice: Redis/BullMQ, Inngest, Trigger.dev, Temporal, a custom worker. Each is a new operational surface, and none is justified before the first durable operation has run in production.

### 2. Supabase remains the canonical source of truth

The workflow platform orchestrates; it does not own product state. Operation status, audit results, AI usage and audit events all live in Supabase.

Two consequences we want: the project page can answer "is something running?" from its own database after a reload, and replacing the execution provider later is a code change rather than a data migration.

### 3. Paid external calls are never blindly retried

Durable systems retry by default — Workflow steps retry three times on a thrown error. That is right for a database blip and unacceptable for a billed inference call.

So:

- expected failures are **returned**, not thrown, and are therefore not retried by construction;
- the inference step sets `maxRetries = 0`;
- `inference_started_at` is written **before** the call and never cleared, so a re-entry can distinguish "not yet attempted" from "may already have been billed";
- ambiguity resolves to a failed operation, never to a second call.

The product would rather fail an operation than quietly double a bill.

### 4. The operation abstraction stays provider-independent

`OperationExecutor` has one method and takes one argument: an operation id. No provider selection, no second adapter, and no workflow vocabulary above `src/modules/operations/vercel/`. The Business Audit domain remains callable from a test with no workflow platform present.

### 5. Durable execution uses a service-role database client

**This is the consequential part of this ADR.**

Sprint 0 and Sprint 1 each recorded a deliberate decision *not* to introduce `SUPABASE_SERVICE_ROLE_KEY`: every query ran as the signed-in user, so RLS was always in force and there was nothing to bypass.

A workflow step has no cookies and no session. The alternatives were both worse:

| Option | Why not |
| --- | --- |
| Put the user's access token into workflow state | Persists a credential into a third-party durable log; expires mid-run |
| Mint user-impersonating JWTs from the project's signing secret | Strictly more dangerous — it forges identity |
| Call back into our own app over HTTP | Moves the credential problem without solving it |

So the key exists, and the protection it removes is re-established in code:

1. only `src/lib/supabase/service.ts` constructs it, and only `src/modules/operations/` imports that;
2. a workflow step receives an **operation id and nothing else** — it re-reads the row and takes `project_id`/`user_id` from there, so no caller can name someone else's;
3. every step re-verifies that the project's owner is still the operation's owner before doing any work;
4. the browser read path is unchanged and still runs under RLS.

The risk is real and is accepted knowingly: a bug in `src/modules/operations/` can now cross tenant boundaries in a way it previously could not. That is why the ownership check is a step, not a comment.

## Consequences

- A new required secret in production. Without it, workflow steps fail and operations stall.
- Workflow persists step inputs and outputs in its own event log, so what crosses a step boundary is a data-protection decision, not an ergonomic one. Only ids, a token count and a typed failure code do.
- The synchronous audit path is deleted rather than deprecated — a function that can spend money inside a request is not something to leave available.
- A lost durable run leaves an operation `running`. There is no reaper (that would be a scheduler, explicitly out of scope), so the UI treats a long-running operation as stalled and offers a deliberate new run.

## Alternatives considered

**Raise `maxDuration` and keep the request model.** Rejected: the measurement is the argument. A 50-second operation that must not be interrupted by a reload is not a request.

**Poll a provider API for status instead of storing it.** Rejected: it makes the vendor's dashboard the only place the application's state exists, and couples the UI to the execution provider.

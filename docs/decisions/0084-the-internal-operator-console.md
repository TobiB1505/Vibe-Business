# 0084 - The internal operator console reads across tenants, and shows shapes only

Status: Accepted
Date: 2026-09-04

Builds on [0013](0013-durable-operation-execution.md) (the operation rows this reads), [0024](0024-vibe-credits-economic-layer.md) and [0025](0025-stripe-payment-rail-and-credit-grants.md) (the spend it totals). Adds no table, no migration, no provider and no background technology.

## Context

This product measures almost everything it does. `operation_runs` records every durable operation's type, status, stage and failure code. `ai_usage_events`, `sandbox_usage_events` and `deep_scan_provider_usage` record what each of them cost, in the units the providers actually bill. `agent_execution_runs` carries roughly ninety observation columns per run.

**None of it has ever been displayed.** Fifty-six tables, thirteen of them written purely to record what happened, and no surface in the application reads any of them across projects. The operator's only view of a running system is the Supabase SQL editor and whatever query they can remember to write — which is not a view of a running system, it is an archaeology tool.

The [ROADMAP](../ROADMAP.md) already names the shape of this one layer over, about refunds: *"There is no admin surface of any kind."* That entry was about moving money and deliberately stayed open, because moving money needs an authorization model that is product work. **Reading is a different question**, and it is the one this decision answers.

## The four things that make this hard

**1. It is cross-tenant by construction.** The question "what is failing right now?" is not answerable within one customer's rows. RLS scopes every read to the caller, so a session-scoped client would show an operator their own two projects and nothing else — an answer to a question nobody asked.

**2. Rule 53 says a service-role query filters on ownership.** That rule exists because the service-role client bypasses RLS, and it is what stops one customer's data reaching another. A console that reads every row breaks it as stated. Either the rule gets an honest exception with its own reasoning, or the console cannot exist.

**3. Rule 24 forbids a further background technology.** A "live" feed suggests websockets, Supabase Realtime, a subscription transport. Every one of those is a second liveness mechanism beside Vercel Workflows, which rule 24 requires an ADR to introduce and whose argument to prefer is *"it needs no new infrastructure."*

**4. The tables are safe, but only because somebody kept them safe.** `ai_usage_events` holds no prompt text because rule 47 forbade it. `operation_runs` holds no prose at all. That is a property of the current schema, not a guarantee about the next column somebody adds — and a console that selects `*` inherits whatever arrives.

## Decision

A **read-only** internal console at `/app/internal`, with four properties.

### 1. Operator identity is an environment allowlist, not a role

`VIBE_INTERNAL_OPERATOR_USER_IDS` — comma-separated Supabase user ids. **Absent or empty means nobody**, which is the correct production default and the same shape [ADR 0027](0027-coding-agent-provider-and-tool-gateway.md)'s dogfood allowlist already uses (`coding-agent/authorization.ts`): an operator decision, read from the environment rather than the database, because nothing a customer can reach may write to it.

Not a database `role` column, and not a boolean flag. A flag is one row somebody can flip for everyone; an allowlist has to *name* what it admits, so the blast radius of a mistake is one account. A role column would be application state, which means a write path, which means a way to grant yourself the console.

The identity itself comes from the verified session (`getSession()`, which verifies the JWT signature — never `getSession()` on the raw cookie), and **it is re-checked on every request, including every poll.** Authorization is never inherited from the render that produced the page.

A non-operator gets `notFound()`, not a refusal. A 403 confirms the route exists.

### 2. The rule 53 exception, stated precisely

The console uses the service-role client and does **not** filter on ownership. That is the whole point of it, so the exception is written down rather than reasoned around each time:

> Rule 53's requirement is that ownership is never taken **from the caller's arguments**. The console satisfies that requirement's purpose and not its letter: no query here takes a project id, a user id or any other selector from the caller at all. There is nothing to forge, because there is no parameter to forge it in. What replaces the ownership filter is a prior gate — an operator identity taken from verified token claims and checked against an allowlist the application cannot write.

The site is added to `REVIEWED_SITES` in `src/lib/supabase/service-boundary.test.ts`, which is both the allowlist and the review record, and `src/lib/supabase/service.ts`'s own docblock gains this as its third named case so the file stops describing a world with two.

### 3. Live means polling, and that is the architecture, not a compromise

The client re-fetches on an interval and pauses when the tab is hidden. No websocket, no Realtime channel, no subscription, no new table, no new service.

This is not a lesser version of a push feed. A push transport would be a second durable liveness mechanism competing with Vercel Workflows — precisely what rule 24 exists to prevent — and it would buy latency the operator cannot use: the underlying rows are written by workflow steps that take tens of seconds. A five-second poll is inside the noise of what it observes.

### 4. Shapes, never content — enforced by a column allowlist

Every read names its columns explicitly, from a constant. `select("*")` is forbidden here and a test asserts its absence.

What the console may show: operation type, status, stage, failure code, timestamps, durations, token counts, provider costs, and identifiers.

What it must never show, whatever a future column contains: prompt text, model output or reasoning (rules 43 and 47), repository content or paths, page content or URLs with query strings (rule 37), evidence bodies, credentials, and customer email addresses.

Identifiers are rendered truncated. The console answers *what is happening, what broke, and what it cost* — none of which needs a person's name attached to be answered.

## Consequences

**Easier.** An operator can see the system running without writing SQL: what is in flight, what failed in the last day and with which code, what the last hours cost across providers, and where users stop in onboarding. A failure class becomes visible as a pattern rather than as one support message.

**Harder.** A new column is now a decision with two homes: the table, and whether the console may name it. That is the intended cost of the allowlist — a `select("*")` would have made it free and made the next leak silent.

**Foreclosed, deliberately.** The console performs no action: no refund, no cancel, no retry, no impersonation, no write of any kind. Moving money still needs the authorization model the ROADMAP entry names, and a read-only surface is not a step towards one — a console that can act is a different decision with a different threat model, and it should be argued on its own.

**Not addressed.** There is no audit trail of operator reads. Every write in this product is recorded in `audit_events`; a read is not, and the console does not change that. For a single-operator deployment the question is moot; the first additional operator makes it real, and it is named here rather than discovered later.

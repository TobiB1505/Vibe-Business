# modules/internal-console

The internal operator console — see [ARCHITECTURE.md §3 "Layers with no section above"](../../../ARCHITECTURE.md#layers-with-no-section-above) and [ADR 0088](../../../docs/decisions/0088-the-internal-operator-console.md).

This product measures almost everything it does and, until this module, displayed none of it. Thirteen of fifty-six tables exist purely to record what happened, and the operator's only view of a running system was the Supabase SQL editor — which is an archaeology tool, not a view of a running system.

The console answers three questions and no others: **what is happening, what broke, and what did it cost.**

## It reads across tenants, and that is the whole point

RLS scopes every read to the caller. A session-scoped client would show an operator their own two projects, which answers none of the three questions. So this module uses the service-role client, which bypasses RLS — the one reviewed exception outside `modules/operations` and `modules/billing`.

Rule 53 requires that a service-role query filter on ownership. This one cannot, so it satisfies the rule's _purpose_ instead, and the substitution is written down rather than assumed:

> **No function in `store.ts` accepts a project id, a user id, or any other selector from its caller.** There is nothing to forge, because there is no parameter to forge it in. The only inputs are a time window and a bound.

What replaces the ownership filter is a gate that runs first, in `service.ts`.

## The gate is an environment allowlist, checked on every request

`VIBE_INTERNAL_OPERATOR_USER_IDS`, comma-separated. **Absent or empty means nobody** — a missing variable must never be the permissive case for a surface that bypasses RLS.

Not a `role` column, because application state has a write path and a write path is a way to grant yourself the console. Not a feature flag, because a flag is one switch somebody flips for everyone while an allowlist has to _name_ what it admits. The same shape `coding-agent/authorization.ts` already uses for the dogfood allowlist.

The identity comes from `getSession()`, which verifies the JWT signature. It is re-checked on **every** call, including every poll — an operator removed from the allowlist stops being one at their next refresh, not at their next sign-in. A non-operator gets `notFound()` rather than a refusal, because a 403 confirms the route exists.

## Live means polling

No websocket, no Realtime channel, no subscription, no new table. A push transport would be a second durable liveness mechanism beside Vercel Workflows, which rule 24 forbids without its own ADR — and it would buy latency nobody can use, because the rows being watched are written by workflow steps that take tens of seconds. A five-second poll is inside the noise of what it observes.

## Shapes, never content

Every query names its columns from a constant in `columns.ts`. `select("*")` would inherit whatever column is added next, and this surface has no tenant boundary to catch it afterwards.

Two tests enforce it, and both were proved to fail before they were kept: one rejects a wildcard, the other rejects a hand-written column string that would have satisfied the first. `agent_tool_events.command` and `.path` — the two columns in this schema that carry a customer's repository — are absent by name, so widening the list fails a test rather than shipping.

Identifiers are truncated to eight characters. The console never joins `auth.users`, so no email address can reach it.

## Money is integer micro-USD

Provider costs arrive as decimal USD. Summing floats drifts, and this repository already refuses to do that for Credits, so costs are converted once at the boundary and summed as integers. A negative or non-finite cost is ignored rather than subtracted: a total that silently shrinks is worse than one that skips a bad row.

## A measurement and an estimate are two numbers, never one

`provider_cost_usd` is **null in every sandbox row and every browser row ever written** — neither provider reports a per-run price. Vibe's own derivation lives in `estimated_cost_nano_usd` under its own pricing version, and `economy/sandbox-usage-estimate.ts` keeps the columns apart precisely so an assumption is never summed as a measurement.

The console's first look at production showed _"sandbox · 4 events · $0.00"_ under a heading that said what the providers billed. The zero was structural, not empty. Both figures are now read and kept apart: a measured total, or an estimate rendered with a `~`. They are never added together.

## A reached bound is reported, not hidden

Every query is bounded. When one returns a full page the snapshot is marked `truncated`, and the console says the totals are a floor. An operator told "at least this much" can act on it; one shown a quiet undercount cannot.

## Two panels the first production look corrected

Both were the same mistake in different clothes: a number that looked like an
observation and was an artefact of reading the wrong place.

**Provider spend.** `provider_cost_usd` is null in every sandbox row and every
browser row ever written — neither provider reports a per-run price — so the
panel showed `sandbox · 4 events · $0.00` under a heading that said what the
providers billed. Both cost columns are now read and kept apart, and a source
with events but no figure at all says **not recorded**. In production today
that is every sandbox row: 63 of them, none carrying a provider price, an
estimate, a `cost_pricing_version` or a `vcpus` count, so the derivation
[ADR 0073](../../../docs/decisions/0073-the-charge-lands-on-what-was-sold.md) describes has never once been written. The console reports that rather
than papering over it.

**Agent runs.** The panel first read `agent_tool_events`, which has **zero rows
and no writer**: it belongs to the tool-gateway topology of [ADR 0027](../../../docs/decisions/0027-coding-agent-provider-and-tool-gateway.md), and
[ADR 0029](../../../docs/decisions/0029-agent-runtime-placement-and-credential-broker.md) moved the harness inside the sandbox where the gateway brokers
sampling alone. `agent_activity_events` is empty for the same reason, and
`agent_execution_runs.tool_calls_allowed` / `.tool_calls_denied` / `.files_read`
are zero in all 21 production rows. What survived the move — status, failure
code, duration, changed files — is on the run row, and that is what the panel
reads now.

## What lives here

| File          | Purpose                                                                 |
| ------------- | ----------------------------------------------------------------------- |
| `operator.ts` | Who may open the console. Unset means nobody.                           |
| `columns.ts`  | Every column the console may read, and the ones deliberately absent.    |
| `schema.ts`   | What the console shows: windows, bounds, and the snapshot type.         |
| `shape.ts`    | Rows into views. Pure, clock-injected, so "is this stuck?" is testable. |
| `store.ts`    | The reads. The reviewed rule 53 exception.                              |
| `service.ts`  | The one entry point: authorize, gather, shape.                          |

## What this module deliberately cannot do

It performs **no action**: no refund, no cancel, no retry, no impersonation, no write of any kind. Moving money needs the authorization model [docs/ROADMAP.md](../../../docs/ROADMAP.md) names as still open, and a read-only surface is not a step towards one — a console that can act is a different decision with a different threat model.

There is also no audit trail of operator _reads_. Every write in this product is recorded in `audit_events`; a read is not. For a single-operator deployment that is moot, and the first additional operator makes it real — named in [ADR 0088](../../../docs/decisions/0088-the-internal-operator-console.md) rather than discovered later.

# 0007 - Postgres Append-Only Audit Log

Status: Accepted
Date: 2026-08-09

## Context

[PRODUCT.md](../../PRODUCT.md#9-approval-model) requires that approval to merge is always an explicit, attributable user action, never inferred or defaulted. [ARCHITECTURE.md](../../ARCHITECTURE.md) requires an Audit Log layer recording who/what took which action, across the pipeline, and previously left its storage/retention approach as an open decision.

## Decision

V0.1 uses a **Postgres-based, append-only application audit log**, conceptually the `audit_events` table, stored in the same Supabase Postgres instance decided in [0002](0002-supabase-postgres-and-auth.md).

Audit events document **business-meaningful actions**, not general application/error logs. Example event types:

- `github.installation.connected`
- `repository.connected`
- `audit.started`
- `audit.completed`
- `opportunity.created`
- `execution.started`
- `branch.created`
- `preview.ready`
- `approval.accepted`
- `approval.rejected`
- `pull_request.merged`
- `credits.debited`

The audit log is treated as append-only under normal operation — rows are not edited or deleted as part of regular application behavior. It **does not replace** normal application logs or error logs, which remain a separate operational concern.

No full `audit_events` field list is defined here; exact columns are scoped to Sprint 0/1 schema work.

## Consequences

### Positive

- A durable, queryable record of every business-meaningful action makes the approval-first principle verifiable after the fact, not just enforced in code.
- Storing it in the same Postgres instance as the rest of the app data avoids introducing a separate logging infrastructure provider for V0.1.
- Append-only behavior gives a tamper-evident-by-convention trail for approvals and merges specifically.

### Negative / Tradeoffs

- Postgres-based audit logging does not scale indefinitely for very high event volume; acceptable for V0.1's validation goal, not necessarily forever.
- "Append-only" here is an application-level convention for V0.1, not a database-enforced guarantee (e.g. no write-once storage engine); stronger enforcement is a possible future hardening step, not a V0.1 requirement.

## Revisit when

Event volume, compliance requirements, or a need for database-enforced immutability make a dedicated audit/event-log system necessary.

# modules/audit-log

Audit Log — see [ARCHITECTURE.md §3.12](../../../ARCHITECTURE.md#312-audit-log) and [ADR 0007](../../../docs/decisions/0007-audit-log.md) (Postgres append-only `audit_events`).

**Sprint 0 status:** boundary reserved only. No `audit_events` table and no event recording exist yet — there are no business-meaningful actions to record until the layers that produce them (`github`, `audits`, `opportunities`, `execution`, `approvals`) exist. Not to be confused with normal application/error logs, which remain a separate operational concern (ADR 0007).

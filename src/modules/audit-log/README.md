# modules/audit-log

Audit Log — see [ARCHITECTURE.md §3.12](../../../ARCHITECTURE.md#312-audit-log) and [ADR 0007](../../../docs/decisions/0007-audit-log.md) (Postgres append-only `audit_events`).

## What exists (Sprint 1)

- `events.ts` — `recordAuditEvent(supabase, { userId, eventType, metadata })`, the one place that writes to `audit_events`. Route handlers and Server Actions call this instead of inserting directly, so metadata discipline (never secrets/tokens — ADR 0008, ADR 0009) and error handling live in one place.
- The `audit_events` table itself is created in the Sprint 1 migration — minimal columns only (`user_id`, `event_type`, `metadata`, `created_at`), append-only per ADR 0007 (no update/delete RLS policies).
- Event types produced this sprint: `github.authorization.started`, `github.identity.verified`, `github.installation.connected`, `repository.selected`, `project.created`, `project.disconnected`, `github.access.failed`.

Not to be confused with normal application/error logs, which remain a separate operational concern (ADR 0007).

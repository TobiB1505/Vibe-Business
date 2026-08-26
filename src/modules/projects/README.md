# modules/projects

Owns the user's connected projects (`Project`, `RepositoryConnection` — see [ARCHITECTURE.md §6](../../../ARCHITECTURE.md#6-domain-model-conceptual-only)).

## What exists (Sprint 1)

- `connect.ts` — `createProjectWithRepository()`: creates a Project + its one RepositoryConnection in a single transaction, with duplicate-repository protection (unique constraint on `repository_connections.github_repository_id`). A failed connection insert rolls the project back; there is no compensating delete, because neither this path nor `disconnect.ts` may hold `DELETE` on `public.projects` any more — see [ADR 0056 §5](../../../docs/decisions/0056-lifecycle-erasure-and-retention.md).
- `disconnect.ts` — `disconnectProject()`: removes a Project and everything derived from it — never touches GitHub itself. It calls `disconnect_project()`, which owns the privilege, reads the owner from `auth.uid()` and sets no lifecycle marker, so a project holding an execution spec is still refused. Temporary: ADR 0056 §1 makes Disconnect non-destructive, and migration family M5 removes this.
- `queries.ts` — `listProjectsForUser()` (dashboard), `getProjectWithRepository()` (project detail page).

A project holds exactly one repository connection in Sprint 1 — no multi-repo projects yet.

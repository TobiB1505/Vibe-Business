# modules/projects

Owns the user's connected projects (`Project`, `RepositoryConnection` — see [ARCHITECTURE.md §6](../../../ARCHITECTURE.md#6-domain-model-conceptual-only)).

## What exists (Sprint 1)

- `connect.ts` — `createProjectWithRepository()`: creates a Project + its one RepositoryConnection in a single transaction, with duplicate-repository protection (unique constraint on `repository_connections.github_repository_id`). A failed connection insert rolls the project back; there is no compensating delete, because no path in this module may hold `DELETE` on `public.projects` any more — which is also why the disconnect path that once did is gone, and detaching now leaves the project standing. See [ADR 0056 §5](../../../docs/decisions/0056-lifecycle-erasure-and-retention.md).
- `attach.ts` — `attachRepositoryToProject()`: connects a repository to a project that already exists, which is what makes a detached project recoverable rather than an archive. Also `findReconnectInstallationId()`, which reads the project's connection *history* to send a reconnect straight to the right installation.
- `repository-connection.ts` — the one place `repository_connections` is queried from. A detached row is history, not a connection; `liveConnections()` excludes it and `anyConnections()` says out loud that it wants it.

Disconnecting and deleting live in `src/modules/operations/project-lifecycle/`, because both need the service-role client ([ADR 0056](../../../docs/decisions/0056-lifecycle-erasure-and-retention.md) §1, §3).
- `queries.ts` — `listProjectsForUser()` (dashboard), `getProjectWithRepository()` (project detail page).

A project holds exactly one repository connection in Sprint 1 — no multi-repo projects yet.

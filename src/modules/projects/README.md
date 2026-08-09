# modules/projects

Owns the user's connected projects (`Project`, `RepositoryConnection` — see [ARCHITECTURE.md §6](../../../ARCHITECTURE.md#6-domain-model-conceptual-only)).

## What exists (Sprint 1)

- `connect.ts` — `createProjectWithRepository()`: creates a Project + its one RepositoryConnection, with duplicate-repository protection (unique constraint on `repository_connections.github_repository_id`) and best-effort rollback if the second insert fails.
- `disconnect.ts` — `disconnectProject()`: removes a Project (and, via cascade, its RepositoryConnection) — never touches GitHub itself.
- `queries.ts` — `listProjectsForUser()` (dashboard), `getProjectWithRepository()` (project detail page).

A project holds exactly one repository connection in Sprint 1 — no multi-repo projects yet.

# modules/projects

Owns the user's connected projects (conceptually `Project`, `RepositoryConnection` — see [ARCHITECTURE.md §6](../../../ARCHITECTURE.md#6-domain-model-conceptual-only)). The `/app` shell's "Your projects" list and "Connect your first project" action will eventually live here.

**Sprint 0 status:** boundary reserved only. No project entity, no persistence, no real GitHub connection — the `/app` shell renders its empty state directly, per the Sprint 0 scope. See [docs/sprints/0000-application-bootstrap.md](../../../docs/sprints/0000-application-bootstrap.md).

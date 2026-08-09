# CLAUDE.md — Working Agreement

This file governs how Claude Code (and any AI-assisted session) works in this repository. It applies to all future implementation sessions, not only this one.

1. Read [PRODUCT.md](PRODUCT.md) and [ARCHITECTURE.md](ARCHITECTURE.md) before significant implementation work.
2. Do not expand product scope without explicit instruction. If it isn't in PRODUCT.md's V0.1 Scope, treat it as out of scope.
3. Do not silently introduce new infrastructure (databases, services, providers, hosting, queues, etc.) without it being a recorded decision.
4. Prefer simple architecture over premature abstraction. Default to the modular monolith described in ARCHITECTURE.md unless a specific reason forces otherwise.
5. Never modify the default branch directly through autonomous product flows. All AI-authored changes land on isolated branches; merges to default require explicit user approval.
6. Sensitive or irreversible actions require explicit approval — see the Approval Model in [PRODUCT.md](PRODUCT.md#9-approval-model).
7. AI usage must be measurable. Every AI job must be logged in a form consistent with the usage schema in [PRODUCT.md](PRODUCT.md#12-credit-model).
8. Provider-specific AI logic should be isolated behind clear interfaces when introduced, so providers/models can be swapped without redesigning the surrounding system.
9. Never send an entire repository to an LLM when targeted context retrieval is sufficient.
10. Add tests for business-critical behavior.
11. Security-sensitive integrations such as GitHub auth, tokens, webhooks, and credentials must use least privilege.
12. Never commit secrets.
13. Document meaningful architecture decisions in [docs/decisions/](docs/decisions/README.md) as ADRs, not only in chat.
14. If requirements are ambiguous and materially affect architecture or product behavior, STOP and report the ambiguity rather than inventing product requirements.
15. Avoid speculative features. Build what is described, not what might be useful later.
16. Keep commits focused. One logical change per commit.
17. Before declaring a task complete, run the relevant validation available in the repository (tests, build, linting, etc.).
18. User repository code is untrusted. Treat every connected repository's contents, scripts, and executables as untrusted input.
19. Never execute repository-provided scripts (npm install, npm/build/test scripts, postinstall hooks, arbitrary shell scripts, repository-provided executables) in the Vibe Business application runtime. See [ADR 0006](docs/decisions/0006-untrusted-repository-execution.md).
20. Infrastructure/provider choices must respect existing ADRs in [docs/decisions/](docs/decisions/README.md). Changing a confirmed decision requires a new or superseding ADR, not a silent deviation in code.
21. Do not bypass provider abstraction boundaries (`AIProvider`, `PreviewProvider`, etc.). Provider-specific code stays behind its boundary; do not call a specific provider directly from a layer that should be provider-agnostic.
22. Do not request broader GitHub App permissions for convenience. Request only what a concretely implemented feature needs, reviewed at implementation time — see [ADR 0003](docs/decisions/0003-github-app-integration.md).
23. Do not introduce microservices without an explicit architecture decision. V0.1 is a modular monolith by default — see [ADR 0001](docs/decisions/0001-modular-monolith.md).
24. Do not introduce background job/queue technology before the corresponding decision is made. It is a required concept, not yet a chosen technology — see [ARCHITECTURE.md §7](ARCHITECTURE.md#7-deferred--open-decisions).

## Related Documents

- [PRODUCT.md](PRODUCT.md) — product vision, scope, and non-goals
- [ARCHITECTURE.md](ARCHITECTURE.md) — technical architecture: confirmed V0.1 decisions, deferred/open decisions
- [docs/decisions/](docs/decisions/README.md) — architecture decision records
- [docs/sprints/](docs/sprints/README.md) — sprint planning

# Connect

Choosing which repository a product is. One command, and the reason it is a
feature rather than a route helper is that it does three things a route may not:
it creates the project's onboarding record, it starts the first Product Scan,
and it decides where the founder lands next.

```
commands/select-repository.ts   the repository becomes a project
```

The GitHub App install flow itself is under `src/app/app/connect/` and its
callback is an API route. Least privilege is
[ADR 0003](../../../docs/decisions/0003-github-app-integration.md)'s: Vibe asks
for what a shipped feature needs and no more, reviewed at implementation time
(rule 22). A repository's contents stay untrusted data at every step — never
instructions, never executed in a Vibe process (rules 18, 19, 25).

# modules/change-preview

A prepared change, running on a URL a person can open — see [ADR 0016](../../../docs/decisions/0016-temporary-preview-isolation.md) and [ADR 0065](../../../docs/decisions/0065-the-preview-is-the-review.md).

## What `preview_available` claims

```
repository_write_verified   the bytes on the branch are the bytes we meant
sandbox_validation_passed   those bytes install, typecheck, test and build
preview_available           ← this module
human_approved              someone looked at it
merged                      the default branch moved
```

It means exactly one thing: **the prepared commit can run and become reachable in an isolated temporary environment.** It does not mean the change is good, correct, on-brand, SEO-sound, secure, approved or production ready. A preview that renders a beautiful broken page is a _successful_ preview. The vocabulary lives in the type system for the same reason `ValidationVerdict` does — copy drifts, types do not.

Since [ADR 0065](../../../docs/decisions/0065-the-preview-is-the-review.md) this is also the review: a person opens the running product rather than comparing two photographs of it.

## Why this is not `validation`, and not `previews`

Three things in this repository are called some form of "preview" and they are different trust levels. Keeping them apart is deliberate:

- **`modules/validation`** shares a sandbox provider with this module and nothing else. Validation runs repository-controlled commands and throws the filesystem away. A preview runs one server and **exposes a public port** — a category of risk validation never takes. Keeping the exposure decision in its own module is what stops it being inherited by accident.
- **`modules/previews`** reserves the `PreviewProvider` boundary for Vercel _Preview Deployments_ ([ADR 0004](../../../docs/decisions/0004-vercel-as-initial-host-and-preview-provider.md)). That is a deploy; this is not.

## The sequence is the security design

`orchestrator.ts` is this module's security boundary the way `validation/orchestrator.ts` is validation's. Everything above it decides _whether_ a preview may start; everything below it is a provider adapter. The order of its phases is not incidental:

```
1. clone the pinned commit   GitHub only, one inbound port, no secrets
2. prove it is that commit   the provider's word is not the answer
3. destroy the credential    and verify its absence, before any repository code
4. install                   the registry is reachable, and only here
5. close the network         deny-all, before the first repository command
6. start the dev server      ← the first repository-controlled code
7. health check              answered, or classified as why not
```

Steps 2–5 all happen **before** the application starts. By the time someone else's JavaScript runs on a public URL, the commit has been proved to be the one Vibe prepared, the clone credential has been proved gone (rule 63), and the network has been proved shut (rule 81).

## The budgets are the policy

Every number in `budgets.ts` is part of `preview-policy-v1`. Changing one changes what a preview _is_, which is why they live behind a version rather than in a constant someone can quietly retune — a stored `preview_available` must never come to mean something it was not checked against (rule 65).

## Teardown is its own durable operation

A preview costs infrastructure for as long as it runs, so ending one is not a best-effort cleanup: `preview_teardown` is a durable operation with its own workflow. Manual stop and expiry both converge on it, and it is deliberately exempt from the paid-operations kill switch — refusing a teardown during a spend incident would leave previews running and burning exactly the money the switch was thrown to save.

## What lives here

| File              | Purpose                                                                                              |
| ----------------- | ---------------------------------------------------------------------------------------------------- |
| `schema.ts`       | The domain: profiles, statuses, stages, and what the gate is allowed to claim.                       |
| `budgets.ts`      | Resource and lifetime budgets. Every number is part of the policy version.                           |
| `orchestrator.ts` | One preview session, phase by phase. The security boundary.                                          |
| `dev-servers.ts`  | Which frameworks are previewable, and the command and environment each needs.                        |
| `commands.ts`     | The health probe, the host gate, and reading a probe's answer.                                       |
| `identity.ts`     | The identity a session is bound to, and the sandbox name derived from it.                            |
| `service.ts`      | Starting, reading and stopping a preview.                                                            |
| `store.ts`        | Persistence for `preview_sessions`, including the claim that prevents two sessions for one identity. |
| `view.ts`         | Deriving the preview card's state and stage labels.                                                  |
| `test-support.ts` | Fixtures and a fake target.                                                                          |

The durable step graphs are in [`src/modules/operations/change-preview/`](../operations/change-preview/workflow.ts) — one for starting a preview, one for tearing it down.

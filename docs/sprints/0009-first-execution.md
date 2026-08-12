# Sprint 9 — First Execution

Status: **9A complete · 9B complete · 9C pending.** The execution core and its backend wiring are built, tested and mutation-validated. There is **no customer-facing trigger**: no UI, no permission upgrade, no dogfood, and no repository write has ever been performed.
Branch: `feat/first-execution`

| Phase | Scope | Status |
| --- | --- | --- |
| **9A** | Safety core: capability resolution, preflight, premise revalidation, path allowlist, deterministic generator, atomic writer | Complete |
| **9B** | Backend wiring: `prepared_changes`, execution identity, `change_preparation` operation, durable workflow, application service | Complete |
| **9C** | UI, GitHub permission upgrade, dogfood | Pending |

## Goal

The first controlled transition from *"Vibe tells you what to do"* to *"Vibe prepares the change for you"*: one supported, deterministic code change on an isolated GitHub branch, after revalidating that the opportunity's premise is still true.

Not general autonomous coding. Deliberately narrow, deterministic, evidence-verified and reversible.

## Why execution starts narrowly

Sprint 8 produced the argument for this sprint's entire shape.

The repository analyzer reported `robots: detected: true`, citing `src/modules/live-product-intelligence/robots.ts` — our own crawler's robots.txt **parser**. The audit believed it. The Opportunity Engine reasoned validly from it and told the founder to "restore" files that did not exist. Every layer worked correctly; the premise was false.

Advice built on a false premise is a wrong sentence. **A repository write built on a false premise is a wrong commit.**

So execution does not inherit the evidence chain's confidence:

> `executionReadiness === "ready"` authorizes nothing.
> Stored evidence ids authorize nothing.
> Only current, independently re-checked state authorizes a write.

## Execution preflight

`src/modules/execution/preflight.ts`. Pure and port-injected, so every refusal is a unit test rather than a production incident.

| Check | Source of truth | Block reason |
| --- | --- | --- |
| Capability exists | structured opportunity + snapshot | `unsupported_opportunity` |
| Framework supported | repository intelligence | `unsupported_framework` |
| Audit current | today's evidence identity | `stale_audit` |
| Opportunity set current | the audit it derived from | `stale_opportunity` |
| Snapshot current | newest successful snapshot | `stale_repository_intelligence` |
| Repository unchanged | **live GitHub HEAD** | `repository_changed` |
| App root resolvable | repository intelligence | `unsupported_repository_layout` |
| Production origin verified | project configuration | `missing_required_context` |
| Routes still unserved | **live production origin** | `premise_no_longer_true` |
| Target files still absent | **live repository tree** | `conflicting_files_exist` |
| Write permission | **live installation token** | `github_write_permission_required` |

The four bold rows are the premise revalidation. They are the ones that would have caught Sprint 8.

## Capability resolution

`nextjs_seo_foundations_v1`, resolved structurally — never by matching the opportunity's prose.

The tempting implementation is `title.includes("SEO")`, and it is the worst available: the title is model output, so a prompt improvement or a translation would silently change which opportunities Vibe writes code for. **Model wording is not a machine API.**

Two tests state the property directly: a German rewording of the same structure still resolves; the exact English wording without the supporting evidence does not.

## GitHub permission boundary

Minimum required permission, confirmed against current GitHub documentation: **`Contents: write`** — it covers blobs, trees, commits and refs.

Deliberately *not* requested: Pull Requests (no PR this sprint), Administration, Actions, Issues, Secrets.

The installation's actual granted permission is read from the installation token at preflight time, not assumed from what was requested at install. An installation approved under Sprint 2's read-only scope is still live and must be told to upgrade rather than allowed to fail mid-write.

## Deterministic change generator

No model call. No thinking tokens. **No AI cost.**

That is the point: this sprint proves opportunity → preflight → GitHub write → review, without simultaneously proving that an AI can write code. Two different risks; mixing them would make a failure impossible to attribute.

Output is a pure function of `(origin, appRoot)` following the Next.js 16.3.0 App Router metadata-route conventions (`MetadataRoute.Robots`, `MetadataRoute.Sitemap`), checked against current documentation rather than recalled. The sitemap is deliberately conservative: public routes only, nothing behind authentication, nothing internal.

## Branch and commit safety

One atomic commit through the Git Data API: blobs → tree (based on the base tree) → commit (base as sole parent) → **new ref last**. A failure anywhere earlier leaves garbage-collectable loose objects and no branch, which is far better than a half-written one.

Three things the writer structurally cannot do:

- **move an existing ref** — only `createRef`, never `updateRef`, so the default branch cannot be touched by any path in the module;
- **force** anything — `force` is never passed;
- **delete or rename** — the tree is built additively.

Success is not "GitHub returned 201": the branch is re-read, and every file is fetched back from that branch and hashed against the generated bytes.

## Path safety

Two independent defences, because one is a policy and the other is a proof:

1. the generator composes paths from a resolved app root plus fixed basenames, so no caller-supplied string reaches a path;
2. every path is re-checked against a capability allowlist before writing, so a future capability that forgets rule 1 still cannot escape.

Permanently forbidden: `.github/`, `.env*`, manifests, lockfiles, `supabase/`, `next.config.*`, `middleware/proxy`. Absolute paths, traversal and backslashes are rejected outright rather than normalized.

## Tests and mutation validation

50 execution tests. Six mutations, each breaking real tests:

| Mutation | Result |
| --- | --- |
| Remove the HEAD consistency check | 1 test fails |
| Remove the staleness blocks | 2 fail |
| Trust stored evidence instead of the live premise | 3 fail |
| Remove existing-file protection | 2 fail |
| Allow arbitrary target paths | 11 fail |
| Resolve capability by title text | 2 fail |

Per §43, these are only called safety coverage because they demonstrably fail under mutation.

## Backend wiring (9B)

### PreparedChange persistence

`prepared_changes` stores references, never content: branch, base sha, commit sha, file paths and hashes. The GitHub branch is the canonical artifact, so Supabase does not become a source-code mirror (§2, §23). No tokens, no API responses, no diffs, no generated source.

A successful prepared change is immutable — the transitions are scoped to `preparing`, so a replayed persistence step reports that it did nothing rather than rewriting a finished result with a second commit.

### Execution identity

`project + opportunity set + opportunity + capability + capability version + repository snapshot + base HEAD sha`.

The base sha earns its place: a prepared change is a commit *on top of a specific parent*. If the default branch moved, the previously prepared change is no longer the same change even though the opportunity is unchanged — reusing it would hand the user a diff against a tree that no longer exists.

Opportunity prose is deliberately absent. It is model output, so a reworded title would otherwise invalidate a perfectly good prepared change and buy a second branch for nothing.

### Durable operation

`change_preparation`, the third type on the Sprint 7 foundation. Stages: `preflight → generating_change → writing_repository → verifying_repository → persisting → completed`. Two durable steps; the write step sets `maxRetries = 0`, because a platform retry could create a second branch and the recovery path — not the platform — is what makes re-entry safe.

`operation_runs` gained `subject_id`: the domain object an operation acts on. A preparation acts on one specific opportunity, and the workflow must re-resolve exactly which one — not "the current top opportunity", which could be a different one by the time the step runs.

### Application service

The caller decides **a project and an opportunity**. That is the complete list.

The repository, installation, branch, base commit, file paths, capability, production origin and generated content are all resolved server-side. Those are not parameters that get validated; they are not parameters at all, which is what stops a scoped capability becoming an arbitrary write primitive.

### Workflow-time revalidation

The service's eligibility check is a *courtesy* — it avoids queueing an obviously doomed run. **The safety boundary is in the workflow**, immediately before the write, because a queued operation can sit while the repository moves, a teammate adds the files, or the site starts serving them.

HEAD and write permission are re-checked in the write step specifically, not only at preflight, and a test proves each: preflight passes, the world changes, the write step refuses with zero mutating calls.

## Tests and mutation validation (9B)

180 tests across the execution and operations modules. Six new mutations, each breaking real tests:

| Mutation | Result |
| --- | --- |
| Remove active-operation reuse | 1 test fails |
| Remove successful PreparedChange reuse | 1 fails |
| Remove recovery branch inspection | 3 fail |
| Remove workflow-time HEAD revalidation | 1 fails |
| Remove the write-permission gate | 1 fails |
| Let persistence replay create duplicates | 2 fail |

Two of those — active-operation reuse and persistence replay — **survived the first run**. The database constraint covered the first, and the early-return path made the second unreachable. Both got a dedicated test rather than a shrug, which is the entire reason for running mutations against your own suite.

`inspectExistingBranch` was explicitly untested in 9A and now has five cases: absent, exact match, different content, missing file, single-byte difference.

## What is NOT implemented

- **No UI.** No "Let Vibe prepare this" button, no confirmation dialog, no diff view, no permission-upgrade prompt.
- **No GitHub permission upgrade.** The App still holds `Contents: read`, so a real write would block at the preflight's permission gate.
- **No dogfood.** No branch, no commit, nothing written to any repository by anything.
- **No diff retrieval.** `getPreparedChangeView` returns file paths, not content — fetching a bounded diff for review belongs to 9C.

## Known limitations

- The GitHub App still holds `Contents: read`. Even with the wiring in place, a permission upgrade would be required before any write — see Manual action in the report.
- No repository execution of any kind: no clone, no install, no build, no tests. Vibe has no sandbox, so a prepared change can honestly be called `repository_write_verified` but never `application_validated`.
- Creating a branch may trigger repository-configured CI or preview automation. Vibe neither triggers nor manages those.

## Next step

Complete the wiring in the order the safety story implies: persistence → durable operation → service with live probes → UI → permission upgrade → dogfood. The domain core does not change; it is the part that is already proven.

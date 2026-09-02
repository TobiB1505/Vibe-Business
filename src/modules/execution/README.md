# modules/execution

Deterministic change preparation: turns an approved Action Step into a commit on an isolated branch, and owns everything about that branch's lifecycle. See [ARCHITECTURE.md §3.6–§3.8](../../../ARCHITECTURE.md#36-ai-execution-layer), [ADR 0014](../../../docs/decisions/0014-first-execution-safety.md) and [ADR 0035](../../../docs/decisions/0035-commit-message-compiler.md).

## What this module does

| Area | Files |
|---|---|
| Capability gating — which steps this product can execute at all | `capabilities.ts`, `generators/` |
| Premise revalidation before a write | `preflight.ts` |
| The write itself — blob, tree, commit, ref | `github-writer.ts`, `github/`, `git-port.ts` |
| Commit message compilation (deterministic, never model output) | `commit-message.ts` |
| Identity, paths, change origin | `identity.ts`, `paths.ts`, `change-origin.ts` |
| Reading a change back as a diff, and identifying that diff | `diff.ts`, `diff-lines.ts`, `code-review-digest.ts` |
| What a delivered change is expected to produce in production | `outcome-contract.ts`, `measurement-contract.ts` |
| Persistence, service entry point, read models | `store.ts`, `service.ts`, `view.ts`, `change-progress.ts` |

## The safety boundary, stated accurately

This module **writes** to a customer's repository: it creates a blob, a tree, a commit and a branch ref (`github/adapter.ts`). It requires `Contents: read and write` and checks the permission the installation actually carries before it tries.

Since [ADR 0073](../../../docs/decisions/0073-removing-a-file.md) a tree entry may also *remove* a path — `{ path, blobSha: null }`, the Git data model's own shape. That is the only new verb: the port still has no operation that amends a commit, moves a ref, force-updates or deletes a branch, and a removed path is checked against the same write policy as a written one and read back afterwards to confirm it is gone.

What it does **not** do is execute anything. [ADR 0006](../../../docs/decisions/0006-untrusted-repository-execution.md) and rule 61 are respected here in the strict sense: no clone, no install, no build, no test, no repository-provided script runs in this module or anywhere else in the Vibe application runtime. Repository code executes only inside the microVM that `modules/validation` provisions ([ADR 0015](../../../docs/decisions/0015-untrusted-repository-execution-provider.md)), which clones the pinned commit itself.

The other invariants worth knowing before changing anything here:

- **Only isolated branches**, except through the approval architecture — the default branch is moved by `modules/merge`, never from here (rules 58, 71).
- **Model output never controls a path, ref, branch name, commit message or generated code** (rule 57). Everything under `generators/` is deterministic capability code, and `paths.test.ts` asserts the module contains no placeholder paths.
- **Stored evidence routes; it never authorizes.** `preflight.ts` re-reads live repository state immediately before a write and blocks on drift rather than reasoning about it (rules 55, 56).
- **No diff is ever persisted.** `diff.ts` reads both versions of every changed file from GitHub at the two commits the prepared change recorded, on demand, and stores nothing — a stored diff would make Supabase a source mirror of every customer repository (rule 26). `code-review-digest.ts` identifies a diff without holding it: two immutable commits plus the shown paths reproduce it exactly, which is what lets an approval bind to one ([ADR 0063](../../../docs/decisions/0063-review-classification-as-a-gate.md)).

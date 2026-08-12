# ADR 0014 — First execution is isolated, premise-revalidated and capability-scoped

Status: Accepted
Date: 2026-08-12
Extends: [ADR 0003](0003-github-app-integration.md) (GitHub App), [ADR 0013](0013-durable-operation-execution.md) (durable execution)

## Context

Vibe can understand a product, diagnose it, and prioritize what to do next. The next step is doing one of those things — writing code.

Sprint 8 supplied the argument for how carefully. The repository analyzer reported `robots: detected: true`, citing our own crawler's `robots.ts` **parser**. The audit believed it; the Opportunity Engine reasoned validly from it; the product told the founder to restore files that did not exist. Every layer behaved correctly and the premise was false.

Advice from a false premise is a wrong sentence. A repository write from a false premise is a wrong commit — in someone else's repository.

## Decision

### 1. Model readiness does not grant execution authority

`executionReadiness === "ready"` is the model's opinion that a human could act. Whether Vibe has an executor is a separate, structural question. The two are resolved independently and never conflated.

### 2. The premise is revalidated immediately before the write

Stored evidence ids, the audit, and the snapshot are all treated as routing signals, not authority. Before any write, the concrete claim is re-checked against live state: GitHub's current HEAD, the live repository tree, the live production origin, and the installation's actual permissions. Any disagreement blocks.

### 3. Repository HEAD must match the analyzed state

If the default branch moved since the snapshot, execution refuses. No merge reasoning against a tree Vibe has not seen.

### 4. Model output never controls paths, refs, or code

Repository paths, branch names, commit messages and file contents are produced exclusively by deterministic capability code. Opportunity text is untrusted string data and is never interpolated into any of them. A capability allowlist re-checks every path independently of the generator.

### 5. Vibe writes only to isolated branches

Only `createRef` — never `updateRef`, never force, never delete or rename. The default branch and production are structurally untouchable by the execution module. Writing to a default branch would require a separate approval architecture that does not exist.

### 6. The first executor is deterministic

No model call, so the sprint proves the write path without simultaneously proving AI code generation. Later capabilities may use AI; this one establishes the safety envelope they will run inside.

### 7. No untrusted repository execution

No clone, install, build or test of customer code. Vibe has no sandbox, so a prepared change may be called `repository_write_verified` and never `application_validated`.

### 8. The GitHub branch is the canonical prepared-change artifact

Supabase records references and metadata; it does not become a source-code mirror. Diffs are fetched from GitHub on demand under strict size limits.

## Consequences

- The GitHub App needs `Contents: write` — the minimum for blobs, trees, commits and refs. Pull Requests, Administration, Actions and Issues are deliberately not requested.
- Existing read-only installations must be upgraded explicitly; the product must distinguish "can write" from "read-only" rather than discovering it mid-write.
- Blocking on any staleness means a user may need to refresh intelligence before executing. That cost is accepted; executing a stale recommendation is not.
- A prepared branch may trigger repository-configured CI or preview automation. Vibe neither triggers nor manages those, and must not claim nothing external can happen.

## Alternatives considered

**Trust the evidence chain.** Rejected: Sprint 8 is the counterexample, and the failure mode is undetectable from inside the chain because every cited id is real.

**Match opportunities by title.** Rejected: model wording is not a machine API. A prompt improvement would silently change what Vibe is willing to write code for.

**Let the first executor be an AI coding agent.** Rejected for the first one: a failure would be impossible to attribute between the write path and the generation.

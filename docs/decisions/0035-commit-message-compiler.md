# ADR 0035 — Commit Message Compiler

- **Status:** Accepted
- **Date:** 2026-08-20
- **Narrows:** Rule 57's application (CLAUDE.md), for one specific field only
- **Sprint:** [0046](../sprints/0046-commit-message-compiler.md)

## Context

Every agentic Prepared Change commits with the message `vibe: implement plan
step N`. Traceable to Vibe's own state, useless to a human reading GitHub or
Vercel afterwards — nobody outside Vibe's own database can tell what step `N`
was, let alone what it changed.

The existing code deliberately built it this way, and says why in its own
comment: *"Rule 57 forbids model output controlling a commit message, and the
step's title is Planner prose — so the message names the step by its ordinal,
which Vibe assigned, rather than by what a model called it."*

That comment is correct about what Rule 57 says. It is not correct that the
Planner's own structured text is what Rule 57 was written to keep out.

## Decision

### Rule 57 is about the coding agent, not the Planner

Rule 57 sits inside CLAUDE.md's First-Execution-Safety block (rules 54–66,
ADR 0014) and every neighbouring rule in that block is about the same actor:
the coding agent running with elevated write access inside a customer's
sandbox, whose own account of its work must never be trusted (Rule 77) and
must never become repository-visible text on its own authority.

The Planner is a different actor in this system, already trusted for a
narrower but real purpose: its output is validated once before execution
starts, persisted, secret-scanned (`assertNoSecretMaterial`), and *already*
reaches the agent as prompt content and the Context Compiler as a relevance
signal (`execution-context/compiler.ts`'s `taskTerms`, since Sprint 0041).
Nothing about Rule 57 has previously excluded Planner text from any of that.
The commit message was the one place it was kept out — not because Rule 57
demanded it in principle, but because no bounded, sanitised path to use it
existed yet.

This ADR builds that path and narrows Rule 57's application to what it always
meant: the coding agent's own output — its final message, its tool-call
arguments, anything it said about what it did — never reaches a commit
message, a branch name, or a file path. That stays absolute. What changes is
that the Planner's `title` / `purpose` / `completionCriteria`, already trusted
elsewhere in this exact pipeline, may now also become a commit *subject* and
a scope classification, through `src/modules/execution/commit-message.ts`.

### What actually reaches a commit message, and what cannot

| Source | Trusted for this? | Why |
|---|---|---|
| Action Step `title` / `purpose` / `completionCriteria` | Yes | Planner output, validated once, secret-scanned, already read by the Context Compiler for the same kind of classification |
| Action Step `changeKind` / `evidenceIds` | Yes | Vibe-minted, validated against the evidence pack, the same signal `risk.ts` and `execution-context/surface.ts` already trust |
| The coding agent's final message / tool output | **No** | Rule 77 — never read the agent's account of its own work |
| Repository content (READMEs, source files) | **No** | Rule 25 |
| Arbitrary user text | **No** | No such field exists on the compiler's input type |

`compileCommitMessage`'s input type has exactly five fields, all from the
first two rows. There is no sixth field a future change could quietly widen
into the second two without the diff being visible.

### The classification itself stays deterministic and evidence-first

Type (`feat`/`fix`/`perf`/`refactor`/`test`/`docs`/`chore`) is a bounded
keyword classification over the title first, the rest of the trusted text only
as a fallback — mirroring Sprint 0044's own "trusted-first, bounded-prose-
fallback" shape, here applied to an axis (the *nature* of a change) that has
no evidence-id equivalent to route on.

Scope is evidence-first: a resolved `ExecutionSurfaceRequirement` (Sprint
0044's own mechanism, unchanged) beats keyword classification, which is
reachable only when the evidence ids resolved nothing at all. `chore` and "no
scope" are both real, common, non-alarming outputs — never guessed toward
`feat` or an invented scope.

### Traceability moves to the body, never disappears

```
feat(seo): add canonical URLs to public pages

Vibe-Execution: <agent_execution_runs.id>
Vibe-Step: <the trusted Action Step's key>
Vibe-Prepared-Change: <prepared_changes.id>
```

Real Git trailers, built from Vibe-computed identifiers, never by scanning
Planner text for trailer-shaped substrings — so a title containing a forged
`Vibe-Execution: fake` line is inert prose on the subject line, not a second
trailer block.

## Consequences

- `WriteTarget.stepOrder` is replaced by `WriteTarget.commitMessage: string |
  null` — `github-writer.ts` stays ignorant of Conventional-Commits semantics;
  classification lives entirely in the new module.
- Commit SHAs for future agentic Prepared Changes differ from what the old
  generator would have produced. Expected: the message is part of the commit
  object. Nothing about *when* the message is finalised changes — it is still
  computed once, before the single write, and `GitWritePort` still has no
  amend/force operation, so a validated SHA can never be silently moved by a
  message edit (PART H, tested explicitly).
- One new lifecycle event, `commit_message_compiled`, in the existing
  `agent_execution_events` vocabulary. No new table, no duplicated raw commit
  text — only `type`, `scope`, `subject`, `fallback`, `fallbackReason`.
- Historical commits (`vibe: implement plan step N`) are not renamed. Only
  future writes use the compiler.

## What this does not change

Candidate verification, write scope, sandbox isolation, independent
validation, Human Approval, and the validated-SHA-equals-merged-SHA invariant
are untouched. No provider call is added; the compiler is pure, deterministic,
and effectively free. The coding agent's own output remains excluded from
every repository-visible artifact it does not itself write as a file — Rule 77
is not narrowed by this ADR, only Rule 57's reading of "model output" for one
already-trusted, non-agent source.

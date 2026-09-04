# 0140 — The briefing that could not say what it missed

Date: 2026-09-04
Branch: `claude/agent-preview-diff-logic-sxj5uc`
No ADR. This decides nothing; it makes an existing measurement specific enough to decide from.

## What this was for

The founder asked whether the rules — no model reasoning (43), never read the agent's account of its own work (77), no third-party content in a system prompt (42) — mean Vibe can never know what its agent does or improve it.

Reading the rules rather than the summary of them, the answer is no, and the boundary is narrower than it looks:

- **Rule 77 is about the diff.** *"The changed paths come from Vibe's own observation."* It forbids believing the agent's claim about what it changed. Recording what it does is the opposite of forbidden — it is what `agent_execution_events` exists for, and that table's own docblock calls itself "the technical record".
- **Rule 43 forbids reasoning and explicitly permits** *"validated structured conclusions, short rationale, and evidence references"*.
- **Rule 42 forbids interpolating third-party content** into a system prompt. Vibe's own authored facts already go there; `prompt.ts` interpolates integers from the compiled policy.

So the shape of learning available here is: **Vibe's own measurements change Vibe's own code.** Verifiable, versioned, reviewable, and un-poisonable by a repository. What is given up is fast, fuzzy, self-reported improvement — a real trade, made deliberately.

## The measurement that already existed, and could not be acted on

`context_used` has been recording, per run, how the briefing did. Across fourteen runs:

| | |
|---|---|
| Files offered | 133 |
| Of those, opened | **45** (33.8%) |
| Opened without being offered | **78** |
| Repeated reads | 30 |

**Vibe offers three files so that one gets used, and misses two of every three the agent actually needs.** It has a price attached: `outside_brief_read` was refused **7 times** with the reason `completion_windows_exhausted` — the agent spent its budget reaching for files Vibe should have handed it.

And none of that could be acted on, because `summarizeContextUsage` computed both sets in a loop and returned only their sizes. A ranking cannot be rewritten from a number that says it was wrong without saying where.

## Shipped

`ContextUsage` now carries the paths as well as the counts: `unreadCandidates` in the brief's own rank order — a top-ranked candidate going unread is a different fact from the last one — and `readOutsideContext` in first-read order, because what the agent reached for first is the strongest evidence about what the briefing should have led with. Both bounded at 40 with `pathsTruncated` beside them (rule 27); the counters stay exact whatever the lists lose.

Paths only. A path and a byte count describe a file; they are not a copy of one (rule 26).

## The defect this uncovered before it could bite

`boundEvent` accepted `string`, `number` and `boolean` and turned **everything else into `null`**. A list of paths passed into event metadata would have been written as `null`: the write succeeds, the event exists, and the thing it was added to record is gone.

Arrays are now handled at that boundary — every element through the same redaction and length bound a lone string gets, the element count capped, non-string elements dropped. That is the same argument the file already makes for strings, extended to the shape that would otherwise have slipped past it: an array is a repository-controlled value arriving in bulk.

One property came out of it that was previously accidental: the arrays are listed **after** the counters, because `boundEvent` drops the key that overflows its byte budget. A run with pathological path lengths keeps the numbers, which are exact, and loses the list, which is a sample. The reverse would store paths with nothing to read them against.

## Verified by breaking it

| planted | caught by |
| --- | --- |
| arrays back to `null` | three event cases |
| only the first element redacted | "redacts every element, not just the first" |
| the element cap removed | "caps the element count" |
| a non-string element stored | "drops a non-string element rather than storing it" |
| the paths listed before the counters | "loses the paths before it loses the counts" |
| the brief's rank order discarded | "counts what the run opened against what it was offered" |

The `usage.test.ts` guard *"there is no verdict field to misread"* was updated rather than removed: the field list grew and the property did not. Every field is a count or a path. Nothing here says a change was good, and independent validation remains the only thing that does.

## What this does not do

**It changes no ranking.** `selectSurfaces` and `rankCandidates` are untouched, and that is the point rather than an omission: no run has yet recorded a path, so a ranking change would be built on nothing. Copying the pattern this repository already has — `detectCohortBias` / `correctionForCohort`, which returns exactly 1 for every cohort today — means a learned adjustment must be able to do nothing, and this one would have to.

**It does not close the learning loop.** Validation failures, outcome checks and the run's event stream still feed no decision; `business-measurement` still has no adapter; no diff reader exists across the snapshot tables. What changes is that the one loop with a strong measured signal now records enough to close.

**Nothing has run.** Every number above is from runs completed before this change. The next run is the first that will say *which* files the briefing missed.

## Verified

Domain 7,753 across 448 files · SQL 323 · browser 498 · typecheck · lint 0/0 · build green. No migration — `metadata` is JSONB with a size check, and the in-code bound is stricter than the database's.

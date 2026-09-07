# 0096 - A contradiction is not a measurement

Status: Accepted
Date: 2026-09-07

Extends [ADR 0088](0088-the-internal-operator-console.md), whose console this adds one panel to, and [ADR 0039](0039-documentation-currency.md), whose method it applies to code and data rather than to documents. Changes no execution, approval, merge or billing authority.

## Context

Four defects were found by hand in one week. They are one species:

| What was true in one place | What was false in another | How it was found |
| --- | --- | --- |
| `launch-v1` priced eleven charges | The charges were stamped `retail-v1` | Reading the ledger by chance |
| `agent_tool_events` has no writer | A console panel read it and showed `0` | Opening the console for the first time |
| The registry owns `launch-v1` | `coding-agent/service.ts` had a copy | Writing a test for the first defect |
| Migration files are the source of truth | Two migrations existed only in production | Checking history before adding one |

None of them failed anything. No error, no empty state, no red test. Each produced **a well-formed wrong answer**: a number that reads like an observation and is an artefact of asking the wrong place. That is worse than a crash, because a crash gets fixed the same day.

The existing test suite could not have caught any of them, and the reason is structural rather than a gap somebody left. Every one of the 8,900 tests asks *does this function behave?*, and in all four cases every function behaved perfectly. What was wrong was the relationship **between two places that never meet in one test**.

The internal console could not have caught them either. It counts what happened, and a count is never wrong — only uninteresting.

## Decision

**A contradiction gets its own kind of check, and it is split by what it can be decided from.**

### Static: `src/lib/consistency/`

Rules that read the repository as text. They run in CI on every pull request, take under half a second, and touch no database.

- **A policy version is named only by the registry that defines it.** Comments are stripped first, so a docblock discussing `"retail-v1"` is a record and a literal in code is a second source of truth. This found the live copy in `coding-agent/service.ts` on its first run.
- **A table that is read is written** — in `src/`, or by a database function in a migration. The migration half is not optional: several tables here are written exclusively by `SECURITY DEFINER` functions, and a rule that looked at TypeScript alone would report a dozen false orphans.
- **A table that is read exists** in the schema this repository ships.
- **Every CLAUDE.md rule is indexed exactly once**, because the index added beside it is a second description of the same thing, and a second description with no test between them is precisely this species.

### Live: `src/modules/internal-console/checks/`

Contradictions that need rows to be visible at all. Same module boundary as the console, so the reviewed rule 53 exception, the column allowlist and the operator gate all already apply.

- **A charge names a rate card no policy registry defines.**
- **An operation nothing is carrying** — `running` past the deadline its own type declares, or `queued` long past anything picking it up.

### The split is a decision, not an accident

"A table nobody writes" looks like a live check — count the rows, find the zero — and it is not. A new table legitimately has no rows, so the data can only raise a suspicion where the source answers outright. It stays static. The test for where a check belongs is **what can decide it**, never what is easier to query.

### Acknowledged is kept apart from news

A check that is red every day is a check nobody reads. Some contradictions are historical and correct: thirteen agent charges stamped `core4-dogfood-budget-v1` name a book [ADR 0092](0092-the-agent-runs-as-the-product.md) deleted, and rewriting them would make that era look like it never had economics of its own. Those are listed with the reason that makes them correct and rendered separately, so an **unacknowledged** finding keeps its meaning.

### One definition of "stuck", imported not rewritten

`operations/staleness.ts` already declares a deadline per operation type and `expireStaleOperation` acts on it. The check imports that predicate rather than deriving its own. A second definition of one word is the disease; writing one inside the panel built to detect it would be an unusually direct kind of irony.

The check is nonetheless *broader* than the sweep, deliberately: the sweep leaves `queued` rows alone because failing one races a run about to start. Reporting is not sweeping — and that gap is exactly where a second account erasure sat for eight days holding the account-level active index, so its owner could never ask to delete their account again.

### Three consumers, one implementation

The panel at `/app/internal` is for a person looking. `pnpm consistency:check` is for one who wants an answer without looking — before a deploy, after a migration — and **exits non-zero**, which is the one thing a screen cannot do. Both call `checks/shape.ts`, so they cannot disagree about what a contradiction is.

### Migration drift is a session-start hook, not a fourth check

The two migrations that existed only in production were invisible to everything: `pnpm db:test` builds a fresh PostgreSQL from the files, so CI never sees the real database, and adding production credentials to CI to fix that would be a far worse trade than the drift.

`pnpm db:status` has always answered exactly this question. **Nobody ran it.** So the decision is not to build a check but to run the one that exists: a `SessionStart` hook reports drift in both directions at the start of every session. It never blocks, never writes, and every failure path exits zero with one line — a session that cannot reach the database is an ordinary session.

The project ref is derived from `NEXT_PUBLIC_SUPABASE_URL`'s hostname, never guessed (rule 32), which also makes reaching an unrelated project impossible (rule 33).

## Consequences

**Easier.** The four defects above become build failures rather than discoveries. The static half costs nothing and runs everywhere. A contradiction in live data now has a surface that shows it without being asked, and a command that fails a pipeline over it.

**Harder.** Two more allowlists to maintain honestly — `PERMITTED` in `table-writers.test.ts` and `ACKNOWLEDGED` in `checks/schema.ts`. Both are review records rather than suppressions, and both have a test asserting an entry states a reason and still refers to something real. They will rot if entries are added to make a build green, and nothing here can prevent that.

The console does eight reads per refresh instead of seven.

**What this does not claim.** The static rules are regexes over source, not a parser: a version literal inside an unusual string form, or a table name built by concatenation, is invisible to them. They are a floor, and the floor is documented in each file rather than implied by a passing suite. The live checks are bounded by `SAMPLE_LIMIT` like every other read here, and report a reached bound rather than a quiet undercount.

**Not decided.** Whether the console should be able to *act* on a finding. It still performs no write of any kind, and moving money needs the authorization model [docs/ROADMAP.md](../ROADMAP.md) names as open — a console that can act is a different decision with a different threat model.

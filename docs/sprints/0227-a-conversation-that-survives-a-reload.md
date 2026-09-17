# Sprint 0227 — A conversation that survives a reload

Slice 5 of [ADR 0109](../decisions/0109-nova-first-application-shell.md): Nova's
thread becomes a record. Two tables, a store, a read model, an address, and a
`system` event written wherever a run ends. No composer — this slice gives a
conversation a memory, not a mouth.

**The migration is written, proven against a real PostgreSQL, and not deployed.**
See *What has not been proved* — and the dated bracket there, which records that it
was deployed on 2026-09-17.

## What was wrong

**Nova was a conversation with no memory.** The ranking, the sentence tables,
the bubbles, the blocks and the closed action catalogue all existed and all
worked, and every one of them was re-derived from canonical rows on each load.
There was no *turn*: no thread row, no message, no record of what Nova said or
what happened while the founder was away. A run that finished overnight was
visible only as a changed score.

**And the "Earlier" list is not that record.** It is the last few audit-log
entries, capped, about connections and projects — not about what Vibe did to a
product and how it went.

## What changed

**Two tables, one kind discriminator, per-kind CHECKs.** The idiom
`nova_voice_messages` already uses. A table per message kind is five joins to
read one conversation; a JSON blob is a schema nothing enforces. The CHECKs
*are* the schema, and `schema.test.ts` reads them out of the migration with
`checkedValues` and fails when a TypeScript union and a constraint disagree.

```
nova_threads    project, owner, title, status, the read marker
nova_messages   thread, sequence, author, kind, and the columns each kind needs
```

**An `event` stores no words.** The CHECK refuses them. The sentence a founder
reads is composed on every read from `THREAD_EVENT_WORDS` — the argument
`nova_voice_messages` makes for not storing its fallback text, one layer down:
a stored sentence freezes today's wording into a row that outlives it, and a
reworded product then leaves last month's phrasing on screen with nothing to
reveal it.

**One table decides both which runs are remembered and what they say.**
`THREAD_EVENT_WORDS` is total over `OperationType`; `null` is not-remembered and
is a decision. Six of fifteen are `null`, and the argument is worth keeping: a
prepared change passes through six operations that all draw the same review
block while they run, and six events in a transcript would bury the one a
founder will actually look for — the merge, which is the step that changed what
their repository contains.

**The message is written where the transition is.** Not in each tail: there are
ninety call sites of `completeOperationRun` and `failOperationRun` across
twenty-three files, and those two functions are the only place a run becomes
terminal. They already returned *whether this call performed the transition* —
the exact idempotency signal an append needs, built for replayed workflow steps
— and the columns come back from the update's own `returning`, so remembering
costs no extra read on any path. A new operation type gets a memory by existing.

It can never fail a run. Everything in `rememberOperationInThread` is inside a
`try` that swallows, the standing `speakAfterOperation` already has: a thread
with a gap is a worse product; a merge marked failed because a message could not
be written is a worse incident.

**A founder may write words and nothing else.** `authenticated` has `insert` on
`nova_messages`, and a client controls every byte it sends — so a browser that
could write `author = 'system'` could write a merge that never happened into the
history it later reads back. Two constraints refuse it, and both are asserted
against a real cluster: the RLS policy pins `author` to `founder`, and a CHECK
pins a founder's rows to `text`. There is no delete grant at all; a transcript
with individual turns removed misrepresents what was said.

**`/threads` and `/threads/[threadId]`.** The second is one exact conversation,
for a bookmark or a link. The first resolves to whichever thread is open, which
is what a link from a screen can point at without reading a thread id — and
reading it creates nothing, so looking at a screen never writes a row. Nova's
rail links to it under *Earlier*.

**`src/modules/nova/artifacts.ts`.** The artifact union moved out of
`features/workspace/registry/` into the domain, beside `blocks.ts`.
`nova_messages.artifact_kind` needs it to check its CHECK against, and a module
may not import a feature (rule 86). The registry keeps what it is for: where an
artifact is read, and what draws it.

## The rule that erodes one import at a time

**Deleting every thread must change no canonical fact** (ADR 0109 §6). That rule
does not survive as a sentence in a document, because every violation looks
reasonable on its own: the ranking could remember that a founder dismissed
something; the briefing could avoid repeating itself; the focus could skip a
moment it already mentioned. Together they are the *"transcript as source of
truth"* the Nova architecture audit's §M closed.

So it is `transcript-is-not-a-position.test.ts`: nothing under
`src/modules/nova/` outside `threads/` may import the thread store or its read
model, `focus.ts` and `read.ts` may not mention either table, and the store may
write to nothing but the two tables a transcript is made of. Mutation-tested —
one comment mentioning `./threads/store` in `focus.ts` fails two assertions.

## What was found on the way

**The in-memory double was missing two database defaults.** `nova_threads.status`
and `last_read_sequence` both have one, and the fake modelled neither — so a
thread read back had no status (and was opened twice) and no read marker (so
every turn read as already seen). `last_read_sequence` is now modelled beside
`operation_runs.pause_cycle` and `change_approvals.approved_at`, which are there
for the same reason; `status` is sent explicitly by the store, because the read
that finds an open thread selects on it.

**`/threads` had no first frame.** `loading-coverage.test.ts` caught it before
any browser did. Both thread routes now share one `ThreadSkeleton`, whose
heading is a placeholder rather than a word — a thread's title is its own, so
there is no static string a skeleton and its page could agree on.

## What was decided against

- **A unique index on one open thread per project.** It would have to be dropped
  the moment a founder can start a second one, which is the next slice. A schema
  that has to change to allow a planned feature decided something it was not
  asked to. "The most recent open one" is a read, not a constraint.
- **A `confirmation` message kind.** Whether a proposal needs one is
  `NOVA_ACTION_META.requiresConfirmation` and what happened to it is the
  `action_result`. A third place for the same fact is the one most likely to
  disagree with the catalogue.
- **Enumerating eighteen action ids in a CHECK.** A constraint that had to be
  migrated for every new control is a constraint somebody eventually widens to
  `text`. The migration checks the *shape*; that the id is real is checked in
  code against the catalogue, which is the only place that knows.
- **A retention period.** §E.1 of the audit asks which class a transcript belongs
  to and this slice does not answer it. Both tables are in `NEVER_SWEPT_BY_AGE`
  with that reason: picking a period to fill the gap is exactly the silent policy
  change [ADR 0068](../decisions/0068-retention-periods.md) §7 forbids. Nothing
  deletes a founder's conversation on a clock. Erasure is unaffected — both
  cascade from `projects`.

## What has not been proved

- **The migration has not been deployed.** `SUPABASE_ACCESS_TOKEN` is not set in
  this environment, so `pnpm db:status`, `pnpm db:push` and `pnpm db:types`
  cannot run, and rules 29–34 refuse the SQL-editor fallback. What *was* done:
  `supabase/tests/nova-threads.migration.ts` applies every migration to a
  PostgreSQL cluster the harness creates itself and asserts twenty-one
  properties of the result — the CHECKs, the composite foreign key, the
  column-level grants and the RLS policies, from a real `authenticated` session.
  The SQL is verified; the remote database does not have it. **Deploying is the
  owner's next step**, and until then nothing in the product can write a thread.

  *[Deployed 2026-09-17, after Slice 8, through the Supabase MCP `apply_migration` — the token is still absent. The account of it, including the filename reconciliation and the one new security advisory, is in [the audit's deployment note](../audits/2026-09-16-nova-first-restructure/README.md). This paragraph was true when it was written and stands.]*
- **`src/types/database.ts` is one migration behind, deliberately.** It is
  generated by `pnpm db:types --linked`, which needs the same token. It was left
  alone rather than hand-edited: a hand-written table in a generated file is a
  claim about a database nobody checked. Nothing needs it — the Supabase client
  in this repository is untyped and the store declares its own row shapes.
- **The thread screen was seen in a browser; the thread *route* was not.** The
  routes need a session the browser suite does not have, so `nova-thread.spec.ts`
  mounts the product's screen over a view model the product's own builder
  produced. What that cannot show is the route resolving, redirecting and
  gating — which `workspace-routes.test.ts` asserts as source instead.
- **Node 22 ran the suite; the engine field says 24.**

## Validation

- `pnpm lint` — clean.
- `pnpm typecheck` — clean.
- `pnpm test` — 550 files, 9,660 tests, all passing (545 / 9,612 before; the
  difference is the thread schema, store, read model, the transcript guard and
  the terminal-transition tail).
- `pnpm db:test` — the real-PostgreSQL suite, including 21 new assertions about
  these two tables (459 passing across 30 files).
- `pnpm test:e2e` — 881 passing (876 before; five new).
- Mutation-tested: the transcript guard, and every CHECK the migration test
  asserts (each was written against a statement that violates it).
- Looked at in a browser at 390 and 1280.

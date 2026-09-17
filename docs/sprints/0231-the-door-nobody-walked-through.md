# Sprint 0231 — The door nobody walked through

Slice 7's security pass over the tables Slices 5 and 6 introduced: `nova_threads`,
`nova_messages` and `append_nova_conversation_turn`, attacked on purpose.

**The migration is written, proven against a real PostgreSQL, and not deployed.**
See *What has not been proved*.

## What was wrong

**A founder could not open a thread.** `nova_threads` granted `authenticated`
`select` and a column-limited `update` and no `insert` at all, because when it
shipped the only thing that opened a thread was an operation's terminal
transition under the service-role client. Slice 6 then called `ensureOpenThread`
from `askNovaAction` under the founder's **own session** — so a founder asking
the first question in a project that had never finished a run hit
`42501 permission denied`, and the whole ask failed.

Nine thousand seven hundred tests passed over it. `FakeDatabase` models rows and
not grants, which is exactly the class of defect a double cannot see and is why
`supabase/tests/` exists.

**And a door stood open that nothing walked through.** `insert own
nova_messages` admitted an authenticated founder writing their own
`author = 'founder'` rows. No code has ever used it: the conversation's one
write is the definer function, which is `security definer` and therefore does
not pass through a policy at all, and every other message is written by
`src/modules/operations/` under the service-role client.

So it was reach with no caller — and it was the door every direct-insert attack
goes through. A founder choosing their own `sequence`. A message filed under one
project's thread id and another project's `project_id`. A write into a thread
they had archived in another tab. Rule 11 is least privilege, and an unused
insert grant is not defence in depth.

## What was built

**The grant a founder actually needs, and no more.** `insert (project_id,
user_id, title)` behind a policy that reads ownership off the **project row**,
never off the `user_id` the client sent. The four columns that carry a thread's
state — `status`, `last_read_sequence`, `last_message_at`, `updated_at` — keep
their defaults, so a thread cannot be born archived, born read, or born with a
last message it never had.

**The one nothing needed, revoked.** `authenticated` holds `SELECT` on
`nova_messages` and nothing else.

**Two refusals inside the function**, under the same row lock that already
orders the sequence:

- an **archived** thread. Refused rather than silently reopened: un-archiving is
  a decision, and a write that made it on the founder's behalf would resurrect a
  conversation they closed.
- the **same question twice within ten seconds**. A double press, two tabs, a
  retried action — the lock is what makes the check decisive rather than a race
  of its own.

**A trigger that keeps the read marker moving forward.** `markThreadRead`
compared before it wrote, but the grant is on the column and any client holding
it can send a smaller number. A marker that went backwards re-announces turns
somebody has already read. The store's stated invariant is the database's now.

**And a name for a conversation.** `title` is not a column a founder may update
and nothing else set it either, so every thread a run opened was called *"Your
product"* and stayed called that. It takes the first question asked in it,
inside the same statement that writes the turn. The condition is *no founder
message before this one*, not *this is message one*: a thread holding four run
events and no questions is still being asked its first.

**Four refusals became sentences.** Every one is reachable by an ordinary person
doing an ordinary thing — pressing send twice, returning to a tab whose thread
they archived elsewhere, following a link to a conversation since deleted. None
of them is a fault, so none of them is a 500. `TURN_REFUSALS` is a closed list
precisely so that a fifth one — a genuine fault — keeps throwing rather than
being quietly rendered as a polite sentence.

## The adversarial matrix

`supabase/tests/nova-conversation-security.migration.ts`, 36 assertions, under a
threat model written down in the file: **a signed-in founder with a browser, a
REST endpoint and no scruples.** They control every byte of every request — the
thread id, the project id, `user_id`, `author`, the sequence, the artifact
reference, the action id, and how many requests they send at once. They do not
control `auth.uid()`, and that asymmetry is the whole security model.

| Attempt | Answer |
| --- | --- |
| A thread in another founder's project | `thread_not_found` — the same answer a thread that does not exist gets |
| No session at all | `not_authenticated` |
| `anon` | `permission denied` on the function, and on both tables |
| Forging the author | there is no argument to forge; `pg_get_function_arguments` is asserted |
| Writing a message directly, five ways | `permission denied`, five times |
| Opening a thread in another founder's project, or owned by somebody else | refused by the policy |
| A thread born archived | `permission denied` — `status` is not in the column grant |
| A turn into an archived thread | `thread_archived`, and nothing written |
| An artifact kind or action id from somewhere else | CHECK violation, and the question and the reply go with it rather than leaving half a turn |
| A read marker sent backwards | clamped forward |
| The same question twice | `turn_duplicate` |
| **Eight sessions pressing send at once** | a gapless, collision-free transcript, every landed turn whole |

That last one could not be written with a single connection, so the harness
gained `sqlParallel`: a row lock and a unique index only mean anything under
contention. What it pins is not *how many* win — a duplicate refusal and a
serialisation failure are both legitimate — but that whatever lands is a whole
transcript. Half a turn, two messages at sequence 3, or a gap the read marker
would skip past are each what an unlocked `max(sequence) + 1` produces under
load.

**What a reference can and cannot do** is asserted rather than assumed. A
founder can store a pointer to another project's prepared change: it is text,
and the transcript joins to nothing. It is also harmless, and the test says why
— the address it resolves to is gated by the route that reads it, so the
transcript never became an access path. There is no foreign key from a message
to the thing it points at, and that is checked.

**And the line ADR 0109 §6 draws.** The function names two tables and no others,
`nova_messages` carries no trigger that could reach a canonical one, and
deleting a thread with turns in it leaves the projects, the operation runs and
the product's own name exactly as they were.

## What was corrected in the open

`nova-threads.migration.ts` had four assertions about which *rows* the insert
policy rejected. They now assert that there is no row a founder can offer it,
which is the stronger claim and the one rule 11 asks for. The per-kind CHECKs
those rows were also exercising are proved directly, above, where the writer is
the service role and the constraint is the only thing standing there.

## What has not been proved

- **The migration is not deployed.** `SUPABASE_ACCESS_TOKEN` is not set in this
  environment. The two migrations before it were deployed on 2026-09-17 through
  the Supabase MCP, and this one deliberately was not: applying a production
  migration nobody asked for is not a thing to do on the way past. **Until it
  is, the first question in a project no run has finished in still fails**, and
  *New chat* has no grant to insert under.
- **No model has answered a question here.** Unchanged from Sprint 0228: every
  test uses a double, there is no conversation eval, and
  `NOVA_CONVERSATION_ENABLED` is off by default.
- **The duplicate guard spends before it refuses.** A double submission that
  reaches the model still costs a call: the refusal is decisive at the write,
  which is where the lock is. Free (ADR 0110) and bounded, so the cost is a
  token count rather than a charge — but it is not nothing, and a pre-check
  would be a second read racing the same window.

## Validation

- `pnpm lint`, `pnpm typecheck` — clean.
- `pnpm test` — 557 files, 9,746 tests.
- `pnpm db:test` — 32 files, 505 tests, against a real PostgreSQL cluster the
  harness provisions itself.

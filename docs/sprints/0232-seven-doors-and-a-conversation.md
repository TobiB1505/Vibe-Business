# Sprint 0232 — Seven doors and a conversation

Slice 7 of [ADR 0109](../decisions/0109-nova-first-application-shell.md), finished:
the navigation a founder meets, the workspace beside the conversation, and the
half of Threads that faces a person.

## What was wrong

**A founder arrived at seven equal doors.** Nova, Business Health, My Product,
Action Plan, Agent, Experiments, Project Settings — one list, one weight. Every
one of them is a real destination and none of them is wrong; what was wrong is
that they were *peers*, so the first thing the product asked a founder to do was
choose, before it had told them anything.

The phone had the same screen with a scrollbar: four sections in the bar and the
rest behind *More*, with the split decided by array order. A founder had to know
that the Agent was hiding there.

**The pane had been deferred twice**, and the reason was geometry: at 1280 the
project rail takes 256px and Nova's work column 300 more, leaving the thread
about 640. A third column splits that into two unreadable ones.

**And §E.4 was a genuine contradiction.** ADR 0109 §1 put *Products · New chat ·
Threads · Settings* at the **account** level while §C.9 makes a thread
**project-scoped**. Inventing an answer would have been inventing a product
requirement (rule 14), so Slice 7 shipped its file moves and stopped.

## What was decided

**The owner answered §E.4**, and the answer is the one the ownership model
already implied: the conversation group lives **inside the active product**.
*Threads* at the account level names something that does not exist, and *New
chat* there asks which product.

## What was built

### The rail

```
[ product switcher ]        ← which product this is, and Project Settings
────────────────────────
Nova · Threads · + New chat
────────────────────────
WORKSPACE
Business Health · My Product · Action Plan · Agent · Experiments
────────────────────────
GENERAL
Settings →
```

**Nothing moved.** Every address is the one it was and `PROJECT_SECTIONS` is
still the address table. What changed is that the five stopped being peers of
the conversation: they are the **workspace** — what Nova talks about — named as
a set, below her, one step quieter, and with their counts and the Agent's live
status intact. Demotion is presentation and never reach; the alternative, a
disclosure, trades seven equal doors for one nobody opens.

Which list a section is in is a `group` on the table, so it is a fact about the
section rather than a filter inside a component. The slot builds two arrays and
the rail renders them; the phone's bar is a second rendering of the same two,
which is what stops them drifting.

**`threads` is a row and never a section.** A conversation is a list of rows each
with their own address, not one screen at one segment. `threadsPath` owns that
address, and this is the one rail row built from a path helper rather than the
table.

**The phone has three destinations** — Nova, Threads, and a Workspace tab that
opens the sheet — plus the account behind the avatar. *More* is a place things
are put when they did not fit; **Workspace** is a name for the set, and it is the
same name the rail uses one breakpoint up.

### The workspace

A **query parameter on the conversation's own address**,
`?artifact=<kind>[&ref=<id>]#workspace`, and not a route. A route would have
replaced the conversation, and *returning to it* would then have needed a
mechanism — a stored scroll position, a back stack, a remembered thread. A
parameter needs none: the founder never left, the composer keeps its draft, and
the link is shareable.

Two columns from `lg`, two stacked sections below.
[ADR 0108](../decisions/0108-a-phone-is-not-a-narrow-desktop.md) says a phone
gets a bottom sheet and this is a section instead; the reason is DOM rather than
taste. A sheet is a `<dialog>` and a column is an `<aside>`, and one
server-rendered artifact cannot be in both without being rendered twice — two
business maps, two sets of ids, two of every control inside a review gate.

Five kinds are drawn by the view their owning feature already has; three are
named and opened, with the reason said rather than hidden behind a bare button:
a plan is a sequence read in order, a run is five stages and two live streams,
and a question belongs to the run paused on it. `artifact-views.tsx` has no
`default:` branch, so a ninth kind fails the build until somebody makes the same
decision about it.

The frame holds no read, and that is what makes it visible to a browser: every
artifact read needs a session-scoped Supabase client, and the fixture route has
neither a session nor a database.

### Threads, facing a person

`/threads` was a redirect to whichever thread was open — right while a project
could only have one. *New chat* makes a second possible, and an address that
silently picked one of several would be the product deciding which conversation a
founder meant. It is the list now, with the **current** one marked: the most
recently created open thread, which is where the next run event lands, computed
by the same rule `findOpenThread` applies rather than a second answer.

*New chat* is a button and never a link. Next.js prefetches links, so a
prefetched route that opened a thread would open one nobody pressed. Pressing it
twice does not make two empty threads: the second press means the same thing as
the first.

### Two turns that drew nothing

An `artifact` turn is a pointer and an `action_proposal` is an offer, and both
fell through a null check that was right about a third thing. A pointer that
renders nothing is a turn a founder cannot tell happened.

The chip opens the pane **beside this conversation**; *Open in full* is one press
further, in the pane's own header. The proposal is a line recording that she
offered something — deliberately not the control. A button rendered from a stored
proposal would be a second copy of a priced control, built from a row rather than
from the thing it acts on, and still there a week after the change it was about
had merged.

### A founder's own words

Before the composer they could not occur. Once they could, they were drawn
exactly like a run finishing — so the one line on the screen a founder had
written themselves read as something Vibe had said to them. `NovaBubble` has a
third register, and it is alignment rather than a fifth colour: the register axis
is about the **moment**, and a question is not amber or coral.

## What it cost to fit

The rail holds nine rows where it held seven, and `rail-fold.spec.ts` asks that
all of them fit a 780px laptop without the list scrolling. It was 90px over.
Reclaimed nine at a time: *New chat* became a row rather than a control with its
own spacing, one divider replaced three, rows went from `py-3` to `py-2.5` and
the workspace's to `py-2`, the workspace's gap to 2px, and `--rail-gap` from
1.25rem to 1rem.

Measured, not estimated — each change was built and the overflow re-read.

## What the double could not see

`FakeDatabase` tied on `created_at` at millisecond resolution and kept only the
**last** `.order()` in a chain. Postgres does neither: `now()` is transaction
time at microsecond resolution, and PostgREST applies every ordering key. So a
read of "the most recently created open thread" came back in whatever order the
rows were inserted in, and a list ordered by "last message, then created" was
not ordered by the second key at all. Both are modelled now, and `nulls last`
with them — `nova_threads` is read `last_message_at desc nulls last` precisely so
a conversation nobody has said anything in sorts *after* the ones they have.

Found by `openNewThread`: a founder pressing *New chat* must land in the thread
they just opened, and the fake could answer either.

## What has not been proved

- **No session presses anything.** The browser suite has no session, so *New
  chat*, the composer's submit and the thread list's links are proved as far as
  the Server Action's front door. What a browser does prove is everything before
  that: which group leads, that the pane sits beside the conversation at 1280 and
  under it at 390, that the chip carries the workspace parameter, and that a
  founder's question is drawn as theirs.
- **The pane's three named kinds have never been drawn**, because they are never
  drawn. That is the decision, not a gap.
- **Slice 7's own migration is not deployed**, so *New chat* has no grant to
  insert under in production ([Sprint 0231](0231-the-door-nobody-walked-through.md)).

## Validation

- `pnpm lint`, `pnpm typecheck` — clean.
- `pnpm test` — 558 files, 9,785 tests.
- `pnpm db:test` — 32 files, 505 tests, against a real PostgreSQL cluster.
- `pnpm build` — clean.
- `pnpm test:e2e` — 900 browser tests, including twelve new ones that measure
  the hierarchy rather than assert it.

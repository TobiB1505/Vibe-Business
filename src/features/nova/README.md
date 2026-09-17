# Nova — the surface

The screens Nova speaks on, moved out of the route tree by
[ADR 0109](../../../docs/decisions/0109-nova-first-application-shell.md) Slice 0
([Sprint 0222](../../../docs/sprints/0222-nova-leaves-the-route-layer.md)).
What she _knows_ and _says_ is the domain module,
[`src/modules/nova/`](../../modules/nova/README.md); what she is drawn with is
[`src/components/nova/`](../../components/nova/). This directory is the third
thing: the composition of the two into a screen a route renders.

```
home/       the project index — the ranking mounted as a thread
  nova-home.tsx             the screen; `page.tsx` renders it and nothing else
  nova-home-data.ts         the one composed read, bounded by workspace-routes.test.ts
  nova-home-actions.ts      "use server" — dispatches the five subject-bearing catalogue actions
  nova-dispatch.ts          which actions Home can supply arguments for (pure)
  nova-focus-thread.tsx     bubbles → block → control → asides
  nova-rail.tsx             the work column: mark, sequence, "Earlier"
  nova-control.tsx          the one bound control, with its confirmation
  nova-header-live.tsx      the status row; polls, and refreshes once when a run settles
  nova-agent-live.tsx       the Agent's event tail, accumulating
  nova-agent-stage.tsx      the Agent's build stage, streamed behind Suspense
  nova-ready-stage.tsx      the offer to start a run, with both prices
  nova-agent-events-action.ts  "use server" — the read behind the tail
  nova-opening-screen.tsx   the introduction, once per project
  nova-rise.tsx             the entrance
  footnote.ts               echo suppression between a prompt and its control
  nova-artifact.ts          which workspace artifact a moment is about (pure)
  nova-header-status.ts     what the line under her name says, from the run's phase
thread/
  blocks/                   BlockKind → the owning feature's view, framed
  queries.ts                one thread's three bounded reads, and the list of them
  thread-view.tsx           the stored turns, read back, with the composer under them
  thread-list.tsx           every conversation this product has had, and which is current
  turn-pointers.tsx         the two turns that are not words: a chip, and a recorded offer
  new-thread-button.tsx     *New chat* — a button, because opening one is a write
  commands/new-thread.ts    "use server" — opens one, or reuses an empty one
  thread-skeleton.tsx       the first frame each thread route answers a click with
conversation/
  nova-composer.tsx         the one input in this product
  queries.ts                what a question is answered from, composed from the screens' own reads
  commands/ask-nova.ts      "use server" — the only place generation can happen
bindings/
  nova-actions.ts           catalogue id → the real Server Action or href. Total; the compiler checks it.
voice/
  nova-audit-voice.tsx      Nova's sentence under the business reading
  nova-move-voice.tsx       Nova's sentence above the Moves
```

## What moved and what did not

Every file here came from `src/app/app/projects/[projectId]/` — `nova-artifact.ts`
is the one exception, written in Slice 4 — and each is unchanged inside except
for the imports that used to be relative. The route (`page.tsx`)
now composes `NovaHome` and `NovaOpeningScreen` from here. Nothing a founder
sees changed, no address changed, and every test that pinned a path was
re-pointed rather than loosened.

This directory reaches _up_ for nothing. The Agent's stages, the Plan's views
and the Server Actions it dispatches are all in `src/features/` now (Slices 1–3),
so `feature-boundaries.test.ts` carries no crossing for this feature and none is
available to carry. `features → features` is ordinary: the thread's blocks mount
the Agent's and the Plan's views, which is what a thread composing the product
means.

## The conversation, end to end

`/app/projects/:id` is the ranking as a thread. `/threads` is every conversation
this product has had, with the **current** one marked — current being where the
next run event lands, which is the most recently created open thread, which is
the same rule `findOpenThread` applies rather than a second answer.
`/threads/:threadId` is one conversation, with the composer under it and the
workspace beside it.

A thread is named after the **first question asked in it**, set inside the same
statement that writes the turn. Until there is one it keeps the name Vibe gave
it: a thread a run opened has no question to be named after, and _"Your
product"_ is the honest placeholder. Before this every thread was called that
and stayed called that, which makes a list of conversations a list nobody can
use.

**Two turns are not words**, and both used to draw nothing at all. An `artifact`
turn is a chip that opens the pane beside the conversation; an `action_proposal`
is a line recording that she offered something, pointing at the ranking rather
than growing a button. A stored proposal rendered as a control would be a second
copy of a priced control, built from a row rather than from the thing it acts
on, and still there a week after the change it was about had merged.

**A founder's own words are theirs.** Before the composer they could not occur;
once they could, they were drawn exactly like a run finishing — so the one line
on the screen a founder had written themselves read as something Vibe had said
to them. `NovaBubble` has a third register now, and it is alignment rather than
a fifth colour: the register axis is about the _moment_, and a question is not
amber or coral.

The shape of the conversation is worth restating here, because it is the part
that could erode quietly. Nova has **two lanes**. The conversation lane may
reason and explain over canonical project data and holds no capability — no
tool, no web access, no database handle, no service-role client, no say in what
it reads. The action lane is the binding in `bindings/`, unchanged, with its
existing preflight, price, confirmation and execution path. Generated text is
never the last thing before a consequential effect; a press is.

`features/nova/actions/` was named for Slice 6 and was not built: a proposal is
a catalogue id, and the control it renders is the one `bindings/` already binds.
A directory between them would have been a second answer to a question that has
one.

And the transcript is memory, not truth: deleting a thread must not change
canonical business state, though it may remove what Nova can infer from earlier
dialogue.

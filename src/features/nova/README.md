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
bindings/
  nova-actions.ts           catalogue id → the real Server Action or href. Total; the compiler checks it.
voice/
  nova-audit-voice.tsx      Nova's sentence under the business reading
  nova-move-voice.tsx       Nova's sentence above the Moves
```

## What moved and what did not

Every file here was under `src/app/app/projects/[projectId]/` and is unchanged
inside except for the imports that used to be relative. The route (`page.tsx`)
now composes `NovaHome` and `NovaOpeningScreen` from here. Nothing a founder
sees changed, no address changed, and every test that pinned a path was
re-pointed rather than loosened.

What this directory still reaches _up_ for — the Agent's stages and start
controls, the Server Actions beside the routes, the onboarding actions — is
recorded in `src/lib/consistency/feature-boundaries.test.ts` with the slice
that removes each crossing. `home/` and `bindings/` are the whole of that list
for this feature; `voice/` reaches nothing above it.

## What arrives next, and where

Each lands **beside** `home/`, never inside it, and each is a decision under
[ADR 0109](../../../docs/decisions/0109-nova-first-application-shell.md) §5 and
§6 rather than a feature this README can promise.

| Slice | Directory             | What it is                                                                                     |
| ----- | --------------------- | ---------------------------------------------------------------------------------------------- |
| 1     | `thread/blocks/`      | the nine blocks, out of `src/components`, each mounting the owning feature's view with a frame |
| 5     | `threads/`, `thread/` | the thread list and the turn view, once `nova_threads` and `nova_messages` exist               |
| 6     | `conversation/`       | the composer, the turn rendering, and the one command that generates                           |
| 6     | `actions/`            | a proposal becomes the control the catalogue already defines, and a founder presses it         |

The shape of the last two is the part worth stating here, because it is the one
that could erode quietly. Nova has **two lanes**. The conversation lane may
reason and explain over canonical project data and holds no capability — no
tool, no web access, no database handle, no service-role client, no say in what
it reads. The action lane is the binding in `bindings/`, unchanged, with its
existing preflight, price, confirmation and execution path. Generated text is
never the last thing before a consequential effect; a press is.

And the transcript is memory, not truth: deleting a thread must not change
canonical business state, though it may remove what Nova can infer from earlier
dialogue.

# UI-19 — Agent Workspace (Plan)

Status: Implemented through the stage rail and core; browser-verified. Stage bodies for Preview and Review still sit below the panel rather than inside the stage narrative.

Date: 2026-08-27

Five reference compositions for the Agent route: a ready state, a running state
with a live core, a validation state, a preview state with before/after, and a
review-and-merge state. The brief is that Agent becomes a *wow* surface with
substantial motion.

This plan exists because two things in that brief collide with what the system
can currently say, and both are cheaper to resolve on paper than in a component.

## 1. The five stages are not the system's stages

The reference stepper reads **Understand → Build → Validate → Preview →
Review**. The execution timeline has six phases, and they are different ones
(`src/modules/coding-agent/observability/timeline.ts`):

    preparing · working · reviewing_change · preparing_branch · validating · finished

More importantly, **Preview and Review are not phases of an agent run at all.**
They are gates on the *prepared change* that the run produced — separate durable
objects, separate operations, separate stage vocabularies (`restoring_artifact`,
`starting_server`, `capturing_before`, `capturing_after`), and one of them is a
human decision rather than a machine state.

So the stepper spans two objects. The honest mapping:

| Reference stage | Real source | Complete when |
|---|---|---|
| 1 Understand | agent phase `preparing`, plus the `file_read` events the harness recorded | `workspace_ready` |
| 2 Build | agent phase `working` | `agent_finished` |
| 3 Validate | agent phases `reviewing_change` + `preparing_branch` + `validating` — Vibe's own verification of the candidate, then independent sandbox validation | `validation_completed` |
| 4 Preview | the prepared change's preview operation and its review artifacts | preview reachable / captures persisted |
| 5 Review | human approval, then safe merge | `human_approved`, then a verified branch read-back |

Two rules the existing code already enforces and this stepper inherits:

- **An unrecognised position leaves every row pending.** "We do not know where
  this is" and "it is at the start" are different answers. `operationProgressSteps`
  already refuses to guess, and so must this.
- **`skipped` is not `pending`.** A terminal run that never reached a phase
  reads "we never got there", not "not yet" — the difference matters to somebody
  deciding whether to keep waiting.

And one new one, because stage 4 can legitimately never happen: a preview is
temporary and optional. The stepper must be able to render stage 4 as *not
applicable* rather than parking it at pending forever.

**This needs a new view model** — `agentWorkspaceView(run, preparedChange)` in
`src/modules/coding-agent/` — spanning the execution timeline and the prepared
change workspace card. It is a projection, never stored: a second source of
truth for progress disagrees with the event log at the worst possible moment.

## 2. What the references show that the system cannot say

Real, already backed by stored data:

- The credits chip (`app-shell`), the task headline, lens, impact and effort chips
- "Vibe will …" — the proposed change spec
- Files changed, lines added/removed — **verified candidate counts**, not the
  number of files the runtime touched. Those are different numbers.
- The live activity feed with real paths and timestamps — execution events
- Before/After captures — review artifacts
- The GitHub pull request panel — the merge module
- Validation rows: type safety, linting, tests, production build — these are
  real sandbox stages (`typechecking`, `testing`, `building`)
- Stop run

Not backed, and each needs a decision rather than a component:

- **"Estimated time ~1–2 hours."** No estimator exists. An agent run's length
  depends on a repository nobody has measured, which is the same reason this
  codebase refuses progress percentages. Either drop it, or show elapsed time,
  which is true.
- **"Expected changes 8–15 files."** Unknown before the run. After it, the real
  count exists and should replace it.
- **"Security scan"** is not in the validation vocabulary. Adding a row for a
  check that does not run would put a green tick on something nobody did.
- **"Ask or guide Vibe…"** is not a capability. It would feed customer free
  text into a running agent's prompt, which CLAUDE.md rule 42 forbids —
  instructions to a model come only from prompts we author. The existing
  interrupt mechanism is the opposite shape: *Vibe* asks a closed question and
  validates the answer. Building a steering channel is an ADR, not UI.
- **"Merge & deploy"** and "changes will be deployed automatically" — rule 74.
  Vibe calls no deployment provider and must never claim it does. But it also
  must not claim no production effect: moving a default branch can trigger the
  customer's own CI/CD, and the user has to be told that before the click.
  The button says **Merge**, and the line under it says what merging does.

## 3. Motion is currently forbidden here

DESIGN.md names exactly two signature surfaces — Business Brain and Product
Scan — and says the exception "must not be copied into settings, billing,
tables or ordinary dashboard cards." Agent is currently an ordinary surface.

Making it the third signature surface is a **contract amendment**, not an
implementation detail: DESIGN.md and UX-CONTRACT.md have to be changed in the
same commit, or they become false at HEAD (rule 83).

The budget, modelled on the two exceptions that already work:

- Entrance choreography settles within ~1.5s. After that only a slow core
  breath and one bounded signal path stay alive.
- Document visibility pauses continuous motion.
- `prefers-reduced-motion` makes every state change immediate and removes
  transforms and pulsing **without hiding content**.
- One new stored event may create one bounded impulse and a short in-slot
  emphasis. It may not animate layout geometry, and existing events do not
  replay on mount.
- No random particles, no fake messages, no motion that implies a percentage
  the backend cannot measure. The core may breathe while a run is live; it is
  still while nothing is running.
- Desktop geometry is reserved before the first event, so an arriving event
  never grows the page.

## 4. Stack

No new UI infrastructure. Tailwind v4, the existing primitives (`Surface`,
`MonoLabel`, `StatusPill`, `Metric`, `Disclosure`, `EmptyState`) and
`motion` v13 — already a dependency — cover every composition in the
references. shadcn/ui would be a new distribution model and a second component
vocabulary for zero capability this brief needs; adopting it is a decision
(rule 3), not a step in this sprint.

`AgentExecutionLiveView` already exists and was written to be mounted here:
it takes a model, reads nothing, knows about no route, and has a
`developerDetails={false}` mode for exactly this customer-facing case. Stages 1
to 3 should reuse it rather than growing a parallel implementation.

## 5. Build order

1. `agentWorkspaceView` — the five-stage projection over the execution timeline
   and the prepared change. Unit-tested against every stage combination
   including the ones that never reach preview.
2. The stepper component, driven only by that view model.
3. The signature core: idle, working, and settled variants, with the motion
   budget above and a reduced-motion path asserted in a browser test.
4. Stage bodies — 1–3 reuse `AgentExecutionLiveView`; 4 is the before/after
   pair from review artifacts; 5 is the existing approval and merge panels.
5. DESIGN.md and UX-CONTRACT.md amended to name Agent as the third signature
   surface, with its budget written down.

## Decisions taken

- **Agent is the third signature surface.** DESIGN.md and UX-CONTRACT.md carry
  it and its motion budget.
- **Estimates are out.** Counts shown are counts Vibe recorded; a unit test and
  a browser test each forbid a duration, a range or a percentage appearing on
  the surface at all.
- **The steering input is out of this sprint** and needs its own ADR before it
  could be built.

## What importing the design changed

The reference set carried a sixth artboard the plan had missed: the run stops
and asks a question, everything mint turns amber, and the orb holds.

`needs_user` is a real operation status, and the first implementation had no
state for it — so the stage a run had stopped on kept rendering as *in
progress*. A stepper narrating work nobody is doing, which is the exact failure
this file argues against three sections earlier. `paused` is now its own stage
state and its own core state, with the tests to hold it.

The imported tracker also knows only three states where the run has seven. The
rail keeps the design's ring, fill, connector and travelling band, and extends
its vocabulary for `failed`, `paused`, `skipped` and `not_applicable` — with
`skipped` and `pending` deliberately different in mark, fill, label and words,
because that pair is the one every stepper renders identically.

The travelling band loops rather than advancing, which is the design's own
choice and the right one: it says *this is where the work is*, never how far
along it is.

`globals.css` said the reveal timings "belong to the separate motion sprint".
This was that sprint, so the design system's `--duration-*`, `--stagger-row`
and the two step keyframes now live there instead of as magic numbers in a
component.

# UI-S3 — The loop the UI never drew

Status: Implemented, browser verification green, not dogfooded

Date: 2026-08-27

## Outcome

The domain had every link in the loop. `business_opportunities` records the
audit conclusion it answers; `prepared_changes` records the opportunity and set
it was prepared for; `buildOpportunityActionState` decides per Move whether
Vibe has an executor. **None of it reached the screen as a relationship.**

What a founder experienced: select Move 3 on the Action Plan, click Agent in
the rail, arrive at a page that has never heard of Move 3. The engineer's card
stated three project-level booleans and the prepared changes below it were an
undifferentiated list, so on the screen whose whole promise is *an engineer
working on one named business problem*, the one thing neither half could say
was which problem.

Every cross-surface link in the workspace was a bare section link, and three of
them named a Move in the same breath they dropped it:

- `home-status.tsx` labelled its control **"Review this move"** and opened the
  plan on whatever was rank 1 at click time;
- `next-move-card.tsx` named the top Move by title and did the same;
- `change-origin.tsx` quoted a Move at length under *"what this change was
  for"* and linked to nothing at all.

`planMoveHref` — the function that fixes all three — already existed and had
**zero callers**. Which is also why nobody had noticed its fragment pointed at
`#plan-this-move`, an anchor rendered by nothing: a dead fragment throws
nothing and logs nothing, and there was no link to follow it with.

## What shipped

**One parameter, two surfaces** ([ADR 0058](../decisions/0058-move-focus-url-contract.md)).
`?plan=<opportunityId>` names which Move a surface is about, and the Agent now
reads the same parameter the Action Plan has used since ADR 0028.
`action-plans/source.ts` owns the name, both hrefs, the sanitizer and the
fragment — and `PLANNED_WORK_ANCHOR` moved there from the panel that renders
it, so the link and its target cannot drift apart again.

**`buildAgentFocus` carries `OpportunityActionState` rather than restating it.**
This was the load-bearing decision. A second enum on the Agent for "can Vibe
execute this" would eventually disagree with the plan's, and the disagreement
would be the Agent offering work the plan had already called blocked. Passing
the state through makes the two screens read one decision instead of agreeing
by coincidence — and the test that pins it asserts what `agent-focus.ts` must
*not* contain (`executionReadiness`, `resolveExecutionCapability`), because a
duplicated derivation is invisible in a diff that only adds.

**A fourth state was needed and was not in the plan.** `none`, `unresolved` and
`focused` left one case conflated: a Move that exists while
`getOpportunityExecutionSummaries` returns nothing, which happens for exactly
one reason — no repository snapshot. Routing that to `not_automated` would have
blamed the Move for a gap in Vibe's own context, which is the shape of falsehood
rule 44 exists to prevent. `unavailable` says the true thing instead.

**Two existing contracts rejected the first attempt, both correctly.**
`command-center-ui.test.ts` refused the copy *"Vibe is writing a change for
this move right now"* — this surface narrates no work in flight, because it
does not poll and a present-tense sentence would keep claiming activity long
after the run ended. And `change-origin-ui.test.ts` pinned the exact expression
that decides origin-versus-rationale, so widening it was a deliberate edit with
a stated reason rather than a silent one.

**The rail carries the selection on one item.** Agent, and only while the
current route is the Action Plan. `useSearchParams` is synchronised with the
workspace's `window.history.pushState`, so it follows the live selection with
no state of its own. Deliberately not a general propagate-the-query-string
rule, which would send checkout returns and audit context to destinations they
mean nothing to.

**The three misleading cards were repaired**, which cost one column on a select
already being made (`DashboardMove.id`) and one field on a view model that
already held the row (`HomeNextMove.id`).

## What it deliberately did not do

**Nothing on the Agent starts work.** `AgentPanel`'s own contract — this card
describes readiness and points at where work is chosen — was not relaxed by
giving it a focus, and a test asserts the card contains no `PrepareChangePanel`,
no `formAction`, no `CreditPrice` and no `<form>`. Preparing a change stays
beside the Move, behind a confirmation, with its price stated (rule 60,
[ADR 0014](../decisions/0014-first-execution-safety.md)).

**No live agent run.** The ROADMAP entry *"No surface can show an agent run in
flight"* is untouched and still true: `coding-agent/store.ts` has no
project-scoped read, and adding one is its own sprint.

**No backend change** — no migration, no schema, no new operation, no provider
call, no money spent. The only read-model change is one field the workspace
already had in hand.

## Cost of a focused visit

Three additional reads, all scoped to one Move, all skipped entirely without a
valid id: `getOpportunityExecutionSummaries`, `getActivePreparationFor`,
`getLatestFailedPreparationFor`. An unfocused visit to the Agent — which is
already the most expensive route in the workspace — costs exactly what it did
before.

## Not proved

Nothing was dogfooded against real data. Every browser assertion runs against
the fixture route, so [rule 69](../../CLAUDE.md) has three of its four. The
rail carry-over in particular is asserted only at the source level: it depends
on `useSearchParams` staying synchronised with a `pushState` the workspace
performs, and no fixture route renders the rail and the workspace together.

(lint 0 errors / typecheck clean / **6,700 tests across 383 files** / build
green / **366 E2E** green; [ADR 0058](../decisions/0058-move-focus-url-contract.md))

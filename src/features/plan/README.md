# Plan

The Action Plan: the Moves an audit produced, the steps under the one a founder
chose, and the controls that start work on them.

Moved out of `src/app/app/projects/[projectId]/plan/` by
[ADR 0109](../../../docs/decisions/0109-nova-first-application-shell.md) Slice 2.
`prepare-change-panel.tsx` came from the route root with it, because its only
caller is the plan's detail panel.

```
action-plan-workspace.tsx   the orchestrator: selection, polling, the router
move-stepper.tsx            choosing which Move
move-card.tsx               one BusinessOpportunity and what Vibe can do about it
plan-detail-panel.tsx       the steps, the attestations, the handoffs
plan-complete-card.tsx      what a finished plan settled on
attestation-form.tsx        "I did this", for a step Vibe cannot execute
handoff-card.tsx            the compiled prompt for a step Vibe hands over
moves-refresh-bar.tsx       re-running the opportunity engine
plan-generating.tsx         the wait
prepare-change-panel.tsx    starting a change from a Move
```

What a Move _is_, how one is ranked and whether Vibe may execute a step stay in
[`src/modules/opportunities/`](../../modules/opportunities/README.md),
[`src/modules/action-plans/`](../../modules/action-plans/README.md) and
`src/modules/execution/`. This directory renders their answers and binds their
actions; it decides nothing about them.

`?plan=<opportunityId>` and `#planned-work` are owned by
`modules/action-plans/source.ts` under [ADR 0058](../../../docs/decisions/0058-move-focus-url-contract.md)
and did not move.

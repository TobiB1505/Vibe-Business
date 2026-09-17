# Agent

The surface of one prepared change: what the agent did, what Vibe checked, what
a founder is being asked to approve.

Slice 2 brought the whole surface: the thirty-two components of the Agent
workspace, the seven gate panels that were loose in the route root, the change
views beside them, and `diff-view.tsx`, which arrived in Slice 1.

```
agent-workspace-panel · agent-stage-rail · agent-stage-navigation   the frame
agent-ready-stage · agent-build-stage · agent-validate-stage
agent-preview-stage · agent-merge-stage                            the five stages
agent-core · agent-activity · agent-file-activity · agent-run-files  what a run is doing
agent-task-panel · agent-run-task-header · change-meaning · change-origin
change-rationale · change-history-table · withheld-paths            what a change is for
approval-panel · merge-panel · preview-panel · review-panel
validation-panel · discard-panel · outcome-panel
business-impact-panel · change-diff-section · diff-view             the gates
agent-start-* · agent-validate-action · agent-workspace-choice-*    the controls
```

`agent-stage-actions.tsx` is the one file that mounts the gate panels, and it
renders no control of its own — which is why the action allowlists in
`approval-ui.test.ts` find nothing there and say so rather than passing
vacuously.

**Four types went the other way.** `AgentTask`, `ValidationCheck`,
`PreviewChange` and `MergeSummary` were declared in these components and
imported by `modules/coding-agent/agent-workspace.ts` — a domain read model
depending on where a component kept its props. They live in
[`src/modules/coding-agent/workspace-view.ts`](../../modules/coding-agent/workspace-view.ts)
now and the components import them, which is the direction that was always
correct. `ChangeCost` moved to `modules/credits/change-cost.ts` for the same
reason.

Nothing about what a run may do, who may authorize one, or what `merged` means
changed when these files moved. That is
[`src/modules/coding-agent/`](../../modules/coding-agent/README.md),
[`src/modules/execution/`](../../modules/execution/README.md), `approvals/` and
`merge/`, and it is untouched: an approval still binds to one immutable commit,
a merge is still a fast-forward verified by read-back, and no component here
can widen either.

`agent-execution-live-view.tsx` is here because it was inside
`src/modules/coding-agent/ui/` — a screen in the domain layer — and nothing
mounts it. Slice 8 deletes what nothing reaches.

The Server Actions this surface binds are still in the route tree; Slice 3
gives the feature a `commands.ts` and closes those entries in the boundary
register.

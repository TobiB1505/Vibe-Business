# Agent

The surface of one prepared change: what the agent did, what Vibe checked, what
a founder is being asked to approve.

Only `diff-view.tsx` lives here so far — the rendered diff of a prepared
change, moved out of `src/components/change/` by
[ADR 0109](../../../docs/decisions/0109-nova-first-application-shell.md) Slice 1
because it is the whole view of one canonical object. Slice 2 brings the rest:
the thirty-five files of `src/app/app/projects/[projectId]/agent/`, the gate
panels beside them, and the `AgentTask`, `ValidationCheck`, `PreviewChange` and
`MergeSummary` types that currently sit in the route tree with two domain files
borrowing them.

Nothing about what a run may do, who may authorize one, or what `merged` means
changes when those files move. That is [`src/modules/coding-agent/`](../../modules/coding-agent/README.md),
[`src/modules/execution/`](../../modules/execution/README.md),
`approvals/` and `merge/`, and it is untouched.

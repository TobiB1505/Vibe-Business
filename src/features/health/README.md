# Business Health

The diagnosis: the nine lenses, the score, the evidence behind each finding,
and the controls that run or re-run an audit.

Moved out of the route tree by
[ADR 0109](../../../docs/decisions/0109-nova-first-application-shell.md) Slice 2 —
`health/content.tsx`, both `business-brain/` components, and the audit
lifecycle, notice and control components that sat beside them in the route
root.

```
content.tsx             the screen, and today still its own loader
audit-overview.tsx      the reader, over one BusinessBrainView
audit-intelligence.tsx  the lens tabs, the findings, the evidence drawer
business-map.tsx        the nine-lens constellation
audit-lifecycle.tsx     preparing · analysing · waiting
audit-credit-notice.tsx what an audit will cost before it starts
audit-evidence-notice.tsx what the audit could not see
run-audit-button.tsx    the control, with its price
needs-user-panel.tsx    a question the audit paused for
provenance-panel.tsx    what a paid action would be built on
reasoning-trail.tsx     one BusinessConclusion, in full — mounted by nothing today
home-status.tsx         the pre-Nova project home — mounted by nothing today
```

The diagnosis itself is [`src/modules/business-audit/`](../../modules/business-audit/README.md),
and `buildBusinessBrainView` is in `src/modules/projects/`. Unknown is never
bad: a lens the evidence cannot support scores `null`, is excluded from the
average and is never drawn as zero — that rule lives in the module and this
directory does not get to soften it.

`#business-audit` is published by `modules/opportunities/view.ts` as the
recovery anchor for a blocked opportunity set, and `/health` still renders this
screen at its own address.

The two files nothing mounts are listed above rather than quietly kept; Slice 8
deletes what nothing reaches.

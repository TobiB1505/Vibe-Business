# modules/approvals

Approval Layer — see [ARCHITECTURE.md §3.10](../../../ARCHITECTURE.md#310-approval-layer). Enforces that merges to the default branch only ever follow an explicit, attributable user action, per [PRODUCT.md §9](../../../PRODUCT.md#9-approval-model).

Built. An approval is a row binding one person's decision to one immutable artifact identity — project, prepared change, commit, base, validation run, review artifact and policy version, hashed, with a partial unique index on it ([ADR 0018](../../../docs/decisions/0018-human-approval-authority.md)). `identity.ts` is what makes "approved" mean *approved this exact commit*: change any part of the artifact and the old consent no longer covers it.

An approval authorizes nothing on its own. Whether a merge may happen is a second question, asked against live repository state immediately before the write by `modules/merge` ([ADR 0019](../../../docs/decisions/0019-safe-approved-change-merge.md), rules 68, 70).

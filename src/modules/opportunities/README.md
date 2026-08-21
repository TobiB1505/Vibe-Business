# modules/opportunities

Opportunity Engine — see [ARCHITECTURE.md §3.5](../../../ARCHITECTURE.md#35-opportunity-engine). Converts audit output into a small, ranked set of opportunities, per [PRODUCT.md §11](../../../PRODUCT.md#11-opportunity-model).

Built ([Sprint 8](../../../docs/sprints/0008-opportunity-engine.md)). One paid call ranks a small set of opportunities under a versioned rubric held in source control (`rubric.ts`), and every opportunity carries the audit conclusion it addresses (`sourceConclusionKey`) so the lineage from finding to move is data rather than inference.

Its input is the Business Readiness Audit, which lives in [`modules/business-audit`](../business-audit) — `modules/audits` is a reserved name that was never used.

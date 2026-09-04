# modules/onboarding

Getting one project from "connected" to "understood" — see [ARCHITECTURE.md §3 "Layers with no section above"](../../../ARCHITECTURE.md#layers-with-no-section-above) and [ADR 0023](../../../docs/decisions/0023-project-scoped-onboarding-orchestration.md).

**Onboarding is orchestration, not another copy of the product.** It owns no audit, no profile and no opportunity; it owns the order in which a founder meets them, and the ability to resume that order later.

## Persisted for routing, derived for truth

The stored row makes routing resumable — a founder who closes the tab comes back to the right screen. But the _state_ is derived again from the canonical records: the Product Profile, the audit, the opportunities.

That is the point. An operation that finishes while the founder is away cannot leave the journey stranded, because nothing reads the stored state as authority. If the audit exists, the audit step is done, whatever the row says.

## Project-scoped, not account-scoped

A second project starts its own journey. Onboarding is a property of a project's history, not of a person's, so connecting a new repository does not skip the steps just because another project once completed them.

## The contradiction `audit-surface.ts` exists to remove

A founder could answer "I don't have a live site yet", have their product understood from code alone — and then reach an audit step that demanded a live URL, offered no way past it, and could not be completed. **Their answer stopped being true one screen after they gave it, and the only exits were the back button and closing the tab.**

The fix is a surfacing decision rather than a new state, because the canonical records already contain the answer: `live_site_status` records what the founder said, and the live-product snapshot records what Vibe actually managed to read. "Parked" is what those two facts mean together — derived, never stored, so it cannot drift out of step with the records.

Both the screen and the completion action call the same function, which is what makes "the button is offered" and "the action allows it" one decision rather than two that can disagree.

## What lives here

| File               | Purpose                                                                   |
| ------------------ | ------------------------------------------------------------------------- |
| `state.ts`         | The states and phases, and deriving the current one from canonical facts. |
| `audit-surface.ts` | What the audit step shows, and whether onboarding may end.                |
| `store.ts`         | The persisted row, the milestones, and the routing a screen asks for.     |

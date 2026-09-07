import { MoveCard } from "@/app/app/projects/[projectId]/plan/move-card";
import type { BusinessOpportunity } from "@/modules/opportunities/schema";
import type { OpportunityActionState } from "@/modules/execution/view";

/**
 * A Move, shown before it is paid for.
 *
 * ## Why this one is a block rather than a link
 *
 * "Plan this" costs twenty Credits and "Look at this move" is a navigation, and
 * both were offered with nothing but their own label. A founder pressed the
 * first without seeing the problem it addresses, or pressed the second to go
 * and find out — which is a trip taken because the thread would not say.
 *
 * The block says. `MoveCard` is the card the Action Plan renders: the rank, the
 * headline, the problem in the opportunity's own words, what it depends on,
 * impact, effort, and how confident Vibe is that the problem exists at all.
 * Reading it is what makes a priced control a decision rather than a gamble.
 *
 * ## What it deliberately does not carry
 *
 * The control. A Move block is a *view* — the price and the button sit beside
 * it in the thread like every other control, so a founder is never a mis-click
 * away from spending inside something they are reading. That is also why the
 * card gets a `block` variant rather than the block getting a card frame: two
 * surfaces around one object is the tell that something was pasted.
 */
export function MoveBlock({
  opportunity,
  execution,
}: {
  opportunity: BusinessOpportunity;
  execution: OpportunityActionState | null;
}) {
  return <MoveCard opportunity={opportunity} execution={execution} variant="block" />;
}

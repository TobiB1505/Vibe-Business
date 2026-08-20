import type { BusinessOpportunity } from "@/modules/opportunities/schema";

/**
 * Where a change came from (UI-5 dogfood).
 *
 * ## Why this is not a rationale
 *
 * `business-rationale.ts` answers "why should this change matter", and it
 * answers it **per capability**: `nextjs_seo_foundations_v2` always adds the
 * same two files for the same reason, so the sentence is hand-written, static,
 * and held to the same causal-language checker as a measured result.
 *
 * An agent-produced change has no such sentence and cannot have one. Its
 * capability is `agentic_execution_v1` for every change an agent ever writes,
 * so a per-capability rationale could only say something true of all of them
 * and informative about none. The first real dogfood made the consequence
 * visible: the card opened with a status line and then a branch name, because
 * `businessRationaleFor` returned null and the rationale section rendered
 * nothing at all.
 *
 * What an agentic change *does* have is the Move it was asked to address. That
 * is a different claim level and has to be labelled as one — it is the
 * **request**, written before the change existed, by a model, and it says
 * nothing about what the change achieved. Rendering it under "What Vibe
 * changed" would be exactly the collapse the rationale module exists to
 * prevent.
 *
 * ## Why the shape is narrow
 *
 * A `BusinessOpportunity` carries evidence ids, audit dimensions, readiness,
 * dependencies and confidence. None of that belongs in a card, and passing the
 * whole object to a client component would ship all of it to the browser. Three
 * fields cross the boundary, and they are the three a person reads.
 *
 * ## What this text is
 *
 * Model output (CLAUDE.md rules 25 and 45). It is rendered and nothing else:
 * never interpreted, never fed back into a prompt, never treated as evidence
 * for a decision. It is also already on screen elsewhere — the Moves panel
 * renders the same two paragraphs — so this is a second view of text the user
 * has seen, not a new class of claim.
 */

export type ChangeOrigin = {
  /** The Move's own title, as the user already saw it on Next moves. */
  title: string;
  /** What was wrong or missing, stated as a current-state problem. */
  problem: string;
  /** Why it deserved attention now rather than later. */
  whyNow: string;
};

/**
 * The origin for a Move, or null when there is none to show.
 *
 * Null is a real answer: a prepared change whose Move has been superseded, or
 * whose set is no longer readable, gets no origin section rather than an empty
 * one. The same call `businessRationaleFor` makes.
 */
export function changeOriginFrom(opportunity: BusinessOpportunity | null): ChangeOrigin | null {
  if (!opportunity) return null;

  return {
    title: opportunity.title,
    problem: opportunity.problem,
    whyNow: opportunity.whyNow,
  };
}

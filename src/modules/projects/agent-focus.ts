import type { BusinessOpportunity } from "@/modules/opportunities/schema";
import type { OpportunityActionState } from "@/modules/execution/view";

/**
 * Which Move the Agent page is about (UI-S3 §2).
 *
 * ## The gap this closes
 *
 * A founder selects a Move on the Action Plan and opens the Agent. Until now
 * the Agent had never heard of it: the card stated three project-level facts —
 * what Vibe knows about the product, the code and the business — and the
 * prepared changes below it were an undifferentiated list. The relationship the
 * database has held all along (`prepared_changes.opportunity_id`) reached no
 * screen, so the product's central promise, *an engineer working on one named
 * business problem*, was the one thing neither screen could say.
 *
 * ## Why this is a module and not JSX
 *
 * The same reason `command-center.ts` is: every rule here is a rule about
 * absence, and absence reads as correct in a component while being wrong.
 *
 *  - A Move id that names nothing in this project's current set is
 *    `unresolved`, and `unresolved` shows **nothing** — never rank 1 in its
 *    place. Substituting a different Move than the one asked for would make
 *    every sentence on the card a claim about work the founder did not choose.
 *  - No parameter at all is `none`, which is not the same state: the founder
 *    arrived at the Agent directly, and the page is exactly what it was before
 *    this file existed.
 *
 * ## Why it carries `OpportunityActionState` rather than its own enum
 *
 * Because "can Vibe execute this Move" already has an owner —
 * `buildOpportunityActionState` — and the Action Plan renders its answer. A
 * second enum here would be a second derivation, and two derivations of the
 * same question eventually disagree: the Agent would offer to work on a Move
 * the plan had already marked blocked, or call something automated that has no
 * executor. Passing the state through means the two screens are reading one
 * decision, not agreeing by coincidence.
 *
 * ## What it may not do
 *
 * Authorize anything. A focus is an address a URL carried, and a URL is
 * untrusted. The Agent may render `Run with Vibe`, but that control re-resolves
 * the existing allowlisted plan step and every start premise on the server;
 * no value produced here grants admission or spends anything (Rule 60).
 */

/** The Move, narrowed to the three fields a person reads on the Agent card. */
export type FocusedMove = {
  id: string;
  /** The engine's persisted rank, never a positional index. */
  rank: number;
  title: string;
};

export type AgentFocus =
  /** No Move was named. The Agent page is exactly what it always was. */
  | { kind: "none" }
  /**
   * A Move was named and this project has no such Move — superseded by a newer
   * set, or belonging to someone else. Renders nothing; never substitutes.
   */
  | { kind: "unresolved" }
  /**
   * The Move is real, and Vibe cannot yet say what it could do with it —
   * there is no repository snapshot to resolve a capability against. A
   * statement about Vibe's own context, never about the Move, which is why it
   * is not `not_automated`: that would blame the work for a gap in the setup.
   */
  | { kind: "unavailable"; move: FocusedMove }
  /** One Move, with the execution answer the Action Plan is reading too. */
  | { kind: "focused"; move: FocusedMove; action: OpportunityActionState };

export type BuildAgentFocusInput = {
  /**
   * The sanitized `?plan=` value. Null when absent or rejected — this module
   * never sees raw URL text.
   */
  requestedOpportunityId: string | null;
  /**
   * The project's current Moves. Empty or absent yields `unresolved` for any
   * request, which is the honest answer: nothing here can be confirmed.
   */
  opportunities: readonly BusinessOpportunity[];
  /**
   * What Vibe may do about the requested Move, from
   * `buildOpportunityActionState`.
   *
   * Null when no execution summary exists for it at all, which happens for one
   * reason: `getOpportunityExecutionSummaries` returns nothing until a
   * successful repository snapshot exists. That is a missing premise, not a
   * verdict on the Move — see `unavailable` above.
   */
  action: OpportunityActionState | null;
};

export function buildAgentFocus(input: BuildAgentFocusInput): AgentFocus {
  if (input.requestedOpportunityId === null) return { kind: "none" };

  const move = input.opportunities.find((entry) => entry.id === input.requestedOpportunityId);
  if (!move) return { kind: "unresolved" };

  const focused: FocusedMove = { id: move.id, rank: move.rank, title: move.title };

  if (input.action === null) return { kind: "unavailable", move: focused };

  return { kind: "focused", move: focused, action: input.action };
}

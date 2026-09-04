import type { RetailOperationKind } from "@/modules/credits/retail";

import type { ProvenanceChain, ProvenanceLink, ProvenanceLinkKind } from "./chain";

/**
 * Which evidence each paid action is derived from.
 *
 * ## Why a total map
 *
 * Because a partial one is how this exact class of thing gets forgotten.
 * `operations/staleness.ts` records the cost: its deadline map was `Partial`,
 * eleven of fifteen operation types were simply absent, and a workflow that
 * died left those operations `running` forever with the UI showing a spinner.
 * Nothing failed; the feature was just gone. So this is `Record`, and a new
 * priced operation cannot arrive without the compiler asking what it rests on.
 *
 * ## What an empty chain means
 *
 * That the action **produces** evidence rather than consuming it. A Deep Scan
 * observes the authenticated product; there is nothing upstream of it to be out
 * of date. Empty is a real answer here, not a gap — which is why it is written
 * out with its reason rather than left off the map.
 *
 * ## What this map is not
 *
 * It is the **evidence** chain, and evidence is not the only thing an action
 * can rest on. An agent execution also rests on a prepared change, a sandbox
 * validation and a human approval bound to one immutable commit (rules 66-68),
 * and none of that is modelled here. Claiming otherwise would be the traffic
 * light again — a surface that looks complete and quietly is not. What this
 * says about `agent_execution` is true and partial, and the panel that renders
 * it says "what this will be built on", never "everything is fine".
 */
export const PROVENANCE_CHAINS: Record<RetailOperationKind, readonly ProvenanceLinkKind[]> = {
  /** Assembles Vibe's understanding from the two scans, and nothing else. */
  product_understanding: ["repository_scan", "live_scan"],

  /** Produces evidence. Nothing upstream of it can be stale. */
  deep_scan: [],

  business_audit: ["repository_scan", "live_scan", "product_profile"],

  opportunity_generation: ["repository_scan", "live_scan", "product_profile", "business_audit"],

  /** A plan turns one Move into steps, so the Move set is in its chain. */
  action_plan: [
    "repository_scan",
    "live_scan",
    "product_profile",
    "business_audit",
    "opportunity_set",
  ],

  /**
   * The whole evidence chain, because an execution acts on a plan step derived
   * from a Move derived from the audit. Its approval chain is separate and is
   * deliberately not modelled here — see the note above.
   */
  agent_execution: [
    "repository_scan",
    "live_scan",
    "product_profile",
    "business_audit",
    "opportunity_set",
  ],
};

export type ActionProvenance = {
  action: RetailOperationKind;
  /** Only the links this action is derived from, in chain order. */
  links: readonly ProvenanceLink[];
  /**
   * The first of *those* links that is not current.
   *
   * Not the chain's own `firstGap`: a stale Move set does not make a business
   * audit unbuildable, and telling a founder to fix something the action they
   * are looking at does not read would be a wall built out of an unrelated fact.
   */
  firstGap: ProvenanceLink | null;
};

/**
 * The chain narrowed to one action.
 *
 * The narrowing is the point. A founder standing in front of an audit button
 * needs to know about the two scans and the profile; the Move set below is not
 * this button's business, and showing it here would turn provenance into noise
 * — which is how a surface like this stops being read.
 */
export function provenanceForAction(
  chain: ProvenanceChain,
  action: RetailOperationKind,
): ActionProvenance {
  const wanted = new Set(PROVENANCE_CHAINS[action]);
  const links = chain.links.filter((link) => wanted.has(link.kind));

  return {
    action,
    links,
    firstGap: links.find((link) => link.state !== "current") ?? null,
  };
}

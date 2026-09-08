import type {
  ProvenanceChain,
  ProvenanceLinkKind,
  ProvenanceRemedy,
} from "@/modules/provenance/chain";
import { GOAL_LABELS } from "@/modules/projects/founder-intent";
import type { PrimaryGoal } from "@/modules/projects/founder-intent";

import type { FocusCandidateKind, NovaFocus } from "../focus";
import type { NovaActionId } from "../actions";
import { freshnessOf, worthMentioning } from "./freshness";
import type { Freshness } from "./freshness";

/**
 * The handover — everything Nova knows, assembled in one place.
 *
 * ## Why it exists, and why it is worth building even with no model
 *
 * Nothing in this product shows a founder where they *stand*. The audit screen
 * shows the audit, the plan screen shows the plan, My Product shows the scan,
 * and no surface says "given all of it, here is the situation". That is not a
 * gap in the writing; it is a gap in the reading — the facts have never been
 * gathered into one object.
 *
 * So this is that object, and it is useful before anything writes prose from
 * it: the Nova panel needs these fields to render at all. A model layer on top
 * is a thin thing that turns them into a paragraph. If that layer is never
 * built, nothing here was wasted.
 *
 * ## It is derived, never stored
 *
 * Every field is computed from the inputs at the moment somebody asks. There
 * is no briefing row, no cache and nothing to invalidate — which is what makes
 * "your audit is older than your scans" true whenever it is read rather than
 * true on the day it was written. The thing that *is* stored is the sentence a
 * model writes about a briefing, and `freshness.ts` explains what stops that
 * sentence from outliving the situation.
 *
 * ## It decides almost nothing
 *
 * Two of the three judgments come in already made — `deriveNovaFocus` decided
 * what is open, `buildProvenanceChain` decided what is current — and the top
 * Move comes from the opportunity engine, which has the evidence. What this
 * adds is the join between them, plus age, which no existing reader carries.
 *
 * **The recommendation is never Nova's own.** She may say "I would start with
 * X" about the Move the engine ranked first; she may not pick a different X.
 * That distinction is the whole difference between an assistant that reports
 * a priority and one that invents one.
 */

/** One link of the evidence chain, with how old it is. */
export type BriefingEvidence = {
  kind: ProvenanceLinkKind;
  /** From the chain: missing, outdated, or current. */
  state: ProvenanceChain["links"][number]["state"];
  /** Why it is not current, when it is not. */
  reason: ProvenanceChain["links"][number]["reason"];
  /** Null when nothing was ever produced — an absence, not an age of zero. */
  freshness: Freshness | null;
  /** The instant it was produced, for a screen to render a real date from. */
  producedAt: string | null;
};

/**
 * What Vibe's own rules say to repair first.
 *
 * The chain's own `firstGap`, renamed for what it is from a founder's side: not
 * "the first broken link" but "the thing to do before the rest is worth doing".
 * Everything below a gap is derived from it, so repairing the third while the
 * first is wrong buys a fresh document built on the same mistake.
 */
export type BriefingFirstFix = {
  link: ProvenanceLinkKind;
  remedy: ProvenanceRemedy;
  reason: ProvenanceChain["links"][number]["reason"];
};

export type NovaBriefing = {
  founder: { name: string | null };
  project: { name: string };
  /** What the founder said they want, from the closed vocabulary. */
  goal: { id: PrimaryGoal; label: string } | null;
  evidence: readonly BriefingEvidence[];
  /** The one thing open now, and the control it carries. */
  open: { kind: FocusCandidateKind; action: NovaActionId | null };
  /** The engine's own top Move. Never Nova's, and never re-ranked here. */
  recommendation: { title: string; whyNow: string } | null;
  firstFix: BriefingFirstFix | null;
  /**
   * The oldest link worth raising on age alone, when nothing is actually
   * wrong. Null whenever `firstFix` is set: a broken link is a stronger thing
   * to say than an old one, and saying both makes two problems out of one.
   */
  ageToRaise: { link: ProvenanceLinkKind; freshness: Freshness } | null;
};

export type BriefingInputs = {
  /** What the founder asked to be called, when they have said. */
  founderName: string | null;
  projectName: string;
  primaryGoal: PrimaryGoal | null;
  /** Already decided by `buildProvenanceChain`. */
  chain: ProvenanceChain;
  /** Already decided by `deriveNovaFocus`. */
  focus: NovaFocus;
  /** The opportunity engine's rank-1 Move, when a current set has one. */
  topMove: { title: string; whyNow: string } | null;
  /** Passed in rather than read, so a briefing is a function of its inputs. */
  now: Date;
};

export function buildNovaBriefing(inputs: BriefingInputs): NovaBriefing {
  const evidence = inputs.chain.links.map((link) => ({
    kind: link.kind,
    state: link.state,
    reason: link.reason,
    freshness: freshnessOf(link.producedAt, inputs.now),
    producedAt: link.producedAt,
  }));

  const gap = inputs.chain.firstGap;
  const firstFix: BriefingFirstFix | null =
    gap && gap.remedy !== null ? { link: gap.kind, remedy: gap.remedy, reason: gap.reason } : null;

  return {
    founder: { name: inputs.founderName },
    project: { name: inputs.projectName },
    goal:
      inputs.primaryGoal === null
        ? null
        : { id: inputs.primaryGoal, label: GOAL_LABELS[inputs.primaryGoal] },
    evidence,
    open: { kind: inputs.focus.primary.kind, action: inputs.focus.nextAction },
    recommendation: inputs.topMove,
    firstFix,
    ageToRaise: firstFix === null ? oldestWorthRaising(evidence) : null,
  };
}

/**
 * The oldest link old enough to mention, or null.
 *
 * Reached only when nothing is broken. Age alone is a weak signal — a scan
 * from last Tuesday of a site nobody touched is good evidence — so this is
 * what Nova has to offer when the honest answer is "nothing is wrong, but this
 * has been sitting a while".
 */
function oldestWorthRaising(
  evidence: readonly BriefingEvidence[],
): { link: ProvenanceLinkKind; freshness: Freshness } | null {
  /* Chain order, so the oldest *upstream* thing wins a tie — repairing it
     replaces everything under it anyway. */
  const found = evidence.find((entry) => worthMentioning(entry.freshness));
  if (!found || found.freshness === null) return null;

  return { link: found.kind, freshness: found.freshness };
}

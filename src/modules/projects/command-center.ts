import type { BusinessReadinessAudit } from "@/modules/business-audit/schema";
import type { BusinessOpportunity, OpportunityImpact } from "@/modules/opportunities/schema";
import type { ProductProfile } from "@/modules/product-understanding/schema";

/**
 * What Home says (CORE-5).
 *
 * ## Why this is a module and not JSX
 *
 * Because every rule Home has to obey is a rule about *absence*, and absence
 * is exactly what reads as correct in a component while being wrong:
 *
 *  - A project with no audit has no score. Not zero, not "0 / 100", not a
 *    grey meter at 0% — no score, and a sentence saying what would produce
 *    one (CLAUDE.md rule 44).
 *  - An audit that ran and could not assess enough dimensions *also* has no
 *    score, and that is a different state again: Vibe looked and could not
 *    say, which is a statement about the evidence rather than the business.
 *  - A project whose opportunity engine has never run has no next move.
 *    A project whose engine ran and returned nothing also has no next move,
 *    and telling a founder "nothing to do" when the truth is "never asked"
 *    is the more damaging of the two.
 *
 * Each of those is one `if` away from becoming a confident falsehood, and a
 * component is where nobody notices. Here they are data, and
 * `command-center.test.ts` asserts them.
 *
 * ## What it may not do
 *
 * Invent. Every string below is either written here as fixed copy about
 * *Vibe's* state ("Vibe hasn't looked yet") or lifted verbatim from something
 * a model produced and a validator accepted. Nothing is summarised,
 * re-scored, averaged or rephrased on its way to the screen.
 */

/** What the product is. Absent until Vibe has built a profile. */
export type HomeIdentity = {
  productName: string | null;
  /** One sentence. The profile's own understanding, or its short description. */
  purpose: string | null;
};

/**
 * How the business is doing.
 *
 * Three states rather than a nullable number, because "not measured" and
 * "measured, and the coverage was too thin" are different things to tell
 * someone, and a `number | null` cannot carry the difference.
 */
export type HomeHealth =
  | { kind: "scored"; score: number; conclusion: string | null }
  | { kind: "unscored"; conclusion: string | null; reason: string | null }
  | { kind: "not_analyzed" };

/** The single most important thing the audit found, when it found one. */
export type HomeFinding = {
  headline: string;
  /** Why it matters commercially. Often absent; never invented when it is. */
  whyItMatters: string | null;
};

/**
 * What to do next.
 *
 * `not_identified` is the state of a project whose engine has never run.
 * `none_found` is the state of one whose engine ran and returned nothing.
 * They read differently on screen and they must, so they are different here.
 */
export type HomeNextMove =
  | { kind: "move"; title: string; problem: string; impact: OpportunityImpact }
  | { kind: "none_found" }
  | { kind: "not_identified" };

export type HomeView = {
  identity: HomeIdentity;
  health: HomeHealth;
  finding: HomeFinding | null;
  nextMove: HomeNextMove;
  /** Prepared changes waiting. Zero is a real answer here and is shown as one. */
  preparedCount: number;
};

export type BuildHomeViewInput = {
  /** Null until Vibe has worked out what the product is. */
  profile: ProductProfile | null;
  /** Null until an audit has completed. */
  audit: BusinessReadinessAudit | null;
  /**
   * Null when the opportunity engine has never produced a set for this
   * project. An empty array is a set that came back with nothing — which is a
   * different fact, and is not represented as null.
   */
  opportunities: BusinessOpportunity[] | null;
  preparedCount: number;
};

function identityFrom(profile: ProductProfile | null): HomeIdentity {
  if (!profile) return { productName: null, purpose: null };

  return {
    productName: profile.identity.name.value,
    // The paragraph Vibe wrote about the product, falling back to the short
    // description. Both are already hedged by their own confidence upstream;
    // neither is re-worded here.
    purpose: profile.identity.understanding.value ?? profile.identity.shortDescription.value,
  };
}

function healthFrom(audit: BusinessReadinessAudit | null): HomeHealth {
  if (!audit) return { kind: "not_analyzed" };

  const conclusion = audit.synthesis?.overall?.trim() ? audit.synthesis.overall : null;

  if (audit.overall.score === null) {
    return {
      kind: "unscored",
      conclusion,
      reason: audit.overall.insufficientCoverageReason,
    };
  }

  return { kind: "scored", score: audit.overall.score, conclusion };
}

/**
 * The audit's own first blocker, unchanged.
 *
 * The list is already ordered by the model that wrote it and already bounded
 * at three, so "most important" is a lookup rather than a judgement this
 * module is entitled to make. An audit with no blockers has no finding — that
 * is a good outcome, not an empty slot to fill.
 */
function findingFrom(audit: BusinessReadinessAudit | null): HomeFinding | null {
  const blocker = audit?.synthesis?.blockers?.[0];
  if (!blocker || blocker.headline.trim() === "") return null;

  return { headline: blocker.headline, whyItMatters: blocker.whyItMatters };
}

/**
 * The rank-1 Move.
 *
 * Selected by rank rather than by taking `[0]`: the array's order is not the
 * contract, `rank` is, and the two have no reason to disagree until the day
 * one of them does.
 */
function nextMoveFrom(opportunities: BusinessOpportunity[] | null): HomeNextMove {
  if (opportunities === null) return { kind: "not_identified" };
  if (opportunities.length === 0) return { kind: "none_found" };

  const first = opportunities.reduce((best, candidate) =>
    candidate.rank < best.rank ? candidate : best,
  );

  return {
    kind: "move",
    title: first.title,
    problem: first.problem,
    impact: first.impact,
  };
}

export function buildHomeView(input: BuildHomeViewInput): HomeView {
  return {
    identity: identityFrom(input.profile),
    health: healthFrom(input.audit),
    finding: findingFrom(input.audit),
    nextMove: nextMoveFrom(input.opportunities),
    preparedCount: input.preparedCount,
  };
}

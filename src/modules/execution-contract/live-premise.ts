import { buildLiveEvidence } from "@/modules/business-audit/evidence";
import type { LiveProductIntelligenceSnapshot } from "@/modules/live-product-intelligence/schema";
import type { LiveEvidenceContext } from "./resolver";

/**
 * Is the live-product defect this step exists to fix still there? (Rule 55)
 *
 * ## The failure this closes
 *
 * A step's `evidenceIds` are what it is *for*. Three of five dogfood
 * calibration fixtures cited a `live.seo.*` defect that had been fixed between
 * the audit and the run, and all three failed with `agent_produced_no_change`
 * — the agent read the files, correctly found nothing to do, and the run was
 * paid for anyway. `docs/business/calibration/README.md` records it, including
 * that the honest outcome for a false premise looked identical to a defect.
 *
 * ## Why set membership, and not a comparison
 *
 * `business-audit/evidence.ts` mints a live signal's id with `_missing`
 * appended exactly when `signal.present` is false. A fixed defect therefore
 * does not flip a value — its id stops being minted at all. So "is the premise
 * still true" is answerable by rebuilding the pack from a fresh snapshot and
 * asking whether the cited id is still in it. No threshold, no polarity
 * decoding, nothing to keep in step with the minting rules beyond calling the
 * same builder.
 *
 * ## Why absence from a partial pack is not a fix
 *
 * A crawl that reaches a budget degrades to `partial` (Rule 39) rather than
 * failing. A partial pack can be missing an id because the defect is gone, or
 * because the page carrying it was never fetched — and those are opposite
 * facts. Unobserved is not fine: this returns `unverified`, and admission
 * refuses, the same posture an unread repository HEAD already has.
 *
 * A `complete` snapshot carries no such doubt, so absence there is a fix.
 */

const LIVE_EVIDENCE_PREFIX = "live.";
/**
 * The suffix that makes absence mean something.
 *
 * `buildLiveEvidence` mints both kinds of live id. A *defect* id carries
 * `_missing` and exists only while the defect does, so its disappearance says
 * one thing and nothing else: it was fixed. A *positive* id — `live.surface.pricing`,
 * `live.conversion.signup_cta`, `live.site.title` — exists while something is
 * present, and its disappearance is ambiguous: the surface may have been
 * renamed, moved behind auth, or simply not reached on this pass.
 *
 * Only the unambiguous half is checked. Refusing a paid run because a positive
 * id went missing would block legitimate work on a guess, which is a worse
 * failure than the one this module exists to prevent — and every case the
 * calibration runs actually hit was a `_missing` id.
 */
const DEFECT_SUFFIX = "_missing";

/**
 * The cited ids this check applies to, in the order the step cites them.
 *
 * Live defect ids only — see {@link DEFECT_SUFFIX} for why positive live ids
 * and every non-live namespace are deliberately out of scope.
 */
export function citedLiveEvidenceIds(evidenceIds: readonly string[]): string[] {
  return evidenceIds.filter(
    (id) => id.startsWith(LIVE_EVIDENCE_PREFIX) && id.endsWith(DEFECT_SUFFIX),
  );
}

/**
 * Decides the live-premise verdict for one step against one snapshot.
 *
 * Pure: the caller does the crawl and the snapshot selection, this only reads
 * what it is handed — the same split `resolver.ts` uses for `liveHead`, and
 * the reason this is unit-testable without a network.
 */
export function evaluateLivePremise(params: {
  evidenceIds: readonly string[];
  /** The freshest snapshot the caller was able to establish, or null. */
  snapshot: LiveProductIntelligenceSnapshot | null;
  /**
   * Whether that snapshot observed the whole site.
   *
   * `partial` is the budget-degraded case (Rule 39). Passed separately rather
   * than read off the snapshot so the caller can also report "no usable
   * snapshot at all" without inventing one.
   */
  completeness: "complete" | "partial" | null;
}): LiveEvidenceContext {
  const cited = citedLiveEvidenceIds(params.evidenceIds);

  // Nothing to revalidate. Reported distinctly rather than as `verified`, so
  // "there was nothing to check" is never read as "we checked and it holds".
  if (cited.length === 0) return { status: "not_applicable" };

  if (!params.snapshot || params.completeness === null) {
    return {
      status: "unverified",
      reason: "no usable live snapshot could be established for this project",
    };
  }

  const fresh = new Set(buildLiveEvidence(params.snapshot).map((entry) => entry.id));
  const missing = cited.filter((id) => !fresh.has(id));

  if (missing.length === 0) return { status: "verified" };

  // Missing from a partial pack means unobserved, not fixed — see the header.
  if (params.completeness === "partial") {
    return {
      status: "unverified",
      reason:
        `the live scan did not observe ${missing.join(", ")}, and it stopped early ` +
        `at a crawl budget — so it cannot say whether the defect is fixed or simply unseen`,
    };
  }

  return { status: "stale", fixedEvidenceIds: missing };
}

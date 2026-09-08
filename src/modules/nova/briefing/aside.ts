import type { FocusCandidateKind } from "../focus";
import type { ProvenanceLinkKind } from "@/modules/provenance/chain";

import type { NovaSituation } from "./situation";

/**
 * Whether the situation is worth saying out loud beside a moment.
 *
 * ## The collision this resolves
 *
 * Nova's moment sentence and the situation are written by different modules
 * about different questions, and for almost every pair that is exactly what
 * makes the second one worth reading — *"there is a change waiting for you"*
 * plus *"your website was read by a version I have since corrected"* is a
 * founder learning something they could not have worked out.
 *
 * Two moments are the exception, and they are the two whose own sentence is
 * *already a claim about currency*: `audit_outdated` says the audit is older
 * than the product, and `repository_read_outdated` says the code read is older
 * than the code. A line underneath saying the same document was last produced
 * a few weeks ago is the same fact twice, one bubble apart.
 *
 * `footnote.ts` hit the identical shape between the prompt table and the
 * action catalog, and resolved it the same way — neither table is wrong, so
 * the duplicate yields at the call site.
 *
 * ## Why the rule is this narrow, and not "the same document"
 *
 * Because "about the same document" is not the same as "saying the same
 * thing", and an earlier draft of this file proved it. A failed Product Scan
 * and a corrected analyzer are both about the scan, and the second is worth
 * saying: the run that failed is one problem, and the older run that succeeded
 * being untrustworthy is another. A Move with no plan behind it and a Move set
 * built on a superseded audit are the same shape — offering to plan from a
 * stale set is exactly the trap the provenance chain exists to name.
 *
 * So the yield is on the two moments that are literally currency claims, and
 * only when the situation is about *their* link. A wider rule would swallow
 * asides that carry the whole point, and a silently missing aside is worse
 * than one that repeats: nobody would ever see the absence to report it.
 */

/**
 * The moments whose own sentence is already a claim about a link's currency.
 *
 * Deliberately partial rather than total. Every other moment is about *work* —
 * a change, a question, a run, a Move — and nothing it says can collide with a
 * statement about evidence, so listing them as `null` would be twenty lines
 * asserting the absence of a problem.
 */
const MOMENT_CLAIMS_CURRENCY: Partial<Record<FocusCandidateKind, ProvenanceLinkKind>> = {
  audit_outdated: "business_audit",
  repository_read_outdated: "repository_scan",
};

export function situationAside(params: {
  situation: NovaSituation;
  moment: FocusCandidateKind;
  /**
   * Whether Nova wrote a sentence about this moment.
   *
   * When she did, she was given the situation as background and decided for
   * herself whether to use it — so Vibe adding its own version underneath
   * would be second-guessing her in public. The aside is what carries the
   * *because* when there is no written sentence to carry it.
   */
  spoken: boolean;
}): string | null {
  if (params.spoken) return null;

  /* Nothing is due. True, and not worth a sentence: "everything is current" is
     news to nobody and would appear under every moment forever. */
  if (params.situation.subject === null) return null;

  /* The moment already claims exactly this. */
  if (MOMENT_CLAIMS_CURRENCY[params.moment] === params.situation.subject) return null;

  return params.situation.lines.join(" ");
}

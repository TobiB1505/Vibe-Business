import {
  PROVENANCE_LINK_LABELS,
  PROVENANCE_REASONS,
  PROVENANCE_REMEDY_LABELS,
} from "@/modules/provenance/view";
import { LINK_REMEDY } from "@/modules/provenance/chain";

import {
  buildProvenanceChain,
  type ProvenanceChain,
  type ProvenanceLinkKind,
} from "@/modules/provenance/chain";
import { provenanceInputsFrom } from "@/modules/provenance/from-evidence";

import { freshnessOf, worthMentioning, FRESHNESS_LABELS } from "./freshness";

/**
 * Where the founder stands, as context for whatever Nova is about to say.
 *
 * ## What this is for, and what it is not
 *
 * It is not a screen. Nothing renders it, and nothing should: the briefing was
 * built so that Nova's own sentences could be *informed*, not so that a founder
 * could read a table of Vibe's internal state. A panel showing these facts was
 * built, screenshotted and deleted, and deleting it is the decision — the value
 * was never in showing the founder what Vibe knows, it was in Nova knowing it
 * while she speaks.
 *
 * So this is a small block that travels **with every voice payload**, whatever
 * the message is about. It is what lets an audit message end with "…and I read
 * your website with a version I've since corrected, so a fresh scan first would
 * be worth it" instead of stopping at the audit. The *because* comes from here.
 *
 * ## Why it is Vibe's sentences and not the model's freedom
 *
 * Every line below is composed from tables Vibe owns — the chain's link labels,
 * its reason sentences, the freshness buckets — and every one is swept by
 * `provenance-copy.test.ts` and `situation.test.ts` for figures, causal claims
 * and promises. The model may carry these facts into its own wording; it may
 * not add a sixth fact of its own, and there is nothing here it could derive
 * one from.
 *
 * ## Why there are no numbers in it
 *
 * The same reason `freshness.ts` speaks in buckets: a message is *stored*
 * against a reuse identity, and a number in a stored sentence goes false by the
 * calendar with nobody noticing. The validator rejects every digit anyway
 * (`allowedNumericFacts` stays empty), so this is the belt to that brace.
 */
export type NovaSituation = {
  /**
   * What is true about the evidence right now, in Vibe's own words.
   *
   * Ordered, and short by construction: at most what one read produced. A
   * situation that listed all five links would be a table again, and Nova would
   * have to choose what to mention — which is the choosing this module does for
   * her, using the chain's own ordering.
   */
  lines: readonly string[];
  /**
   * The run that would repair the top of the chain, named as Vibe names it.
   *
   * Null when nothing is due. Nova may mention it; the control that starts it
   * is rendered from state beside the prose and never passes through the model.
   */
  remedy: string | null;
  /**
   * Which link the lines are about, for a caller deciding whether to *show*
   * them. Null when nothing is due.
   *
   * Deliberately **not** in `canonicalPayload`. It changes nothing a model
   * sees or says, so hashing it would invalidate every stored message for a
   * field the model never reads — and it is derivable from the lines anyway,
   * which name the link and are hashed. `situation.test.ts` pins that: two
   * situations with different subjects never have the same lines.
   */
  subject: ProvenanceLinkKind | null;
};

/**
 * Null is not a state this produces.
 *
 * Every chain has something true about it, "everything is current" included,
 * and a payload carrying an empty block would still be a section in the prompt
 * announcing that there is context — which is an invitation to fill it.
 */

/**
 * The situation, from the evidence chain and the clock.
 *
 * Deliberately built from the **chain** rather than from a whole `NovaBriefing`:
 * every caller that shows a Nova message already holds one — the health page,
 * the plan page and the durable steps all build it for their own panels — so
 * taking the chain means no surface pays a second read to make its sentence
 * informed. What a briefing adds beyond the chain (the ranking, the top Move,
 * the founder's name) is not context for a message, it is the subject of one.
 */
export function buildNovaSituation(chain: ProvenanceChain, now: Date): NovaSituation {
  const gap = chain.firstGap;
  if (gap !== null) {
    return {
      lines: [
        `${PROVENANCE_LINK_LABELS[gap.kind]} is the thing to repair first.`,
        ...(gap.reason === null ? [] : [PROVENANCE_REASONS[gap.reason]]),
      ],
      remedy: gap.remedy === null ? null : PROVENANCE_REMEDY_LABELS[gap.remedy],
      subject: gap.kind,
    };
  }

  /* Chain order, so the oldest *upstream* thing wins — repairing it replaces
     everything under it anyway. Reached only when nothing is broken. */
  const old = chain.links
    .map((link) => ({ kind: link.kind, freshness: freshnessOf(link.producedAt, now) }))
    .find((link) => worthMentioning(link.freshness));

  if (old !== undefined && old.freshness !== null) {
    return {
      lines: [
        `${PROVENANCE_LINK_LABELS[old.kind]} was last produced ${FRESHNESS_LABELS[old.freshness]}.`,
        /*
         * Said explicitly, because the model's temptation with an age is to
         * treat it as a fault. Old evidence is not wrong evidence, and the
         * sentence that says so is Vibe's rather than a prompt rule the model
         * has to remember.
         */
        "Nothing about it is wrong; it has just been sitting a while.",
      ],
      remedy: PROVENANCE_REMEDY_LABELS[LINK_REMEDY[old.kind]],
      subject: old.kind,
    };
  }

  /*
   * Nothing due. Still worth saying, because it is what tells Nova she does not
   * need to hedge — and because a message written while the evidence was sound
   * and one written while it was not must not be the same stored message.
   */
  return { lines: ["Everything Vibe reads from is current."], remedy: null, subject: null };
}

/**
 * The situation, from what a surface has already read.
 *
 * The one composition every caller uses — the two pages that render a Nova
 * message and the two durable steps that write one. It matters that it is
 * exactly one: the situation is hashed into the reuse identity, so a page that
 * assembled the chain slightly differently from the step that generated would
 * resolve to nothing, permanently, and look exactly like never having spoken.
 */
export function novaSituationFrom(
  inputs: Parameters<typeof provenanceInputsFrom>[0],
  now: Date,
): NovaSituation {
  return buildNovaSituation(buildProvenanceChain(provenanceInputsFrom(inputs)), now);
}

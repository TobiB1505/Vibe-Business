import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { NOVA_PRESENTATION_CONFIG } from "@/modules/ai/operations";
import type { BusinessOpportunity } from "@/modules/opportunities/schema";
import { GOAL_LABELS } from "@/modules/projects/founder-intent";
import type { PrimaryGoal } from "@/modules/projects/founder-intent";

import { computeNovaVoiceIdentity } from "./payload";
import type { NovaVoicePayload } from "./payload";
import { readNovaVoiceMessage } from "./store";
import type { NovaVoiceRead } from "./store";

/**
 * "This is where I would start, and why."
 *
 * ## Why this slot, and not another
 *
 * `audit_result` was the weakest case for a voice tier, because its payload
 * facts are already polished prose written by the audit's own inference — a
 * second model pass mostly recombines sentences that were fine already. This
 * slot is the opposite, and deliberately so: a Move is **structured** state
 * (title, problem, whyNow, rank, impact, effort) and the founder's goal is a
 * closed-vocabulary label. Turning those into one sentence that also connects
 * the goal to the priority is work a template cannot do, and it is the exact
 * case the eval named as the point of the whole tier (`B1` in `eval/cases.ts`:
 * "Connecting goal and priority is the whole point of the voice layer").
 *
 * ## One interpretation of a Move
 *
 * `audit-slot.ts` derives from the `nova.audit` entry `feed.ts` already
 * builds, so Nova cannot come to describe a different audit than the panel
 * beside her. There is no equivalent intermediate view for a Move: `feed.ts`'s
 * `NovaMoveFact` carries only `id`, `rank` and `title`, which is enough to
 * order candidates and not enough to say anything. So this reads the canonical
 * document itself, and narrows it **here** rather than at the call site — one
 * file names every field that reaches the identity, so a caller cannot quietly
 * widen it.
 *
 * ## What the model may not repeat
 *
 * `allowedNumericFacts` is empty, so `checks.ts` rejects any digit. A Move
 * carries impact, effort and — once a plan exists — a Credit ceiling, and
 * every one of those is a figure a founder acts on. They are rendered from
 * state beside the prose, never quoted inside it (`payload.ts`).
 */

/** Exactly the fields that reach the payload, and therefore the identity. */
export type NovaMoveSubject = {
  title: string;
  problem: string;
  whyNow: string;
  confidence: BusinessOpportunity["confidence"];
};

export function novaMoveSubject(move: BusinessOpportunity): NovaMoveSubject {
  return {
    title: move.title,
    problem: move.problem,
    whyNow: move.whyNow,
    confidence: move.confidence,
  };
}

/**
 * The Move Nova would start with: the lowest rank in the set.
 *
 * `rank` is the opportunity engine's own numbering — "1-based, unique and
 * contiguous within the set" — so this picks rather than decides. Nothing here
 * re-ranks, for the reason `opportunities/view.ts` gives about `moveBand`: a
 * second ranking would be a second opinion with no evidence behind it.
 */
export function topMove(moves: readonly BusinessOpportunity[]): BusinessOpportunity | null {
  if (moves.length === 0) return null;
  return moves.reduce((best, move) => (move.rank < best.rank ? move : best));
}

/**
 * The founder's goal as a Vibe-authored label, never their own words.
 *
 * `GOAL_LABELS` maps the closed `PRIMARY_GOALS` vocabulary; free text never
 * reaches a prompt from here (rule 42). Null when no goal is on file — and
 * null must stay null rather than becoming a guess, because a goal Nova
 * invented and then connected to a priority is the failure `B1` exists for.
 */
export function novaFounderGoal(primaryGoal: PrimaryGoal | null): string | null {
  return primaryGoal === null ? null : GOAL_LABELS[primaryGoal];
}

/**
 * What Vibe says with no model at all.
 *
 * Deterministic in the subject, because the read path has to produce exactly
 * this string without knowing whether a model ever ran.
 *
 * **The quoted half is the Move's own words.** `whyNow` is written by the
 * opportunity engine's inference and is rendered verbatim on the Move card
 * directly below this sentence, so quoting it here introduces nothing the
 * screen does not already show. The language rules this file asserts therefore
 * cover the scaffold — the words authored here — and not the quotation; a
 * sweep claiming otherwise would be claiming to validate a document that has
 * its own validation.
 *
 * The goal is stated, never connected. "Your goal is X, so do Y" is a
 * prioritisation Vibe did not make: the ranking comes from the audit, not from
 * the goal. The template puts the two facts side by side and stops, which is
 * exactly what the model is asked to do with them.
 */
export function buildNovaMoveTemplate(
  subject: NovaMoveSubject,
  founderGoal: string | null,
): string {
  /*
   * "to " plus the lowercased label, because every member of `GOAL_LABELS` is
   * a verb phrase ("Get first users", "Start monetizing", "Launch") rather
   * than a noun. Any phrasing that treats them as nouns reads as broken
   * English for five of the six.
   */
  const opening =
    founderGoal === null
      ? "The one I would start with is"
      : `Your goal is to ${lowerFirst(founderGoal)}. The one I would start with is`;

  return `${opening} ${lowerFirst(subject.title)}. ${subject.whyNow}`;
}

/** A title written as a heading, dropped into the middle of a sentence. */
function lowerFirst(text: string): string {
  const trimmed = text.replace(/\.$/, "");
  if (trimmed.length === 0) return trimmed;
  /* An acronym or a product name keeps its shape. */
  const second = trimmed[1] ?? "";
  if (second !== "" && second === second.toUpperCase() && /[A-Za-z]/.test(second)) return trimmed;
  return trimmed[0].toLowerCase() + trimmed.slice(1);
}

/**
 * The same facts, arranged for a model that may only rephrase them.
 *
 * The fact labels mirror the ones the prompt was measured against — `move`,
 * `problem`, `why now` in `eval/cases.ts`'s `A3` and `B1`. Using different
 * labels would put this slot outside the measurement ADR 0083 rests on.
 *
 * No `position` fact: that one exists in the eval for a Move that is *not*
 * first (`A8`), where Nova must not imply it is the most important thing.
 * This slot always carries rank 1, so the absence is the honest signal.
 */
export function buildNovaMoveVoicePayload(params: {
  subject: NovaMoveSubject;
  founderGoal: string | null;
}): NovaVoicePayload {
  return {
    slot: "move_recommendation",
    productName: null,
    founderGoal: params.founderGoal,
    facts: [
      { label: "move", value: params.subject.title },
      { label: "problem", value: params.subject.problem },
      { label: "why now", value: params.subject.whyNow },
    ],
    /* Impact, effort and any Credit ceiling are rendered from state. */
    allowedNumericFacts: [],
    /*
     * The Move's own confidence, which is "confidence that the problem exists
     * and matters" — a question that genuinely applies here, so null would be
     * the wrong answer. `high` passes through; everything below it hedges,
     * because overstating certainty is the one direction this product may not
     * err in, and `medium` is not `high`.
     */
    confidence: params.subject.confidence === "high" ? "high" : "low",
    /*
     * State-independent on purpose. "Turn this into a plan" is false the
     * moment a plan exists, and a next step that changes with plan state would
     * change the identity with it — turning every plan a founder makes into a
     * second paid generation of a sentence that did not need to move.
     */
    nextStep: "The full picture is below.",
  };
}

/** The reuse key for this project's reading of this Move. */
export function novaMoveVoiceIdentity(
  projectId: string,
  subject: NovaMoveSubject,
  founderGoal: string | null,
): string {
  return computeNovaVoiceIdentity({
    projectId,
    payload: buildNovaMoveVoicePayload({ subject, founderGoal }),
    model: NOVA_PRESENTATION_CONFIG.model,
  });
}

/**
 * What to show above the Moves. **Never calls a provider, and never throws.**
 *
 * The identity and the template come from the same subject, so a component
 * cannot look up one message and fall back to a different one's words. A
 * failed lookup resolves to the template for the reason `audit-slot.ts` gives:
 * the page is the founder's plan, the sentence above it is a rephrasing, and a
 * screen that failed because a nicety could not be read would have made the
 * nicety load-bearing.
 */
export async function readNovaMoveVoice(
  supabase: SupabaseClient,
  params: { projectId: string; move: BusinessOpportunity; primaryGoal: PrimaryGoal | null },
): Promise<NovaVoiceRead> {
  const subject = novaMoveSubject(params.move);
  const founderGoal = novaFounderGoal(params.primaryGoal);
  const template = buildNovaMoveTemplate(subject, founderGoal);

  try {
    return await readNovaVoiceMessage(supabase, {
      identity: novaMoveVoiceIdentity(params.projectId, subject, founderGoal),
      template,
    });
  } catch (error) {
    console.error("[nova-voice] could not read the stored move message", {
      projectId: params.projectId,
      message: error instanceof Error ? error.message : "unknown",
    });

    return {
      message: template,
      source: "template",
      fallbackReason: null,
      resolved: false,
      attempt: null,
    };
  }
}

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { NOVA_PRESENTATION_CONFIG } from "@/modules/ai/operations";
import type { BriefingView } from "@/modules/nova/briefing/view";

import { computeNovaVoiceIdentity } from "./payload";
import type { NovaVoicePayload } from "./payload";
import { readNovaVoiceMessage } from "./store";
import type { NovaVoiceRead } from "./store";

/**
 * The briefing's one message: where the founder stands, said out loud.
 *
 * ## Why this slot and not the two that were parked
 *
 * `audit_result` and `move_recommendation` ask a model to rephrase prose a
 * model already wrote — an audit's blocker, a Move's `whyNow` — which buys a
 * synonym and a second chance to be wrong. This slot is the opposite shape:
 * its facts are Vibe's own structured judgements about the evidence chain, and
 * there is no existing sentence to improve on. The sentence is the thing being
 * produced, and nothing else in the product produces it.
 *
 * ## Only the slow half is written down
 *
 * `view.standing` — whether something is waiting — is never in the payload and
 * never in a stored message. It comes from `deriveNovaFocus`, which moves when
 * an agent run starts or a change is approved, so a stored sentence about it
 * would be wrong within the hour and the identity change that ought to catch
 * that is the same one that makes it unreachable. The panel renders it live,
 * every draw, in front of whatever this returns.
 *
 * What is written down is `view.situation`: the chain and its age. That
 * changes when an operation finishes, which is exactly when a new message is
 * generated (ADR 0086's amendment) — so what is stored and what triggers a
 * store are the same event.
 *
 * ## Why the payload names no product
 *
 * `productName` is null, for the reason `audit-slot.ts` gives: the identity is
 * a hash of the payload, and the render has to recompute it from persisted
 * state to find the stored message. A product profile can be corrected at any
 * time; every field that can drift between generation and render is a cache
 * miss waiting to happen.
 */

/**
 * What Vibe says with no model at all.
 *
 * `view.situation`, unchanged. Deterministic in the view, because the read
 * path has to produce exactly this string without knowing whether a model ever
 * ran — and because a founder who never gets a voice message reads this and
 * has lost nothing but a rephrasing.
 */
export function buildNovaBriefingTemplate(view: BriefingView): string {
  return view.situation;
}

/**
 * The same facts, arranged for a model that may only rephrase them.
 *
 * Every value already appears on the screen the founder is looking at, and
 * every one of them was decided somewhere else: the chain judged the link, the
 * bucket named the age, the opportunity engine ranked the Move.
 *
 * `allowedNumericFacts` is empty, so `checks.ts` rejects **any** digit. That is
 * not incidental here — it is the whole reason `freshness.ts` speaks in buckets
 * rather than days. A stored sentence naming a number of days becomes false by
 * the calendar alone, and the validator makes writing one impossible rather
 * than unlikely.
 */
export function buildNovaBriefingVoicePayload(view: BriefingView): NovaVoicePayload {
  const read = view.read;
  const facts: NovaVoicePayload["facts"] = [];
  let nextStep: string;
  let confidence: NovaVoicePayload["confidence"];

  if (read.kind === "repair") {
    facts.push({ label: "what to look at first", value: label(view, read.subject) });
    for (const sentence of read.sentences.slice(1)) {
      facts.push({ label: "what Vibe knows about it", value: sentence });
    }
    nextStep = read.remedyLabel;
    /* A version comparison and an absent row are both certain. */
    confidence = "high";
  } else if (read.kind === "age") {
    facts.push({ label: "what has been sitting a while", value: label(view, read.subject) });
    facts.push({ label: "how long", value: ageOf(view, read.subject) });
    nextStep = read.remedyLabel;
    confidence = "high";
  } else if (read.kind === "move") {
    facts.push({ label: "state of the evidence", value: "all of it is current" });
    /*
     * The Move's own title and `whyNow` are deliberately absent.
     *
     * The panel prints them directly beneath the paragraph, in the engine's
     * wording — so a model that had them could only repeat them, and the
     * repetition would be the founder reading the same thing twice with no way
     * to tell which half was written by which. Forbidding the title afterwards
     * would work and is worse: it would reject an otherwise good sentence for
     * quoting a fact it was handed. An effect that must never happen is an
     * absent capability, not a refused one (rule 76's shape, applied to a
     * payload).
     *
     * It also means this read reaches the model carrying no customer content
     * at all — nothing from a repository, a website, or an earlier model.
     */
    facts.push({ label: "the founder's list", value: "something is ranked at the top of it" });
    nextStep = "Open the Move at the top of the list.";
    /*
     * Null rather than high: the ranking is the opportunity engine's judgement,
     * not a fact Vibe measured, and `confidence` describes how sure Vibe is of
     * its own facts. Saying "high" here would have Nova vouch for a rank she
     * is only carrying.
     */
    confidence = null;
  } else {
    facts.push({ label: "state of the evidence", value: "all of it is current" });
    facts.push({ label: "the founder's list", value: "nothing is on it" });
    nextStep = "Nothing needs doing right now.";
    confidence = null;
  }

  return {
    slot: "briefing",
    productName: null,
    founderGoal: view.goalLabel,
    facts,
    /* See the docblock: no digit may appear, which is what makes a bucket safe
       to store and a day count unstorable. */
    allowedNumericFacts: [],
    confidence,
    nextStep,
  };
}

/** The chain's own label for a link, from the row the panel renders. */
function label(view: BriefingView, kind: BriefingView["rows"][number]["kind"]): string {
  return view.rows.find((row) => row.kind === kind)?.label ?? kind;
}

/** The bucket, in words. Never a number of days — see the docblock. */
function ageOf(view: BriefingView, kind: BriefingView["rows"][number]["kind"]): string {
  return view.rows.find((row) => row.kind === kind)?.age ?? "a while ago";
}

/**
 * The reuse key for this project's reading of its own evidence.
 *
 * Recomputed identically on both sides — by the durable step that may generate
 * and by the render that may only read — because both derive it from a
 * `BriefingView` built by the same function from the same persisted state.
 */
export function novaBriefingVoiceIdentity(projectId: string, view: BriefingView): string {
  return computeNovaVoiceIdentity({
    projectId,
    payload: buildNovaBriefingVoicePayload(view),
    model: NOVA_PRESENTATION_CONFIG.model,
  });
}

/**
 * What to show in the briefing panel. **Never calls a provider, never throws.**
 *
 * A read: it resolves the stored message if a durable step produced one, and
 * `view.situation` otherwise. Both halves — the identity and the template —
 * come from the same view, so the panel cannot look up one message and fall
 * back to a different one's words.
 *
 * A failed lookup is not an error, for the reason `audit-slot.ts` gives at
 * length: the screen it sits on is the founder's home, and a nicety that could
 * 500 a page would have stopped being a nicety.
 */
export async function readNovaBriefingVoice(
  supabase: SupabaseClient,
  params: { projectId: string; view: BriefingView },
): Promise<NovaVoiceRead> {
  const template = buildNovaBriefingTemplate(params.view);

  try {
    return await readNovaVoiceMessage(supabase, {
      identity: novaBriefingVoiceIdentity(params.projectId, params.view),
      template,
    });
  } catch (error) {
    console.error("[nova-voice] could not read the stored briefing message", {
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

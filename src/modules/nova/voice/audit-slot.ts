import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { NOVA_PRESENTATION_CONFIG } from "@/modules/ai/operations";

import type { NovaEntry } from "../feed";
import { computeNovaVoiceIdentity } from "./payload";
import type { NovaVoicePayload } from "./payload";
import { readNovaVoiceMessage } from "./store";
import type { NovaVoiceRead } from "./store";

/**
 * The audit's one message: what Vibe says without a model, and what a model is
 * given if it is allowed to say it differently.
 *
 * ## One interpretation of an audit, not two
 *
 * Both functions take the `nova.audit` entry `buildNovaAuditEntry` already
 * produces, never a `BusinessReadinessAudit` and never a synthesis. That is the
 * point: `feed.ts` decides what an audit means to Nova — the score, its label,
 * the summary, the first blocker, how many more there are — and this file
 * decides only how to say it. A payload built from raw audit rows would be a
 * second reading of the same document, free to disagree with the screen beside
 * it.
 *
 * ## Why the score is not in the sentence
 *
 * `allowedNumericFacts` is empty, so `checks.ts` rejects **any** digit the
 * model writes. The score is a figure a founder acts on, and `payload.ts`
 * already states the rule: such a figure is rendered from state beside the
 * prose, never quoted inside it. The entry carries `score` for the component to
 * render; the voice may not repeat it, cannot round it, and cannot invent a
 * neighbour of it.
 *
 * ## Why the payload names no product
 *
 * `productName` is null. The identity is a hash of the payload, and the render
 * has to recompute it from persisted state to find the stored message — so
 * every field that can drift between generation and render is a cache miss
 * waiting to happen. A product profile can be corrected after an audit runs;
 * the audit cannot. Leaving the name out keeps the identity a function of one
 * immutable document.
 */

type NovaAuditEntry = Extract<NovaEntry, { kind: "nova.audit" }>;

/**
 * What Vibe says with no model at all.
 *
 * Deterministic in the entry, because the read path has to be able to produce
 * exactly this string without knowing whether a model ever ran. It is the
 * whole product: a founder who never gets a voice message reads this and has
 * lost nothing but a rephrasing.
 *
 * No figures, no cause claimed, nothing called live, shipped or safe — the
 * same language rules every other Nova sentence is held to, asserted over this
 * one in `audit-slot.test.ts`.
 */
export function buildNovaAuditTemplate(entry: NovaAuditEntry): string {
  if (entry.priority === null) {
    return "I finished going through your business. Nothing came out as a blocker worth leading with.";
  }

  const more =
    entry.additionalPriorityCount > 0
      ? " There is more underneath it."
      : " That is the one I would look at first.";

  return `I finished going through your business. The thing standing out most is ${lowerFirst(entry.priority.headline)}.${more}`;
}

/** A headline written as a title, dropped into the middle of a sentence. */
function lowerFirst(headline: string): string {
  const trimmed = headline.replace(/\.$/, "");
  if (trimmed.length === 0) return trimmed;
  /* Only a plain capital is lowered: an acronym or a product name keeps its shape. */
  const second = trimmed[1] ?? "";
  if (second !== "" && second === second.toUpperCase() && /[A-Za-z]/.test(second)) return trimmed;
  return trimmed[0].toLowerCase() + trimmed.slice(1);
}

/**
 * The same facts, arranged for a model that may only rephrase them.
 *
 * Every value here already appears on the screen the founder is looking at.
 * Nothing is derived, ranked, or explained on the way — `whyItMatters` is the
 * audit's own sentence, and the model is not being asked to improve it.
 */
export function buildNovaAuditVoicePayload(entry: NovaAuditEntry): NovaVoicePayload {
  const facts: NovaVoicePayload["facts"] = [
    { label: "state of the business", value: entry.stateLabel },
  ];

  if (entry.summary !== null) facts.push({ label: "what the audit found", value: entry.summary });
  if (entry.priority !== null) {
    facts.push({ label: "biggest blocker", value: entry.priority.headline });
    if (entry.priority.whyItMatters !== null) {
      facts.push({ label: "why it blocks", value: entry.priority.whyItMatters });
    }
  }

  return {
    slot: "audit_result",
    productName: null,
    founderGoal: null,
    facts,
    /* See the docblock: the score is rendered beside the prose, never in it. */
    allowedNumericFacts: [],
    /*
     * An audit with no blocker is one Vibe is less sure it has read fully — a
     * clean result and a thin one look identical from here, and the payload
     * says so rather than letting the model sound certain about either.
     */
    confidence: entry.priority === null ? "low" : "high",
    nextStep: "Look at the full breakdown below.",
  };
}

/**
 * The reuse key for this project's reading of this audit.
 *
 * Recomputed identically on both sides — by the durable step that may generate,
 * and by the render that may only read. They agree because both derive it from
 * the same entry, and the entry derives from one persisted audit.
 */
export function novaAuditVoiceIdentity(projectId: string, entry: NovaAuditEntry): string {
  return computeNovaVoiceIdentity({
    projectId,
    payload: buildNovaAuditVoicePayload(entry),
    model: NOVA_PRESENTATION_CONFIG.model,
  });
}

/**
 * What to show above the audit. **Never calls a provider, and never throws.**
 *
 * The one function a component needs, and it is a read: it resolves the stored
 * message if the durable step produced one, and the template otherwise. Both
 * halves of the pair — the identity and the template — come from the same
 * entry, so a component cannot accidentally look up one message and fall back
 * to a different one's words.
 *
 * ## Why a failed lookup is not an error here
 *
 * Because the page it sits on is the founder's audit, and the sentence above
 * it is a rephrasing. A screen that returned 500 because a nicety could not be
 * looked up would have made the nicety load-bearing — the exact thing every
 * other part of this tier is built to prevent. A table that does not exist
 * yet, a policy that refuses, a network that drops: all of them resolve to the
 * template, which is what Vibe would have said anyway.
 *
 * `readNovaVoiceMessage` still throws, and should: it is the primitive, and
 * inside `ensureNovaVoiceMessage` a throw is caught by the boundary that owns
 * the spend. This is the render-facing wrapper, and the render has nowhere to
 * put an exception except on the founder's screen.
 */
export async function readNovaAuditVoice(
  supabase: SupabaseClient,
  params: { projectId: string; entry: NovaAuditEntry },
): Promise<NovaVoiceRead> {
  const template = buildNovaAuditTemplate(params.entry);

  try {
    return await readNovaVoiceMessage(supabase, {
      identity: novaAuditVoiceIdentity(params.projectId, params.entry),
      template,
    });
  } catch (error) {
    console.error("[nova-voice] could not read the stored audit message", {
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

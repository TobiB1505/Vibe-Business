import { ARTIFACT_KINDS, type ArtifactKind } from "../artifacts";
import { NOVA_ACTION_META, type NovaActionId } from "../actions";
import {
  MAX_CONVERSATION_REPLY_CHARS,
  MAX_CONVERSATION_REPLY_PARAGRAPHS,
  type NovaConversationPayload,
  type NovaConversationReply,
} from "./payload";
import {
  ALWAYS_BANNED_CLAIMS,
  BANNED_MODULE_NAMES,
  findUnnegated,
  numeralsIn,
  type NovaCheckFinding,
} from "../voice/checks";

/**
 * What Vibe refuses to show a founder, whatever the model wrote.
 *
 * ## Why this is not `voice/checks.ts` with a different limit
 *
 * Because the two lanes refuse different things. The voice validator rejects a
 * message that *explains* — that lane is a reporter. This one must allow
 * explanation and still refuse the claims explanation makes tempting: that
 * something was started, that a run will find something, that a change is safe.
 *
 * What it reuses is the part that is identical: the always-banned claims, the
 * module vocabulary, and the numeral allowlist. Those are truth rules and they
 * do not vary by lane ([ADR 0098](../../../../docs/decisions/0098-design-rules-are-revisable-truth-rules-are-not.md)).
 *
 * ## Why a bad field is dropped rather than failing the reply
 *
 * A reply with an unresolvable artifact reference is a good answer with a dead
 * link; a reply with a fabricated numeral is a lie. So the two are treated
 * differently on purpose: **a bad reference degrades the reply, a bad sentence
 * replaces it.** That is rule 45's shape — discard a citation that does not
 * resolve, never display an unverifiable one as justification — applied to a
 * pointer instead of an evidence id.
 */

export const CONVERSATION_FAILURES = [
  /** Blank, or too short to be an answer. */
  "empty_reply",
  "too_long",
  "too_many_paragraphs",
  /** Lists, headings, code fences — the thread renders prose. */
  "markdown_structure",
  /** A numeral the context did not authorize. */
  "unallowed_number",
  /** A claim this product is never in a position to make. */
  "banned_claim",
  /** "I've started the audit" — the sentence that makes a press look done. */
  "claimed_to_act",
  /** Vibe's own module vocabulary reached the founder. */
  "module_name",
] as const;

export type ConversationFailureCode = (typeof CONVERSATION_FAILURES)[number];

export const CONVERSATION_DROPS = [
  /** The artifact kind is not one this project has. */
  "artifact_not_available",
  /** The action id is not in the catalogue, or not offerable right now. */
  "action_not_available",
] as const;

export type ConversationDropCode = (typeof CONVERSATION_DROPS)[number];

export type ConversationCheckResult = {
  ok: boolean;
  failures: NovaCheckFinding<ConversationFailureCode>[];
  /** Fields removed from an otherwise good reply, with why. */
  drops: NovaCheckFinding<ConversationDropCode>[];
  /** The reply as it may be shown. Null when `ok` is false. */
  reply: NovaConversationReply | null;
};

/**
 * Sentences that claim Vibe did something, in a lane that cannot do anything.
 *
 * The specific failure this lane invites and the voice lane does not: a founder
 * asks *"should we run the audit again?"*, the model agrees and writes *"I've
 * started it"*, and the press that would actually start it is still sitting
 * there unpressed. The founder waits for a result that is not coming.
 *
 * ADR 0109 §5's sentence in code: **generated text is never the last thing
 * before a consequential effect; a press is.** A reply that says otherwise is
 * refused outright rather than degraded, because there is no version of it that
 * is true.
 *
 * First person only, deliberately. "Running the audit again would tell you" is
 * a correct thing to say about a control that exists; "I'm running the audit"
 * is not. The distinction is the pronoun, which is why the patterns carry one.
 */
const ACTION_CLAIMS = [
  /\bi(?:'ve| have)? (?:just )?(?:started|run|ran|triggered|queued|scheduled|kicked off|launched)\b/,
  /\bi(?:'m| am) (?:now )?(?:running|starting|preparing|building|merging|scanning|analysing|analyzing)\b/,
  /\bi(?:'ll| will) (?:now )?(?:start|run|trigger|queue|schedule|kick off|launch) (?:it|that|this|the)\b/,
  /\b(?:started|kicked off|queued) (?:it|that|the (?:audit|scan|run|agent|plan))\b/,
] as const;

function paragraphsOf(message: string): string[] {
  return message
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
}

export type ConversationCheckInput = {
  reply: NovaConversationReply;
  payload: NovaConversationPayload;
};

export function checkConversationReply(input: ConversationCheckInput): ConversationCheckResult {
  const failures: NovaCheckFinding<ConversationFailureCode>[] = [];
  const drops: NovaCheckFinding<ConversationDropCode>[] = [];

  const trimmed = (input.reply.message ?? "").trim();
  const normalized = trimmed.toLowerCase().replace(/\s+/g, " ");

  if (trimmed.length < 2) {
    failures.push({ code: "empty_reply", detail: `${trimmed.length} characters` });
    return { ok: false, failures, drops, reply: null };
  }

  if (trimmed.length > MAX_CONVERSATION_REPLY_CHARS) {
    failures.push({
      code: "too_long",
      detail: `${trimmed.length} characters, maximum ${MAX_CONVERSATION_REPLY_CHARS}`,
    });
  }

  const paragraphs = paragraphsOf(trimmed);
  if (paragraphs.length > MAX_CONVERSATION_REPLY_PARAGRAPHS) {
    failures.push({
      code: "too_many_paragraphs",
      detail: `${paragraphs.length} paragraphs, maximum ${MAX_CONVERSATION_REPLY_PARAGRAPHS}`,
    });
  }

  if (/^\s*[-*+]\s/m.test(trimmed) || /^#{1,6}\s/m.test(trimmed) || trimmed.includes("```")) {
    failures.push({ code: "markdown_structure", detail: "list, heading or code fence" });
  }

  const allowed = new Set(input.payload.allowedNumericFacts);
  for (const numeral of numeralsIn(trimmed)) {
    if (!allowed.has(numeral)) failures.push({ code: "unallowed_number", detail: numeral });
  }

  /*
   * Asserted, not merely present. A founder may ask "is it live yet?", and the
   * correct answer — "I can't tell you whether it is live; Vibe never observes
   * that" — contains the phrase and is exactly the sentence this product exists
   * to say. `findUnnegated` is the voice lane's own rule, shared rather than
   * copied: one definition of what counts as a denial.
   */
  for (const claim of findUnnegated(normalized, ALWAYS_BANNED_CLAIMS)) {
    failures.push({ code: "banned_claim", detail: claim });
  }

  for (const pattern of ACTION_CLAIMS) {
    const hit = pattern.exec(normalized);
    if (hit) failures.push({ code: "claimed_to_act", detail: hit[0] });
  }

  for (const name of BANNED_MODULE_NAMES) {
    if (normalized.includes(name)) failures.push({ code: "module_name", detail: name });
  }

  if (failures.length > 0) return { ok: false, failures, drops, reply: null };

  return {
    ok: true,
    failures,
    drops,
    reply: {
      message: trimmed,
      artifact: resolveArtifact(input, drops),
      actionId: resolveAction(input, drops),
    },
  };
}

/**
 * The artifact, if it is one this project actually has.
 *
 * Checked against `availableArtifacts` rather than against the union, because
 * the union says what *could* exist and the payload says what does. A model
 * naming `prepared_change` for a project with nothing prepared passes the enum
 * and would render a frame with a link to an empty screen.
 */
function resolveArtifact(
  input: ConversationCheckInput,
  drops: NovaCheckFinding<ConversationDropCode>[],
): { kind: ArtifactKind; ref: string | null } | null {
  const artifact = input.reply.artifact;
  if (artifact === undefined || artifact === null) return null;

  if (!(ARTIFACT_KINDS as readonly string[]).includes(artifact.kind)) {
    drops.push({ code: "artifact_not_available", detail: String(artifact.kind) });
    return null;
  }

  const ref = artifact.ref ?? null;
  const offered = input.payload.availableArtifacts.find(
    (candidate) => candidate.kind === artifact.kind && candidate.ref === ref,
  );

  if (offered === undefined) {
    drops.push({
      code: "artifact_not_available",
      detail: `${artifact.kind}${ref === null ? "" : `:${ref}`}`,
    });
    return null;
  }

  return { kind: offered.kind, ref: offered.ref };
}

/**
 * The proposal, if it is a catalogue action this project can currently take.
 *
 * Two checks, not one. That the id is in `NOVA_ACTION_META` is what keeps a
 * hallucinated id off the screen; that it is in `availableActions` is what
 * keeps a *real* control from being offered in a state where pressing it would
 * be refused — the dead end `home-view.ts` records reaching twice, once through
 * a stale plan and once through a change at the wrong stage.
 */
function resolveAction(
  input: ConversationCheckInput,
  drops: NovaCheckFinding<ConversationDropCode>[],
): NovaActionId | null {
  const actionId = input.reply.actionId;
  if (actionId === undefined || actionId === null) return null;

  if (!(actionId in NOVA_ACTION_META)) {
    drops.push({ code: "action_not_available", detail: String(actionId) });
    return null;
  }

  const offered = input.payload.availableActions.some(
    (candidate) => candidate.actionId === actionId,
  );

  if (!offered) {
    drops.push({ code: "action_not_available", detail: actionId });
    return null;
  }

  return actionId;
}

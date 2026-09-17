import { arePaidOperationsDisabled } from "../../operations/kill-switch";

/**
 * Whether Nova may spend on answering a question right now.
 *
 * ## Two levers, and both must allow it
 *
 * The same shape `isNovaVoiceEnabled` has, for the same two reasons.
 * `NOVA_CONVERSATION_ENABLED=1` is this lane's own switch, off by default so
 * that shipping the code changes no bill until somebody decides it should.
 * `PAID_OPERATIONS_DISABLED=1` is the existing spend-incident lever (VB-032),
 * and a conversation is paid inference like any other — a switch thrown to stop
 * money leaving must stop this too, or it is not the switch it says it is.
 *
 * Exact `"1"` on both: a lever read from a loose truthiness check is one a stray
 * `=false` turns on, and finding that out during an incident is the worst
 * possible time.
 *
 * ## Why switching it off is not an outage
 *
 * Every path through `service.ts` returns something a founder can read, so this
 * being off means Nova says she cannot answer — on every question, in Vibe's
 * own words — which is a state the product already handles. The composer is
 * still there and the reply still arrives. Nothing about the product's shape
 * depends on it and no screen renders differently.
 *
 * It is named here, once, with what it does, rather than read inline from
 * `process.env` — rule 78's line about gating a customer capability on an
 * environment variable nothing documents.
 */

/** Set to `1` to let Nova answer questions with a model. */
export const NOVA_CONVERSATION_FLAG = "NOVA_CONVERSATION_ENABLED";

export function isNovaConversationEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env[NOVA_CONVERSATION_FLAG] === "1" && !arePaidOperationsDisabled(env);
}

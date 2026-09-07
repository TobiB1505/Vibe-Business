"use server";

import { revalidatePath } from "next/cache";
import { OPERATION_FAILURE_MESSAGES } from "@/modules/operations/messages";
import { novaActionSubjectKind, type DispatchableNovaActionId } from "./nova-dispatch";

import { checkProductionOutcomeAction } from "../outcome-actions";
import { startAuditAction } from "../run-audit-action";
import { startPlanAction } from "../plan-action";
import { startUnderstandingAction } from "../understanding-actions";
import { rerunChangeValidationAction } from "../validate-change-action";

/**
 * The controls Nova Home can press itself (UI Sourcing Spec §14, C1).
 *
 * ## Why this is a small allowlist and not a generic dispatcher
 *
 * `NOVA_ACTIONS` binds every catalogued id to a real export, and its own
 * comment is explicit that the binding proves existence rather than a calling
 * convention: the actions genuinely do not share a signature, and some need
 * arguments Home does not hold. A merge needs the approval id; a build needs
 * the plan step key. A generic `(...args: never[])` call site would either not
 * type-check or would fabricate arguments.
 *
 * So this wraps the five whose arguments Home *does* hold, and
 * `home-view.ts` routes every other candidate to the surface that owns its
 * decision. The five are re-checked below against the subject the focus model
 * carried, so a caller cannot ask for one with the wrong kind of subject.
 *
 * ## What the wrapper does not do
 *
 * It does not authorise anything. Every action underneath calls
 * `requireSession()` and runs its own preflight, ownership and Credit checks
 * against live state — this only supplies arguments and normalises five
 * different result shapes into one the card can render. Removing a check here
 * would remove nothing, because there is none here to remove.
 *
 * ## Why it revalidates Home, and why nothing else did
 *
 * Everything Home shows is derived: press "Plan this move" and an
 * `action_planning` row exists, `readNovaFocus` puts it in `working`, and the
 * card becomes the running one. That is the whole state machine and it needs
 * no message queue — but it only happens on a *read*.
 *
 * Nothing was causing one. The actions underneath revalidate the surface they
 * belong to — `startPlanAction` revalidates the plan — and Home is not that
 * surface. `NovaWorkingLive` polls, and polls only while something is already
 * running, so a click that starts the first operation had nothing watching for
 * it. From a founder's side the press did nothing: the card said the same
 * sentence, and the work it started was invisible until the next navigation.
 *
 * So the wrapper revalidates the route it belongs to. One line, at the one
 * place all five dispatched actions pass through.
 */

/** Home's own route. The five actions below revalidate it; each also
 *  revalidates whichever surface it belongs to, and neither replaces the other. */
function homePath(projectId: string): string {
  return `/app/projects/${projectId}`;
}

export type NovaHomeActionState =
  | { ok: true }
  /** Nothing ran because the same work already exists. Not a failure. */
  | { ok: true; reused: true }
  | { ok: false; message: string }
  | null;

const GENERIC_FAILURE = "Vibe could not start that. Nothing has changed.";

export async function runNovaHomeAction(
  projectId: string,
  actionId: DispatchableNovaActionId,
  /** The prepared change or Move the candidate was about. Null for a project. */
  subjectId: string | null,
  _prevState: NovaHomeActionState,
  formData: FormData,
): Promise<NovaHomeActionState> {
  const state = await dispatch(projectId, actionId, subjectId, formData);

  /*
   * Only on success. A refused start changed nothing, and revalidating would
   * re-read every row behind Home to draw the same card with an error on it.
   * A reused result *is* a success — the work exists, and the founder should
   * see it whether this press or an earlier one started it.
   */
  if (state?.ok) revalidatePath(homePath(projectId));

  return state;
}

async function dispatch(
  projectId: string,
  actionId: DispatchableNovaActionId,
  subjectId: string | null,
  formData: FormData,
): Promise<NovaHomeActionState> {
  const needs = novaActionSubjectKind(actionId);
  if (needs !== "project" && subjectId === null) {
    // The focus model always carries a subject for these. Arriving without one
    // means the form was assembled by something other than the card, so this
    // refuses rather than guessing which change or Move was meant.
    return { ok: false, message: GENERIC_FAILURE };
  }

  switch (actionId) {
    case "nova.refresh_audit": {
      /*
       * `force` is deliberately left off. An audit whose inputs genuinely
       * changed will not be deduplicated, and one whose inputs did not should
       * not be paid for twice (rule 48) — so the honest answer to "run it
       * again" is to ask, and let identity decide whether anything is owed.
       */
      const result = await startAuditAction(projectId, null, formData);
      if (result === null) return { ok: false, message: GENERIC_FAILURE };
      if (!result.ok) return { ok: false, message: OPERATION_FAILURE_MESSAGES[result.error] };
      return result.kind === "reused" ? { ok: true, reused: true } : { ok: true };
    }

    case "nova.rescan_product": {
      const result = await startUnderstandingAction(projectId, null, formData);
      if (result === null) return { ok: false, message: GENERIC_FAILURE };
      return result.ok ? { ok: true } : { ok: false, message: GENERIC_FAILURE };
    }

    case "nova.plan_move": {
      const result = await startPlanAction(projectId, subjectId, null, formData);
      if (result === null) return { ok: false, message: GENERIC_FAILURE };
      if (!result.ok) return { ok: false, message: OPERATION_FAILURE_MESSAGES[result.error] };
      return result.kind === "reused" ? { ok: true, reused: true } : { ok: true };
    }

    case "nova.verify_outcome": {
      const result = await checkProductionOutcomeAction(projectId, subjectId as string);
      // This one already carries founder-facing copy for its own failures.
      return result.ok ? { ok: true } : { ok: false, message: result.message };
    }

    case "nova.validate_again": {
      const result = await rerunChangeValidationAction(projectId, subjectId as string);
      if (result === null) return { ok: false, message: GENERIC_FAILURE };
      return result.ok ? { ok: true } : { ok: false, message: GENERIC_FAILURE };
    }
  }
}

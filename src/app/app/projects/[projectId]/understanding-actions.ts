"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { recordAuditEvent } from "@/modules/audit-log/events";
import { requireSession } from "@/modules/auth/session";
import type { OperationFailureCode } from "@/modules/operations/failures";
import { startProductUnderstandingOperation } from "@/modules/operations/service";
import { VercelWorkflowExecutor } from "@/modules/operations/vercel/executor";
import type { OperationView } from "@/modules/operations/view";
import {
  confirmProfile,
  getLatestProfile,
  saveCorrections,
  sanitizeCorrections,
} from "@/modules/product-understanding/store";
import { EDITABLE_FIELDS } from "@/modules/product-understanding/schema";
import { isTerminal } from "@/modules/operations/schema";

/**
 * Starting, confirming and correcting a product understanding
 * (CORE-1 §22, §23, §24).
 *
 * The only input any of these accepts from the browser is an id the caller
 * must already own, plus — for the editor — free text that goes through a
 * closed allowlist before it is stored. Evidence, model and prompt all come
 * from the server, so nothing here can be used to run inference on arbitrary
 * content or to spend on someone else's project.
 */

export type StartUnderstandingState =
  /** Nothing ran: an identical profile already existed. */
  | { ok: true; kind: "reused" }
  /** Durable work is now running — either just started, or already was. */
  | { ok: true; kind: "running"; operation: OperationView }
  | { ok: false; error: OperationFailureCode }
  | null;

export async function startUnderstandingAction(
  projectId: string,
  _prevState: StartUnderstandingState,
  formData: FormData,
): Promise<StartUnderstandingState> {
  const session = await requireSession();
  const supabase = await createClient();

  // A re-run costs money, so it is only ever requested by an explicit form
  // value — never defaulted on (CORE-1 §21).
  const force = formData.get("force") === "true";

  const outcome = await startProductUnderstandingOperation(supabase, new VercelWorkflowExecutor(), {
    projectId,
    userId: session.userId,
    force,
  });

  if (outcome.kind === "failed") return { ok: false, error: outcome.error };

  if (outcome.kind === "reused") {
    revalidatePath(`/app/projects/${projectId}/understanding`);
    return { ok: true, kind: "reused" };
  }

  return { ok: true, kind: "running", operation: outcome.operation };
}

export type ConfirmUnderstandingState =
  | { ok: true }
  | { ok: false; error: "not_found" }
  | null;

/**
 * "Yes, that's my product" (CORE-1 §23).
 *
 * Binds to one specific profile id rather than to "the latest": the person is
 * saying yes to what is on their screen, and if a newer derivation landed
 * while they were reading it, that one has not been confirmed by anyone.
 */
export async function confirmUnderstandingAction(
  projectId: string,
  profileId: string,
): Promise<ConfirmUnderstandingState> {
  const session = await requireSession();
  const supabase = await createClient();

  // Ownership is the query: RLS scopes the project to this user, and the
  // project scopes the profile — a guessed id resolves to nothing.
  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", session.userId)
    .maybeSingle();

  if (!project) return { ok: false, error: "not_found" };

  const confirmed = await confirmProfile(supabase, { projectId, profileId });

  if (confirmed) {
    await recordAuditEvent(supabase, {
      userId: session.userId,
      projectId,
      eventType: "product_understanding.confirmed",
      metadata: { projectId, profileId },
    });
  }

  revalidatePath(`/app/projects/${projectId}/understanding`);
  // A second click is a no-op, not a failure: the profile is confirmed either
  // way, and telling the user otherwise would be wrong.
  return { ok: true };
}

export type SaveCorrectionsState =
  | { ok: true }
  | { ok: false; error: "not_found" }
  | null;

/**
 * The edit flow (CORE-1 §24).
 *
 * Only the semantic fields are editable. Scanner evidence is not, and never
 * will be here — a person correcting "who this is for" is telling Vibe
 * something it could not know, while a person editing "your code contains a
 * pricing page" would be editing an observation.
 *
 * Saving also confirms: someone who read the profile, rewrote part of it and
 * pressed save has looked at it at least as carefully as someone who pressed
 * "yes".
 */
export async function saveCorrectionsAction(
  projectId: string,
  profileId: string,
  _prevState: SaveCorrectionsState,
  formData: FormData,
): Promise<SaveCorrectionsState> {
  const session = await requireSession();
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", session.userId)
    .maybeSingle();

  if (!project) return { ok: false, error: "not_found" };

  // Read through the closed field list rather than iterating the form: a form
  // field nobody declared must not become a stored correction.
  const raw: Record<string, unknown> = {};
  for (const field of EDITABLE_FIELDS) {
    const value = formData.get(field);
    if (typeof value === "string") raw[field] = value;
  }

  const corrections = sanitizeCorrections(raw);
  await saveCorrections(supabase, { projectId, corrections });
  await confirmProfile(supabase, { projectId, profileId });

  await recordAuditEvent(supabase, {
    userId: session.userId,
    projectId,
    eventType: "product_understanding.corrected",
    metadata: {
      projectId,
      profileId,
      // Field names only. The corrected text itself is the user's own product
      // description and has no business in an append-only event log.
      fields: Object.keys(corrections),
    },
  });

  revalidatePath(`/app/projects/${projectId}/understanding`);
  return { ok: true };
}

/**
 * One poll. Reads Supabase, never the execution provider: the application's
 * own state is canonical (ADR 0013).
 */
export async function getUnderstandingStatusAction(
  projectId: string,
  operationId: string,
): Promise<{ ok: true; operation: OperationView } | { ok: false; error: "not_found" }> {
  const session = await requireSession();
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", session.userId)
    .maybeSingle();

  if (!project) return { ok: false, error: "not_found" };

  const { getOperationStatus } = await import("@/modules/operations/service");
  const operation = await getOperationStatus(supabase, { projectId, operationId });
  if (!operation) return { ok: false, error: "not_found" };

  // Stale is stale: a run that failed or was cancelled leaves the screen just
  // as wrong as one that succeeded.
  if (isTerminal(operation.status)) {
    revalidatePath(`/app/projects/${projectId}/understanding`);
  }

  return { ok: true, operation };
}

/** Whether this project already has a profile, used to label the start control. */
export async function hasProfileAction(projectId: string): Promise<boolean> {
  const supabase = await createClient();
  const latest = await getLatestProfile(supabase, projectId);
  return latest !== null;
}

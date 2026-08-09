"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/modules/auth/session";
import { createClient } from "@/lib/supabase/server";
import { inspectRepository, type InspectFailureCode } from "@/modules/repository-intelligence/service";

export type InspectActionState = { ok: true; reused: boolean } | { ok: false; error: InspectFailureCode } | null;

/**
 * Runs repository intelligence for a project the caller owns. Ownership
 * is re-verified inside the service from persisted data — the only input
 * accepted here is a project id (Sprint 2 §26).
 *
 * Synchronous and bounded by the analyzer's budgets: no queue or
 * background worker is introduced (Sprint 2 §32).
 */
export async function inspectRepositoryAction(
  projectId: string,
  _prevState: InspectActionState,
  formData: FormData,
): Promise<InspectActionState> {
  const session = await requireSession();
  const supabase = await createClient();

  const force = formData.get("force") === "true";
  const result = await inspectRepository(supabase, { projectId, userId: session.userId }, { force });

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  revalidatePath(`/app/projects/${projectId}`);
  return { ok: true, reused: result.reused };
}

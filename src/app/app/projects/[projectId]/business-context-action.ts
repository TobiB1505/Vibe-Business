"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/modules/auth/session";
import { createClient } from "@/lib/supabase/server";
import { saveBusinessContext, type SaveBusinessContextFailure } from "@/modules/projects/business-context-store";

export type BusinessContextActionState =
  | { ok: true; changed: boolean }
  | { ok: false; error: SaveBusinessContextFailure }
  | null;

/**
 * Saves a project's business context (Sprint 4 §2). Validation and
 * normalization happen in the domain layer, so raw form input never
 * reaches the database or an evidence pack unchecked.
 */
export async function saveBusinessContextAction(
  projectId: string,
  _prevState: BusinessContextActionState,
  formData: FormData,
): Promise<BusinessContextActionState> {
  const session = await requireSession();
  const supabase = await createClient();

  const result = await saveBusinessContext(supabase, {
    projectId,
    userId: session.userId,
    input: {
      productSummary: formData.get("productSummary"),
      targetCustomer: formData.get("targetCustomer"),
      stage: formData.get("stage"),
      monetizationModel: formData.get("monetizationModel"),
      primaryGoal: formData.get("primaryGoal"),
    },
  });

  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath(`/app/projects/${projectId}`);
  return { ok: true, changed: result.changed };
}

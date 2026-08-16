"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/modules/auth/session";
import { createClient } from "@/lib/supabase/server";
import { saveFounderIntent, type SaveFounderIntentFailure } from "@/modules/projects/founder-intent-store";

export type FounderIntentActionState =
  | { ok: true; changed: boolean }
  | { ok: false; error: SaveFounderIntentFailure }
  | null;

/**
 * Saves a project's founder intent (CORE-2 §4).
 *
 * Replaces `saveBusinessContextAction`. Validation and normalization happen in
 * the domain layer, so raw form input never reaches the database or an evidence
 * pack unchecked — and since every field is now a closed enum, anything that is
 * not one of our own values is rejected outright rather than trimmed.
 */
export async function saveFounderIntentAction(
  projectId: string,
  _prevState: FounderIntentActionState,
  formData: FormData,
): Promise<FounderIntentActionState> {
  const session = await requireSession();
  const supabase = await createClient();

  const result = await saveFounderIntent(supabase, {
    projectId,
    userId: session.userId,
    input: {
      stage: formData.get("stage"),
      monetizationModel: formData.get("monetizationModel"),
      primaryGoal: formData.get("primaryGoal"),
    },
  });

  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath(`/app/projects/${projectId}`);
  return { ok: true, changed: result.changed };
}

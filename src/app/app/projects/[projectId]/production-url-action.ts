"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/modules/auth/session";
import { createClient } from "@/lib/supabase/server";
import { setProductionUrl, type SetProductionUrlFailure } from "@/modules/projects/production-url";

export type ProductionUrlActionState =
  | { ok: true; url: string }
  | { ok: false; error: SetProductionUrlFailure }
  | null;

/**
 * Saves a project's production URL (Sprint 3 §3).
 *
 * Validation and normalization happen in the domain layer, so the raw
 * string the user typed never reaches the database or any outbound
 * request path.
 */
export async function setProductionUrlAction(
  projectId: string,
  _prevState: ProductionUrlActionState,
  formData: FormData,
): Promise<ProductionUrlActionState> {
  const session = await requireSession();
  const supabase = await createClient();

  const rawUrl = formData.get("productionUrl");
  if (typeof rawUrl !== "string") return { ok: false, error: "empty" };

  const result = await setProductionUrl(supabase, {
    projectId,
    userId: session.userId,
    rawUrl,
  });

  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath(`/app/projects/${projectId}`);
  return { ok: true, url: result.url };
}

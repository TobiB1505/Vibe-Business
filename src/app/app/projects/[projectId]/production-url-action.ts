"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/modules/auth/session";
import { createClient } from "@/lib/supabase/server";
import { setProductionUrl, type SetProductionUrlFailure } from "@/modules/projects/production-url";
import { setLiveSiteStatus } from "@/modules/onboarding/store";

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

  // If this project is still onboarding, a later canonical URL update clears
  // the earlier no-site intent. For mature projects the scoped update is a
  // harmless no-op when no onboarding row exists.
  await setLiveSiteStatus(supabase, { projectId, status: "provided" });

  revalidatePath(`/app/projects/${projectId}`);
  return { ok: true, url: result.url };
}

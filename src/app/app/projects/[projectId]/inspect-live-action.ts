"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/modules/auth/session";
import { createClient } from "@/lib/supabase/server";
import { inspectLiveProduct, type InspectLiveFailureCode } from "@/modules/live-product-intelligence/service";

export type InspectLiveActionState =
  | { ok: true; reused: boolean }
  | { ok: false; error: InspectLiveFailureCode }
  | null;

/**
 * Runs live product intelligence for a project the caller owns.
 *
 * The only input accepted is a project id — the URL that gets crawled is
 * read from the caller's own project and re-validated inside the service,
 * so this action cannot be used to make Vibe Business fetch an arbitrary
 * destination (Sprint 3 §5).
 *
 * Synchronous and bounded by the crawl budgets: no queue or background
 * worker is introduced (Sprint 3 §28).
 */
export async function inspectLiveProductAction(
  projectId: string,
  _prevState: InspectLiveActionState,
  formData: FormData,
): Promise<InspectLiveActionState> {
  const session = await requireSession();
  const supabase = await createClient();

  const force = formData.get("force") === "true";
  const result = await inspectLiveProduct(supabase, { projectId, userId: session.userId }, { force });

  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath(`/app/projects/${projectId}`);
  return { ok: true, reused: result.reused };
}

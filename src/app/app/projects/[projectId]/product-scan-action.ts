"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/modules/auth/session";
import { createClient } from "@/lib/supabase/server";
import {
  inspectLiveProduct,
  type InspectLiveFailureCode,
} from "@/modules/live-product-intelligence/service";
import {
  inspectRepository,
  type InspectFailureCode,
} from "@/modules/repository-intelligence/service";

/**
 * One Product Scan, both sources (Stage D of the nine-lens restructure).
 *
 * A founder does not run "repository intelligence" and then "a live product
 * check" — they scan their product, and Vibe reads the code and visits the
 * site. This action is that sentence: the repository read always, the live
 * visit whenever a production URL is stored. It mirrors onboarding's
 * `beginUnderstandingAction`, including the stepped failure shape, so the two
 * places a scan can start cannot drift apart in behaviour.
 *
 * Sequential and in-request on purpose, exactly like onboarding — both
 * analyses are bounded and synchronous, and no queue, worker or other
 * background technology is introduced (rule 24). Both sources are free; no
 * credit path exists anywhere below this call.
 *
 * A live failure after a successful repository read keeps the repository
 * result: the page is revalidated before the failure returns, so the half
 * that worked shows while the failure says which half did not.
 */
export type ProductScanState =
  | { ok: true; repositoryReused: boolean; liveReused: boolean | null }
  | { ok: false; step: "repository"; error: InspectFailureCode }
  | { ok: false; step: "live"; error: InspectLiveFailureCode }
  | null;

export async function runProductScanAction(
  projectId: string,
  _prevState: ProductScanState,
  formData: FormData,
): Promise<ProductScanState> {
  const session = await requireSession();
  const supabase = await createClient();

  const force = formData.get("force") === "true";

  const repository = await inspectRepository(
    supabase,
    { projectId, userId: session.userId },
    { force },
  );
  if (!repository.ok) return { ok: false, step: "repository", error: repository.error };

  // The stored URL decides whether a live half exists — never the form. The
  // service re-validates the address itself; this only asks whether to call.
  const { data: project } = await supabase
    .from("projects")
    .select("production_url")
    .eq("id", projectId)
    .eq("user_id", session.userId)
    .maybeSingle();

  let liveReused: boolean | null = null;
  if (project?.production_url) {
    const live = await inspectLiveProduct(
      supabase,
      { projectId, userId: session.userId },
      { force },
    );
    if (!live.ok) {
      revalidatePath(`/app/projects/${projectId}`);
      return { ok: false, step: "live", error: live.error };
    }
    liveReused = live.reused;
  }

  revalidatePath(`/app/projects/${projectId}`);
  return { ok: true, repositoryReused: repository.reused, liveReused };
}

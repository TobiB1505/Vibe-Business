"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/modules/auth/session";
import { getOperationStatus } from "@/modules/operations/service";
import { isTerminal } from "@/modules/operations/schema";
import type { OperationView } from "@/modules/operations/view";
import { getProductScanEvents } from "@/modules/product-scan/store";
import type { ProductScanEvent } from "@/modules/product-scan/schema";

export type ProductScanStatus = {
  operation: OperationView;
  events: ProductScanEvent[];
};

export async function getProductScanStatusAction(
  projectId: string,
  operationId: string,
): Promise<{ ok: true; scan: ProductScanStatus } | { ok: false; error: "not_found" }> {
  const session = await requireSession();
  const supabase = await createClient();
  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", session.userId)
    .maybeSingle();
  if (!project) return { ok: false, error: "not_found" };

  const operation = await getOperationStatus(supabase, { projectId, operationId });
  if (!operation) return { ok: false, error: "not_found" };
  const events = await getProductScanEvents(supabase, { projectId, operationId });

  if (isTerminal(operation.status)) {
    revalidatePath(`/app/projects/${projectId}/product`);
    revalidatePath(`/app/onboarding/${projectId}`);
  }
  return { ok: true, scan: { operation, events } };
}

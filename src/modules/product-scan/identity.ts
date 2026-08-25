import { createHash } from "node:crypto";

export const PRODUCT_SCAN_WORKFLOW_VERSION = "product-scan.v1" as const;

/** One active Product Scan per project; completed scans never block a new click. */
export function computeProductScanIdentity(projectId: string): string {
  return createHash("sha256")
    .update(JSON.stringify({ projectId, workflow: PRODUCT_SCAN_WORKFLOW_VERSION }))
    .digest("hex");
}

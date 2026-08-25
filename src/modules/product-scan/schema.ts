export const PRODUCT_SCAN_EVENT_TYPES = [
  "scan_started",
  "source_started",
  "source_ready",
  "source_unavailable",
  "finding",
  "profile_ready",
  "scan_completed",
  "scan_failed",
] as const;

export type ProductScanEventType = (typeof PRODUCT_SCAN_EVENT_TYPES)[number];

export const PRODUCT_SCAN_PHASES = ["code", "public_product", "understanding", "finished"] as const;
export type ProductScanPhase = (typeof PRODUCT_SCAN_PHASES)[number];

export const PRODUCT_SCAN_SOURCES = ["system", "repository", "live_product", "product_profile"] as const;
export type ProductScanSource = (typeof PRODUCT_SCAN_SOURCES)[number];

export const PRODUCT_SCAN_EVENT_LIMIT = 24;

export type ProductScanEvent = {
  id: string;
  operationId: string;
  sequence: number;
  eventKey: string;
  type: ProductScanEventType;
  phase: ProductScanPhase;
  source: ProductScanSource;
  findingKey: string | null;
  title: string;
  detail: string | null;
  referenceId: string | null;
  occurredAt: string;
};

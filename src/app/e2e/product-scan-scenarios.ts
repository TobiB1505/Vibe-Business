import type { OperationView } from "@/modules/operations/view";
import type { ProductScanEvent } from "@/modules/product-scan/schema";
import type { ProductScanPresentation } from "@/modules/product-scan/presentation";

const BASE_OPERATION: OperationView = {
  operationId: "00000000-0000-0000-0000-000000000052",
  status: "completed",
  stage: "completed",
  startedAt: "2026-08-25T10:00:00.000Z",
  completedAt: "2026-08-25T10:00:42.000Z",
  failureCode: null,
  resultId: "00000000-0000-0000-0000-000000000053",
  shouldPoll: false,
  retryAllowed: false,
  stalled: false,
};

const BASE_PRESENTATION: ProductScanPresentation = {
  name: "Vibe Business",
  description: "AI business guidance grounded in a connected product.",
  productType: "Web application",
  audience: "AI builders and founders",
  businessModel: "Subscription signals",
  profileStatus: "Ready to review",
  techStack: "Next.js",
  logo: { url: "/brand/vibe-mark.svg", alt: "Vibe Business mark" },
  typeface: "Inter",
  colors: ["#00E5A0"],
  capabilities: ["Authentication", "Business guidance", "Product scans"],
};

function event(
  sequence: number,
  overrides: Partial<ProductScanEvent>,
): ProductScanEvent {
  return {
    id: `00000000-0000-0000-0000-${String(sequence).padStart(12, "0")}`,
    operationId: BASE_OPERATION.operationId,
    sequence,
    eventKey: `fixture.${sequence}`,
    type: "finding",
    phase: "code",
    source: "repository",
    findingKey: null,
    title: "Grounded discovery",
    detail: "Compiled from bounded derived evidence.",
    referenceId: null,
    occurredAt: `2026-08-25T10:00:${String(sequence).padStart(2, "0")}.000Z`,
    ...overrides,
  };
}

const COMPLETE_EVENTS = [
  event(1, { type: "scan_started", source: "system", title: "Product Scan started" }),
  event(2, { type: "source_ready", title: "Repository structure mapped" }),
  event(3, { findingKey: "framework.nextjs", title: "Next.js application detected" }),
  event(4, { findingKey: "integration.auth", title: "authentication signal found" }),
  event(5, { findingKey: "brand.asset.logo", title: "Product logo detected" }),
  event(6, { findingKey: "brand.typeface.primary", title: "Inter typography detected" }),
  event(7, { findingKey: "brand.color.primary", title: "Primary color detected" }),
  event(8, { source: "live_product", phase: "public_product", type: "source_ready", title: "Public product mapped" }),
  event(9, { source: "live_product", phase: "public_product", findingKey: "surface.pricing", title: "Pricing reached" }),
  event(10, { source: "product_profile", phase: "understanding", type: "profile_ready", title: "Product picture assembled" }),
  event(11, { source: "system", phase: "finished", type: "scan_completed", title: "Product Scan complete" }),
] as const;

export const E2E_PRODUCT_SCAN_SCENARIOS = {
  product_scan_complete: {
    operation: BASE_OPERATION,
    presentation: BASE_PRESENTATION,
    events: COMPLETE_EVENTS,
  },
  product_scan_reveal: {
    operation: BASE_OPERATION,
    presentation: BASE_PRESENTATION,
    events: COMPLETE_EVENTS,
  },
  product_scan_partial: {
    operation: BASE_OPERATION,
    presentation: BASE_PRESENTATION,
    events: [
      event(1, { type: "scan_started", source: "system", title: "Product Scan started" }),
      event(2, { type: "source_ready", title: "Repository structure mapped" }),
      event(3, { findingKey: "framework.nextjs", title: "Next.js application detected" }),
      event(4, {
        source: "live_product",
        phase: "public_product",
        type: "source_unavailable",
        findingKey: "live_failure.homepage_unreachable",
        title: "Public product could not be fully read",
      }),
      event(5, { source: "product_profile", phase: "understanding", type: "profile_ready", title: "Product picture assembled" }),
      event(6, { source: "system", phase: "finished", type: "scan_completed", title: "Product Scan complete" }),
    ],
  },
} as const;

export type E2eProductScanScenario = keyof typeof E2E_PRODUCT_SCAN_SCENARIOS;

export function isE2eProductScanScenario(value: string): value is E2eProductScanScenario {
  return value in E2E_PRODUCT_SCAN_SCENARIOS;
}

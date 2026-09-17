import type { OperationView } from "@/modules/operations/view";
import type { ProductScanPresentation } from "@/modules/product-scan/presentation";
import type { ProductScanEvent } from "@/modules/product-scan/schema";

/**
 * The Product Scan the landing page shows, as the product's own types (UI-34).
 *
 * ## Why the scanned product is Vibe
 *
 * A landing page showing a scan has to scan *something*, and every other
 * option is worse. An invented customer is a fabricated record whatever the
 * caption says; a real customer's product needs their permission and their
 * numbers; a placeholder called "Your product" throws away the one thing worth
 * showing, which is that Vibe recognised what it was looking at.
 *
 * So it reads Vibe Business, and every line of it is true of this repository:
 * a Next.js web application, built for AI builders and founders, with
 * authentication, business guidance and product scans as capabilities, and
 * subscription signals in the code. Nothing here is a claim the product cannot
 * back, because the product it describes is the one serving the page.
 *
 * ## What is example and what is not
 *
 * The timestamps and the operation id are example. The **shape** is not: these
 * are `ProductScanPresentation` and `ProductScanEvent`, the types a real scan
 * produces, so a facet the scanner cannot fill or an event type it never emits
 * is a compile error here rather than a flattering picture.
 *
 * It mirrors `src/app/e2e/product-scan-scenarios.ts`, which holds the same
 * scan for the browser suite. Deliberately not imported from there: fixtures
 * are reachable only behind `VIBE_E2E_FIXTURES`, and a production page must not
 * pull the fixture module into its bundle to have something to draw.
 */

export const LANDING_SCAN_PRESENTATION: ProductScanPresentation = {
  name: "Vibe Business",
  description: "AI business guidance grounded in a connected product.",
  productType: "Web application",
  audience: "AI builders and founders",
  businessModel: "Subscription signals",
  profileStatus: "Ready to review",
  techStack: "Next.js",
  logo: null,
  typeface: "Geist",
  colors: ["#00E5A0"],
  capabilities: ["Authentication", "Business guidance", "Product scans"],
};

const OPERATION_ID = "00000000-0000-0000-0000-0000000004a1";

/**
 * A scan that finished.
 *
 * Required, not optional: `ProductScanExperience` assembles its picture from
 * the operation, the events and the presentation *together*, so passing the
 * last two without the first renders the constellation with every facet saying
 * "Detecting…" — which is how the first attempt at this block looked, and it is
 * a screenshot of the product failing rather than working.
 *
 * `shouldPoll: false` and a completed status keep it inert: `operationPollPhase`
 * is not `working`, so the component's poll never arms.
 */
export const LANDING_SCAN_OPERATION: OperationView = {
  operationId: OPERATION_ID,
  status: "completed",
  stage: "completed",
  startedAt: "2026-08-25T10:00:00.000Z",
  completedAt: "2026-08-25T10:00:42.000Z",
  failureCode: null,
  resultId: null,
  shouldPoll: false,
  retryAllowed: false,
  stalled: false,
};

function event(sequence: number, overrides: Partial<ProductScanEvent>): ProductScanEvent {
  return {
    id: `00000000-0000-0000-0000-${String(sequence).padStart(12, "0")}`,
    operationId: OPERATION_ID,
    sequence,
    eventKey: `landing.${sequence}`,
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

/**
 * A finished scan, with every facet filled.
 *
 * The scan block is the page saying *it recognised the product*, so the
 * settled state is the one to show. The honesty about what a scan cannot reach
 * is carried a few lines below it by the source strip, which is where it
 * belongs — inside this constellation it would be a hole in a picture whose
 * subject is that the picture came out.
 */
export const LANDING_SCAN_EVENTS: ProductScanEvent[] = [
  event(1, { type: "scan_started", source: "system", title: "Product Scan started" }),
  event(2, { type: "source_ready", title: "Repository structure mapped" }),
  /*
    This one carries its own `detail`, because the "Product type" facet prints
    the finding's detail as its caption — and the shared default, "Compiled from
    bounded derived evidence", is internal wording that truncated to "Compiled
    from bou…" under the facet card. "Code" is what the other five facets show
    there, resolved from their source.
  */
  event(3, {
    findingKey: "framework.nextjs",
    title: "Next.js application detected",
    detail: "Code",
  }),
  event(4, { findingKey: "capability.auth", title: "Authentication signal found" }),
  event(5, { findingKey: "audience.positioning", title: "Built for AI builders and founders" }),
  event(6, { findingKey: "brand.typeface.primary", title: "Geist typography detected" }),
  event(7, { findingKey: "brand.color.primary", title: "Primary colour detected" }),
  event(8, {
    source: "live_product",
    phase: "public_product",
    type: "source_ready",
    title: "Public product mapped",
  }),
  event(9, {
    source: "live_product",
    phase: "public_product",
    findingKey: "surface.pricing",
    title: "Pricing reached",
  }),
  event(10, {
    source: "repository",
    findingKey: "integration.subscription",
    title: "Subscription signals in the code",
  }),
  event(11, {
    source: "product_profile",
    phase: "understanding",
    type: "profile_ready",
    title: "Product picture assembled",
  }),
  event(12, {
    source: "system",
    phase: "finished",
    type: "scan_completed",
    title: "Product Scan complete",
  }),
];

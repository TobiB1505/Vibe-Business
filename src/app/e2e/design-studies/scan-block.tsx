"use client";

import { ProductScanRevealFixture } from "../product-scan-reveal-fixture";
import type { OperationView } from "@/modules/operations/view";
import type { ProductScanPresentation } from "@/modules/product-scan/presentation";
import type { ProductScanEvent } from "@/modules/product-scan/schema";

/**
 * The Product Scan, inside a render block.
 *
 * ## Why there is almost nothing here
 *
 * That is the finding, not an omission. The scan is a shipped component with
 * its own animation, its own reveal sequence and its own reading of the event
 * stream, and the whole point of a render block is that it *shows* that rather
 * than reproducing it. A compressed copy would be a second scan UI to keep in
 * step with the first, and it would be out of step the first time anybody
 * touched either.
 *
 * So this file mounts the product's own reveal fixture with `variant="block"`
 * and nothing else. That fixture is what the scan route already renders from,
 * so the sequence a founder watches here is the sequence they watch there.
 * Change the scan and the thread changes with it — which is the property the
 * block exists for.
 *
 * ## What the variant drops, and why only those two things
 *
 * The panel frame, because the block already is one, and two frames around one
 * object is the tell that something was pasted rather than composed. And the
 * component's own buttons, because a thread carries its controls beside a
 * block rather than inside it — leaving them would put two buttons for the
 * same act on one screen.
 *
 * Nothing else is conditional. The data, the states, the reveal and the
 * failure copy are the shipped component's.
 */
export function ScanBlock({
  operation,
  events,
  presentation,
}: {
  operation: OperationView;
  events: readonly ProductScanEvent[];
  presentation: ProductScanPresentation;
}) {
  return (
    <ProductScanRevealFixture
      variant="block"
      operation={operation}
      events={events}
      presentation={presentation}
    />
  );
}

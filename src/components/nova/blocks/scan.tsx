import { ProductScanExperience } from "@/components/product-scan/product-scan-experience";
import type { OperationView } from "@/modules/operations/view";
import type { ProductScanPresentation } from "@/modules/product-scan/presentation";
import type { ProductScanEvent } from "@/modules/product-scan/schema";

/**
 * The Product Scan, inside a render block.
 *
 * ## Why there is almost nothing here
 *
 * That is the finding, not an omission. The scan is a shipped component with
 * its own reveal sequence and its own reading of the event stream, and the
 * whole point of a render block is that it *shows* that rather than
 * reproducing it. A compressed copy would be a second scan UI to keep in step
 * with the first, and it would be out of step the first time anybody touched
 * either.
 *
 * So this mounts `ProductScanExperience` with `variant="block"` and the same
 * props the product route passes it. Change the scan and the thread changes
 * with it — which is the property the block exists for.
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
  projectId,
  operation,
  events,
  presentation,
  productName,
  hasProfile,
  canStart,
}: {
  projectId: string;
  operation: OperationView | null;
  events: ProductScanEvent[];
  presentation: ProductScanPresentation | null;
  productName: string;
  hasProfile: boolean;
  canStart: boolean;
}) {
  return (
    <ProductScanExperience
      projectId={projectId}
      variant="block"
      initialOperation={operation}
      initialEvents={events}
      initialPresentation={presentation}
      productName={productName}
      hasProfile={hasProfile}
      canStart={canStart}
    />
  );
}

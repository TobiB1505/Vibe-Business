import { SkeletonBlock, SkeletonText } from "@/components/ui/skeleton";
import { VibeCard } from "@/components/ui/surface";

/**
 * Shown while Nova resolves its reads (UI-4 §1).
 *
 * ## Why this one renders no heading
 *
 * Every other route in the workspace shows its section heading immediately,
 * because the heading is static for that route and holding it back would let
 * the page change identity as it lands. Nova's heading is not static: it *is*
 * the focus — one sentence about what needs the founder now — and there is no
 * honest way to render it before the ranking has been read.
 *
 * So this reserves the geometry instead. The card, the strip and the stack
 * occupy the space they will occupy, and nothing a founder is reading moves
 * when the answer arrives.
 */
export default function Loading() {
  return (
    <div className="flex flex-col gap-8" aria-busy="true">
      <SkeletonBlock className="h-7 w-56" />

      <VibeCard padding="lg" className="flex flex-col gap-5">
        <SkeletonBlock className="h-6 w-32 rounded-full" />
        <SkeletonText lines={2} className="max-w-[28ch]" />
        <SkeletonBlock className="h-11 w-44" />
      </VibeCard>

      <SkeletonBlock className="h-40 w-full rounded-panel" />
    </div>
  );
}

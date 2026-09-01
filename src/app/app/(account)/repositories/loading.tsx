import { SkeletonBlock } from "@/components/ui/skeleton";
import { SectionHeader } from "@/components/ui/typography";

/**
 * Shown while the connected repositories resolve (PERF-015).
 *
 * A list, not a product grid — which is what this route used to borrow from
 * the dashboard. The connect action is deliberately absent rather than
 * skeletonised: an action-shaped placeholder invites a click that cannot
 * land yet.
 */
export default function Loading() {
  return (
    <div className="flex flex-col gap-8">
      <SectionHeader
        level={1}
        title="Repositories"
        description="Connect, review and manage the code behind your products."
      />
      <div role="status" aria-label="Loading your repositories" className="flex flex-col gap-4">
        <SkeletonBlock className="h-12 w-full" />
        <SkeletonBlock className="h-20 w-full" />
        <SkeletonBlock className="h-20 w-full" />
        <SkeletonBlock className="h-20 w-full" />
      </div>
    </div>
  );
}

import { WorkspaceSection } from "@/components/layout/project-shell";
import { SkeletonBlock, SkeletonText } from "@/components/ui/skeleton";

/**
 * Shown while this route resolves its reads (UI-4 §1).
 *
 * The section heading is repeated verbatim rather than skeletonised: it is
 * static for this route, so the page keeps its identity from the first frame.
 *
 * The body is two columns rather than the shared `SkeletonSection`, and that
 * is a deliberate exception to the rule that a skeleton should not imitate a
 * specific layout. What it reserves is not content but *geometry*: this route
 * is the one place where the side column carries the explanation of whatever
 * the founder selects, and a single-column placeholder would jump into two
 * the moment the reads land.
 */
export default function Loading() {
  return (
    <WorkspaceSection
      id="action-plan"
      title="Action Plan"
      description="Your prioritized plan to strengthen your business."
    >
      <div
        role="status"
        aria-label="Loading"
        className="grid gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(23rem,0.75fr)] xl:items-start"
      >
        <div className="flex flex-col gap-4">
          <SkeletonBlock className="h-12 w-full" />
          <SkeletonBlock className="h-52 w-full" />
          <SkeletonBlock className="h-52 w-full" />
        </div>
        <div className="flex flex-col gap-4">
          <SkeletonBlock className="h-24 w-full" />
          <SkeletonBlock className="h-64 w-full" />
          <SkeletonText lines={2} />
        </div>
      </div>
    </WorkspaceSection>
  );
}

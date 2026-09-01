import { WorkspaceSection } from "@/components/layout/project-shell";
import { SkeletonBlock, SkeletonText } from "@/components/ui/skeleton";

/**
 * Shown while this route resolves its reads (UI-4 §1).
 *
 * The section heading is rendered rather than skeletonised: it is static for
 * this route, so the page keeps its identity from the first frame. It comes
 * from `WORKSPACE_SECTION_HEADINGS`, so the skeleton and the page it stands in
 * for cannot word it differently.
 *
 * The blocks reserve the priority track, one active Move and its detail in the
 * same centered stack the loaded route uses. No placeholder suggests the
 * retired right sidebar or simultaneous Move cards.
 */
export default function Loading() {
  return (
    <WorkspaceSection id="action-plan">
      <div role="status" aria-label="Loading" className="mx-auto flex w-full max-w-6xl flex-col gap-5">
        <SkeletonBlock className="h-12 w-full" />
        <SkeletonBlock className="h-24 w-full" />
        <SkeletonBlock className="h-72 w-full" />
        <SkeletonBlock className="h-96 w-full" />
        <SkeletonText lines={2} />
      </div>
    </WorkspaceSection>
  );
}

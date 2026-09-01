import { WorkspaceSection } from "@/components/layout/project-shell";
import { SkeletonSection } from "@/components/ui/skeleton";

/**
 * Shown while this route resolves its reads (UI-4 §1).
 *
 * The section heading is rendered rather than skeletonised: it is static for
 * this route, so showing it immediately means the page keeps its identity from
 * the first frame and nothing moves when the content lands. It comes from
 * `WORKSPACE_SECTION_HEADINGS`, the same place the route takes it from, so the
 * skeleton and the page it stands in for cannot word it differently.
 * Only the body — the part that genuinely depends on a read — is a placeholder.
 */
export default function Loading() {
  return (
    <WorkspaceSection id="my-product">
      <SkeletonSection />
    </WorkspaceSection>
  );
}

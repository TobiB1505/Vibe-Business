import { WorkspaceSection } from "@/components/layout/project-shell";
import { SkeletonSection } from "@/components/ui/skeleton";

/**
 * Shown while this route resolves its reads (UI-4 §1).
 *
 * The section heading is repeated here verbatim rather than skeletonised: it
 * is static for this route, so rendering it immediately means the page keeps
 * its identity from the first frame and nothing moves when the content lands.
 * Only the body — the part that genuinely depends on a read — is a placeholder.
 */
export default function Loading() {
  return (
    <WorkspaceSection
      id="business-audit"
      title="Business Health"
      description="Your whole business in one connected view — what is working, what matters and where to move next."
    >
      <SkeletonSection />
    </WorkspaceSection>
  );
}

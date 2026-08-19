import { WorkspaceSection } from "@/components/layout/project-shell";
import { SkeletonSection } from "@/components/ui/skeleton";

/**
 * Shown while this route resolves its reads (UI-4 §1).
 *
 * The section heading is repeated here verbatim rather than skeletonised: it
 * is static for this route, so rendering it immediately means the page keeps
 * its identity from the first frame and nothing moves when the content lands.
 * Only the body — the part that genuinely depends on a read — is a placeholder.
 *
 * The one heading in the workspace that is not static: the real section calls
 * itself "Opportunities" until a set exists, and the count that decides this
 * is the read we are waiting on. "Next moves" is the answer for every project
 * that has ever run the engine, so it is the one that moves least often.
 */
export default function Loading() {
  return (
    <WorkspaceSection
      id="next-moves"
      title="Next moves"
      description="The few things worth doing next, in the order Vibe would do them."
    >
      <SkeletonSection />
    </WorkspaceSection>
  );
}

import { WorkspaceSection } from "@/components/layout/project-shell";
import { EmptyState } from "@/components/ui/states";
import { getPreparedChangeWorkspace } from "@/modules/execution/workspace";
import { requireProjectAccess } from "@/modules/projects/workspace-context";
import { PreparedChangesSection, type PreparedChangeCard } from "../prepared-changes-section";

/**
 * Prepared changes (Sprint UI-2 Part 2).
 *
 * ## The expensive route, and the only one that should be
 *
 * This is where the prepared-change workspace read model is called, and it is
 * the reason UI-2 Part 1 extracted it. Per change it reads validation, preview,
 * review, approval, outcome and business impact; for an approved change it
 * additionally spends up to four read-only GitHub calls; for a ready review it
 * signs image URLs; for a running preview it asks the sandbox provider for an
 * origin.
 *
 * That cost is legitimate *here*, because this is the screen that shows all of
 * it. Before the split, every other section paid it too.
 *
 * ## Gates
 *
 * The order — validation → preview → review → human approval → safe merge →
 * outcome — is decided by the services behind the read model and rendered by
 * `PreparedChangesSection`. Nothing on this route re-decides it, and no gate
 * can be skipped by arriving at this URL directly: the state comes from
 * persisted rows, not from navigation.
 */
export default async function ProjectPreparedPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const { supabase, userId, project } = await requireProjectAccess(projectId);

  const changes: PreparedChangeCard[] = await getPreparedChangeWorkspace(supabase, {
    projectId,
    userId,
    repositoryFullName: project.repository?.fullName ?? null,
  });

  return (
    <WorkspaceSection
      id="prepared"
      title="Prepared"
      description="Each change moves through validation, preview, review and your approval before anything can be merged."
    >
      {changes.length > 0 ? (
        <PreparedChangesSection projectId={project.id} changes={changes} />
      ) : (
        <EmptyState
          title="Nothing prepared yet"
          description="When you let Vibe act on one of your next moves, the prepared change appears here with its validation, preview, review and approval state."
        />
      )}
    </WorkspaceSection>
  );
}

import { WorkspaceSection } from "@/components/layout/project-shell";
import { listAuditEventsForProject } from "@/modules/audit-log/queries";
import { buildActivityFeed } from "@/modules/audit-log/view";
import { requireProjectAccess } from "@/modules/projects/workspace-context";
import { ActivityFeed } from "../../activity-feed";

/**
 * Activity (Sprint UI-2 Part 2).
 *
 * The cheapest route in the workspace: the access gate plus one bounded,
 * ordered audit-log read. No AI, no GitHub, no sandbox, no signed URL.
 *
 * Before the split this section lived on a page that ran the business audit
 * lookup, the opportunity engine's readiness check and the entire prepared
 * assembly before it could show a single line of history.
 */
export default async function ProjectActivityPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const { supabase, userId } = await requireProjectAccess(projectId);

  const activity = await listAuditEventsForProject(supabase, { projectId, userId });

  return (
    <WorkspaceSection
      id="activity"
      title="Activity"
      description="The append-only record of what Vibe did, when, and with what result."
    >
      <ActivityFeed entries={buildActivityFeed(activity.events)} hasMore={activity.hasMore} />
    </WorkspaceSection>
  );
}

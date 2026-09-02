import { WorkspaceSection, projectSectionHref } from "@/components/layout/project-shell";
import { EmptyState } from "@/components/ui/states";
import { getProjectImpact } from "@/modules/business-measurement/project-impact";
import { requireProjectAccess } from "@/modules/projects/workspace-context";
import { ExperimentCard } from "../experiment-card";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Experiments",
  description: "Every change Vibe shipped, and what happened after.",
};

/**
 * Experiments (Sprint UI-2 Part 2 as Impact; reframed by CORE-5).
 *
 * ## What the word means here
 *
 * Every change Vibe merged, and what became true afterwards. That is what a
 * founder means when they ask what an experiment did — did we ship it, and did
 * anything move.
 *
 * It is **not** what a statistician means, and the difference is stated on
 * every card rather than assumed. This product runs no controlled experiments:
 * no design, no control group, no randomisation. `business-measurement/
 * causality.ts` says so in code and exists to make adding one a deliberate act,
 * and nothing here changes that. Vibe never claims a change caused a result.
 *
 * ## Cost
 *
 * `getProjectImpact` and nothing else — merge state, outcome and measurement.
 * No preview, no review images, no validation detail, none of the prepared
 * workspace. That separation is what UI-2 Part 1's Phase C existed to create;
 * before it, this page was a by-product of rendering every prepared change in
 * full.
 *
 * ## Why there is no `<Suspense>` boundary here
 *
 * Because there is nothing left to stream around. The audit asked for one on
 * the grounds that this route "blocks all HTML on GitHub network calls" — and
 * it no longer makes any: the merge preflight it was spending them on answered
 * a question about approved changes, and this page lists merged ones. What
 * remains is a handful of database reads with nothing above them that does not
 * depend on the result, and `loading.tsx` is already the boundary for that.
 *
 * A boundary added anyway would move the same wait behind a spinner and call
 * it progress.
 */
export default async function ProjectExperimentsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const { supabase, userId, project } = await requireProjectAccess(projectId);

  const impact = await getProjectImpact(supabase, {
    projectId,
    userId,
    repositoryConnected: project.repository !== null,
  });

  const preparedHref = projectSectionHref(project.id, "agent");

  return (
    <WorkspaceSection id="experiments">
      {impact.entries.length > 0 ? (
        <div className="flex flex-col gap-4">
          <ul className="flex flex-col gap-4">
            {impact.entries.map((entry) => (
              <li key={entry.preparedChangeId}>
                <ExperimentCard entry={entry} agentHref={preparedHref} />
              </li>
            ))}
          </ul>

          {/* Deliberately a pointer rather than a copy: outcome verification and
              business measurement are rendered in full on each prepared change,
              and duplicating those panels here would mean two places claiming
              the same result. */}
          <p className="text-fg-muted text-sm">
            The full production outcome and business measurement are shown on each change, beside
            the merge that produced them.
          </p>

          {impact.unmergedCount > 0 && (
            <p className="text-fg-meta text-xs">
              {impact.unmergedCount} prepared{" "}
              {impact.unmergedCount === 1 ? "change has" : "changes have"} not merged, so{" "}
              {impact.unmergedCount === 1 ? "it has" : "they have"} no outcome to measure.
            </p>
          )}
        </div>
      ) : (
        <EmptyState
          title="Nothing merged yet"
          description="Vibe can only measure a change once it has been approved and merged. Until then there is nothing to compare against, and Vibe will not estimate one."
        />
      )}
    </WorkspaceSection>
  );
}

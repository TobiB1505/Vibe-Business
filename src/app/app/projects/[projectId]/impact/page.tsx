import Link from "next/link";
import { WorkspaceSection, projectSectionHref } from "@/components/layout/project-shell";
import { Metric } from "@/components/ui/metric";
import { EmptyState } from "@/components/ui/states";
import { Surface } from "@/components/ui/surface";
import { MonoLabel } from "@/components/ui/typography";
import { formatTimestamp } from "@/lib/utils/format-datetime";
import { getProjectImpact } from "@/modules/business-measurement/project-impact";
import type { OutcomeCardState } from "@/modules/outcome-verification/view";
import { requireProjectAccess } from "@/modules/projects/workspace-context";

/**
 * Impact (Sprint UI-2 Part 2).
 *
 * Reads `getProjectImpact` and nothing else — merge state, outcome and
 * measurement. No preview, no review images, no validation detail, none of the
 * prepared workspace. That separation is what UI-2 Part 1's Phase C existed to
 * create; before it, Impact was a by-product of rendering every prepared change
 * in full.
 */

/**
 * Outcome states as one short phrase each.
 *
 * Deliberately the same words the Outcome panel already uses, rather than new
 * ones: two places describing one state differently is how a product starts
 * disagreeing with itself. In particular `failed` stays a statement about
 * *Vibe* — it never says the customer's product failed.
 */
const OUTCOME_LABELS: Record<OutcomeCardState, string> = {
  unavailable: "Not applicable",
  not_started: "Not yet verified in production",
  observing: "Checking production…",
  verified: "Production outcome verified",
  partial: "Partly observed",
  not_observed: "Not observed within verification window",
  failed: "Vibe could not check",
};

export default async function ProjectImpactPage({
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

  const preparedHref = projectSectionHref(project.id, "prepared");

  return (
    <WorkspaceSection
      id="impact"
      title="Impact"
      description="What actually changed after a merge — and what Vibe refuses to claim it caused."
    >
      {impact.entries.length > 0 ? (
        <div className="flex flex-col gap-4">
          <Surface level="section" padding="lg" className="flex flex-col gap-4">
            <MonoLabel>Merged changes</MonoLabel>
            <ul className="flex flex-col gap-3">
              {impact.entries.map((entry) => (
                <li
                  key={entry.preparedChangeId}
                  className="border-line-1 flex flex-wrap items-center gap-x-6 gap-y-2 border-b pb-3 last:border-b-0 last:pb-0"
                >
                  {/* `Metric` renders an em dash for an absent value, so a
                      change without a recorded commit stays honest rather than
                      showing a truncated empty string. */}
                  <Metric label="Commit" value={entry.commitSha?.slice(0, 7)} mono />
                  <Metric label="Branch" value={entry.baseBranch} mono />
                  <Metric label="Merged" value={formatTimestamp(entry.mergedAt)} mono />
                  <Metric
                    label="Production outcome"
                    value={OUTCOME_LABELS[entry.outcome.state]}
                  />
                  <Link
                    href={preparedHref}
                    className="text-fg-prose hover:text-fg ml-auto rounded-sm text-sm underline underline-offset-4 transition-colors"
                  >
                    See its outcome
                  </Link>
                </li>
              ))}
            </ul>
          </Surface>

          {/* Deliberately a pointer rather than a copy: outcome verification and
              business measurement are rendered per prepared change, and
              duplicating those panels here would mean two places claiming the
              same result. */}
          <p className="text-fg-muted text-sm">
            Production outcome and business impact are shown on each prepared change, beside the
            merge that produced them.
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
          description="Impact can only be measured after a change of Vibe's has been approved and merged. Until then there is nothing to compare against, and Vibe will not estimate one."
        />
      )}
    </WorkspaceSection>
  );
}

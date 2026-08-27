import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getBusinessImpactCard } from "@/modules/business-measurement/service";
import { NoConnectedMetricSources } from "@/modules/business-measurement/source";
import type { BusinessImpactCard } from "@/modules/business-measurement/view";
import { listPreparedChangesForProject } from "@/modules/execution/store";
import { createGithubMergePort } from "@/modules/merge/github/adapter";
import { getMergeCard, resolveMergeTarget } from "@/modules/merge/service";
import { mergeFailureMessage } from "@/modules/merge/messages";
import { buildMergeCard } from "@/modules/merge/view";
import { getOutcomeCard } from "@/modules/outcome-verification/service";
import type { OutcomeCard } from "@/modules/outcome-verification/view";

/**
 * Project-level impact (Sprint UI-2 Phase C).
 *
 * ## Why this exists
 *
 * Impact had no read model of its own. Outcome verification and business
 * measurement were loaded *inside* the prepared-change assembly, which meant
 * the only way to ask "what has changed for this business" was to build every
 * prepared change's full card first — including the review images, the preview
 * origin and the GitHub merge preflight, none of which impact needs.
 *
 * UI-1 recorded that as Impact's route-split risk being High "because it has no
 * data of its own today". This gives it some.
 *
 * ## What it deliberately does not do
 *
 * - **It invents no metric.** There is still no connected metric source
 *   (`NoConnectedMetricSources`), so `businessImpact` will say `source_required`
 *   for every project. That is the honest answer and it is the same one the
 *   per-change card gives; this does not paper over it with an estimate.
 * - **It aggregates nothing across changes.** No project-wide totals, no
 *   averages, no "overall impact" number. Nothing in the data model supports
 *   one, and a summed delta across unrelated metrics would be a fabrication.
 * - **It never contacts anything.** No analytics vendor, no production website,
 *   no model. Every read below is a database read.
 *
 * ## The one external call, and why it is bounded
 *
 * Merge state is what decides whether a change *has* an outcome at all, and the
 * merge card may spend read-only GitHub calls — but only for an approved
 * change. Impact only ever asks about changes that already merged, so in
 * practice the preflight is answered from the stored merge row. The call is
 * kept because "was this actually merged" is exactly the question Impact must
 * not guess at.
 */

export type ProjectImpactEntry = {
  preparedChangeId: string;
  branchName: string;
  /** The commit that landed on the default branch. */
  commitSha: string | null;
  baseBranch: string;
  mergedAt: string | null;
  /** What the product did after the merge — never what the business did. */
  outcome: OutcomeCard;
  /** What the business did, when a metric source can say. Usually cannot. */
  businessImpact: BusinessImpactCard;
};

export type ProjectImpact = {
  entries: ProjectImpactEntry[];
  /** Prepared changes that exist but have not merged, so cannot have an outcome. */
  unmergedCount: number;
};

export async function getProjectImpact(
  supabase: SupabaseClient,
  params: { projectId: string; userId: string; repositoryConnected: boolean },
): Promise<ProjectImpact> {
  const { projectId, userId } = params;

  const mergeTarget = params.repositoryConnected
    ? await resolveMergeTarget(supabase, projectId)
    : null;

  const prepared = await listPreparedChangesForProject(supabase, projectId);

  // VB-024. This walked the prepared changes one at a time, and each step can
  // reach GitHub through `getMergeCard` — so a project with ten changes paid
  // ten sequential round trips before the page could render.
  //
  // Bounded rather than a plain `Promise.all(prepared.map(...))`: the merge
  // card is a GitHub call, and firing one per prepared change at once is how a
  // busy project trips a secondary rate limit. Six is well above the render
  // times that matter and well below anything GitHub objects to.
  const settled = await mapWithConcurrency(prepared, 6, async (change) => {
    const merge = mergeTarget
      ? await getMergeCard(supabase, createGithubMergePort(mergeTarget), {
          projectId,
          userId,
          preparedChangeId: change.id,
        })
      : buildMergeCard({
          latestMerge: null,
          eligibility: { outcome: "blocked", reason: "merge_repository_unavailable" },
          changeApprovalId: null,
          resolveFailureMessage: mergeFailureMessage,
        });

    // Only a merged change can have an outcome. Reading outcome and impact for
    // an unmerged one would spend six database reads to be told "unavailable" —
    // which is precisely the waste this read model exists to stop.
    if (merge.state !== "merged") return null;

    const [outcome, businessImpact] = await Promise.all([
      getOutcomeCard(supabase, { projectId, preparedChangeId: change.id }),
      getBusinessImpactCard(supabase, new NoConnectedMetricSources(), {
        projectId,
        preparedChangeId: change.id,
      }),
    ]);

    return {
      preparedChangeId: change.id,
      branchName: change.branchName,
      commitSha: change.commitSha,
      baseBranch: change.baseBranch,
      mergedAt: merge.mergedAt ?? null,
      outcome,
      businessImpact,
    } satisfies ProjectImpactEntry;
  });

  // Order follows `prepared`, not completion order: the list is what the
  // founder reads, and a card moving because a GitHub call was slow would be a
  // different defect than the one being fixed.
  const entries = settled.filter((entry): entry is ProjectImpactEntry => entry !== null);
  const unmergedCount = settled.length - entries.length;

  return { entries, unmergedCount };
}

/**
 * `Promise.all` with a ceiling on how many run at once.
 *
 * Results come back in input order regardless of completion order, which is
 * what lets the caller treat this as a drop-in for a sequential loop.
 */
async function mapWithConcurrency<In, Out>(
  items: readonly In[],
  limit: number,
  run: (item: In) => Promise<Out>,
): Promise<Out[]> {
  const results = new Array<Out>(items.length);
  let next = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await run(items[index]);
    }
  });

  await Promise.all(workers);
  return results;
}

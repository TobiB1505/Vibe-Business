import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getBusinessImpactCards } from "@/modules/business-measurement/service";
import { NoConnectedMetricSources } from "@/modules/business-measurement/source";
import type { BusinessImpactCard } from "@/modules/business-measurement/view";
import { listPreparedChangesForProject } from "@/modules/execution/store";
import { getLatestMergesForPreparedChanges } from "@/modules/merge/store";
import { getOutcomeCards } from "@/modules/outcome-verification/service";
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
 * ## It reaches nothing outside the database
 *
 * Until VB-023 this built a full merge *card* per prepared change, and a merge
 * card spends up to four read-only GitHub calls to say whether an approved
 * branch is still where its approval expects it. That question belongs on the
 * Agent screen. Here it was being asked about changes that had **already
 * merged** — which are past that preflight — so the round trip bought a fact
 * `change_merges.status` already states. The audit named this route as one of
 * two "blocking all HTML on GitHub network calls" (B15); it makes none.
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
  const { projectId } = params;

  const prepared = await listPreparedChangesForProject(supabase, projectId);
  const preparedChangeIds = prepared.map((change) => change.id);

  /*
   * Which changes merged, from the merge table — with no GitHub call at all.
   *
   * This used to build the full **merge card** for every prepared change, and
   * a merge card spends up to four read-only GitHub calls per approved change
   * so it can tell a user whether the branch is still where their approval
   * expects it. That is exactly the right answer on the Agent screen, and it is
   * worthless here: this page shows changes that *already merged*, and a
   * merged change is past the preflight it was asking about.
   *
   * So the whole third-party round trip was being spent to learn a fact one
   * column already states. The audit named this route as one of the two
   * "blocking all HTML on GitHub network calls" (B15); it no longer makes one.
   */
  const merges = await getLatestMergesForPreparedChanges(supabase, {
    projectId,
    preparedChangeIds,
  });

  const mergedChanges = prepared.filter((change) => merges.get(change.id)?.status === "merged");

  /*
   * Outcome and business impact for the merged ones, batched (VB-023).
   *
   * Only a merged change can have an outcome. Reading outcome and impact for an
   * unmerged one would spend six database reads to be told "unavailable" —
   * which is precisely the waste this read model exists to stop.
   */
  const [outcomes, impacts] = await Promise.all([
    getOutcomeCards(supabase, {
      projectId,
      changes: mergedChanges.map((change) => ({
        preparedChangeId: change.id,
        merge: merges.get(change.id) ?? null,
        prepared: change,
      })),
    }),
    getBusinessImpactCards(supabase, new NoConnectedMetricSources(), {
      projectId,
      changes: mergedChanges.map((change) => ({
        preparedChangeId: change.id,
        merge: merges.get(change.id) ?? null,
        prepared: change,
      })),
    }),
  ]);

  // Order follows `prepared`, not completion order: the list is what the
  // founder reads, and a card moving because one read was slow would be a
  // different defect than the one being fixed.
  const entries = mergedChanges.flatMap((change) => {
    const outcome = outcomes.get(change.id);
    const businessImpact = impacts.get(change.id);
    if (!outcome || !businessImpact) return [];

    return [
      {
        preparedChangeId: change.id,
        branchName: change.branchName,
        commitSha: change.commitSha,
        baseBranch: change.baseBranch,
        mergedAt: merges.get(change.id)?.mergedAt ?? null,
        outcome,
        businessImpact,
      } satisfies ProjectImpactEntry,
    ];
  });

  return { entries, unmergedCount: prepared.length - entries.length };
}


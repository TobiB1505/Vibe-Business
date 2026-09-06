import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createGithubRepositoryReader } from "@/modules/github/repository-reader";
import { getProjectWithRepository } from "@/modules/projects/queries";
import { classifyReviewForPreparedChange, type FileTextReader } from "./classification-inputs";
import type { ReviewClassificationResult } from "./classification";

/**
 * The classification for one change, reader and all (Sprint 0055 §2).
 *
 * ## Why this is separate from `classification-inputs.ts`
 *
 * Because that module takes a *port* and this one resolves a GitHub client.
 * Keeping the two apart is what lets the classifier be unit-tested with a
 * three-line double and keeps a vendor out of the layer that decides — the same
 * split every other domain here holds to.
 *
 * ## When to use the other one instead
 *
 * Whenever more than one change is being classified. This resolves the project,
 * its repository connection and the analyzer's route table *per call*, which is
 * exactly the per-card cost `execution/workspace.ts` batches away. Reach for
 * this only where there is genuinely one change: a server action acting on a
 * click, or a single-run status view.
 */
export async function resolveReviewClassification(
  supabase: SupabaseClient,
  params: { projectId: string; preparedChangeId: string },
): Promise<ReviewClassificationResult | null> {
  return classifyReviewForPreparedChange({
    supabase,
    projectId: params.projectId,
    preparedChangeId: params.preparedChangeId,
    reader: await repositoryReaderFor(supabase, params.projectId),
  });
}

/**
 * Read-only repository access for the render-impact probe, or null.
 *
 * Null whenever the project has no connected repository — and null on any
 * failure, because a probe that cannot run leaves the path-based answer
 * standing, which is the more thorough review rather than a degraded one.
 */
async function repositoryReaderFor(
  supabase: SupabaseClient,
  projectId: string,
): Promise<FileTextReader | null> {
  try {
    const project = await getProjectWithRepository(supabase, projectId);
    if (!project?.repository) return null;

    return createGithubRepositoryReader(
      project.repository.installationId,
      project.repository.owner,
      project.repository.name,
    );
  } catch {
    return null;
  }
}

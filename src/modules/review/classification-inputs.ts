import type { SupabaseClient } from "@supabase/supabase-js";
import { findAgentRunByOperation } from "@/modules/coding-agent/store";
import { usablePath } from "@/modules/execution-context/compiler";
import { loadPlanStep } from "@/modules/execution-context/service";
import {
  deriveExecutionSurfaceRequirement,
  resolveExecutionSurface,
  type ExecutionSurfaceRequirement,
  type ResolvedExecutionSurface,
} from "@/modules/execution-context/surface";
import { findExecutionSpecByIdentity } from "@/modules/execution-contract/store";
import { getPreparedChange } from "@/modules/execution/store";
import { getLatestSuccessfulSnapshot } from "@/modules/repository-intelligence/store";
import { classifyReview, type ReviewClassificationResult } from "./classification";
import { resolveValidationProfile } from "@/modules/validation/profile";
import { isRenderImpactCandidate } from "./route-segment";

/**
 * Gathering what the review classifier needs (Sprint 0048).
 *
 * The same shape and the same discipline as `validation/depth-inputs.ts`, and
 * deliberately so: one function that assembles trusted inputs, every lookup
 * allowed to fail, and a degradation that is documented rather than incidental.
 *
 * ## What degrades, and to what
 *
 * - No repository snapshot, or one whose route analysis came back `limited` or
 *   `none` → `surface` is null. The classifier still answers from the
 *   structural test; it just cannot name the routes a change touches.
 * - No agent run, no spec, or no plan step → no evidence-derived scopes. The
 *   classification is unaffected: scopes are carried for the explanation, never
 *   consulted for the decision.
 * - No prepared change → null, and the caller shows nothing. A recommendation
 *   about a change that does not exist is worse than silence.
 *
 * The one input that never degrades is the changed-path list, which comes off
 * the prepared change Vibe itself verified — and that is the input the decision
 * actually rests on.
 *
 * ## The render-impact probe, and why it may read file content at all
 *
 * A fourth lookup was added for the defect production run `5ea8a9a0` exposed: a
 * metadata-only edit to two layouts was recommended for a *visual* review,
 * which would have photographed the same page twice. Deciding that from paths
 * alone is impossible, so this reads the two versions of a small number of
 * candidate files and hands `classifyReview` a list of paths a structural proof
 * cleared.
 *
 * Three properties make that permissible:
 *
 * - **Rule 26.** Nothing is persisted. The text arrives in a local variable, is
 *   reduced to a boolean by a pure function, and goes out of scope. It must
 *   never reach a log line, an error message or a breadcrumb either — only
 *   paths and verdict reasons may be recorded.
 * - **Rule 57.** `analyzeRenderImpact` reads syntax, never meaning. An agent
 *   cannot write a comment, a string or a commit message that buys its own
 *   change a cheaper review.
 * - **Read-only by type.** The port below has one method and no way to write,
 *   so "a classification can never modify a repository" is a property of the
 *   signature rather than a claim about the code.
 */

/**
 * The one method the probe needs.
 *
 * Declared narrowly rather than importing `RepositoryReader` so the real reader
 * satisfies it structurally with no adapter, and a test double is three lines.
 */
export type FileTextReader = {
  getTextFile(path: string, commitSha: string, maxBytes: number): Promise<string | null>;
};

export type ReviewClassificationInput = {
  supabase: SupabaseClient;
  projectId: string;
  preparedChangeId: string;
  /**
   * Read-only repository access, when the project has a connected repository.
   *
   * Absent or null degrades to the path-based answer — which is the safe one,
   * and the one this function returned before the probe existed.
   */
  reader?: FileTextReader | null;
  /**
   * The analyzer's route table, when a caller has already resolved it.
   *
   * A list of prepared changes shares one repository and therefore one route
   * table, and loading it per change is the same snapshot read repeated. Absent
   * means "resolve it here", which is what a single-change caller wants; `null`
   * means "there is none", and is passed through rather than re-looked-up.
   *
   * It changes nothing about the decision — only where the bytes came from.
   */
  surface?: ResolvedExecutionSurface | null;
  /**
   * The prepared change, when a caller already holds it.
   *
   * A list render reads every prepared change once for the whole list, and
   * re-reading one here per card was the first of the per-change costs this
   * classification added. Supplying it changes nothing about the decision —
   * only where the row came from.
   */
  prepared?: PreparedChangeInputs;
  /**
   * The evidence-derived scopes, or `null` for "do not look them up".
   *
   * Absent means resolve them, which walks agent run → execution spec → stored
   * spec → plan step: four reads, for a value that is **carried for the
   * explanation and never consulted for the decision**. A caller that does not
   * display scopes should pass `null` rather than buy them, and a list render
   * is exactly that caller.
   */
  requirement?: ExecutionSurfaceRequirement | null;
  /**
   * Where the application lives, or absent to resolve it.
   *
   * A project-level fact, so a caller rendering many cards can resolve it once
   * — though `getLatestSuccessfulSnapshot` is request-cached, which makes the
   * lookup free either way.
   */
  workspaceRoot?: string;
};

/** The two fields of a prepared change this needs, and nothing more. */
export type PreparedChangeInputs = {
  baseSha: string;
  commitSha: string | null;
  files: readonly { path: string }[];
  operationRunId: string;
};

export async function classifyReviewForPreparedChange(
  input: ReviewClassificationInput,
): Promise<ReviewClassificationResult | null> {
  const prepared =
    input.prepared ??
    (await getPreparedChange(input.supabase, {
      projectId: input.projectId,
      preparedChangeId: input.preparedChangeId,
    }));
  if (!prepared) return null;

  const [surface, requirement, workspaceRoot] = await Promise.all([
    input.surface !== undefined ? Promise.resolve(input.surface) : loadSurface(input),
    input.requirement !== undefined
      ? Promise.resolve(input.requirement)
      : loadRequirement(input, prepared.operationRunId),
    input.workspaceRoot !== undefined
      ? Promise.resolve(input.workspaceRoot)
      : loadWorkspaceRoot(input),
  ]);

  const changedPaths = prepared.files.map((file) => file.path);
  const first = classifyReview({ changedPaths, surface, requirement, workspaceRoot });

  /*
   * Two passes over a pure function, rather than threading the proof into the
   * first one. It costs nothing over at most ten paths, and it makes the
   * invariant visible right here: the probe is only ever asked about paths the
   * path rule *already* called visual, so the second answer can only be a
   * subset of the first.
   */
  const provenNonRendering = await loadProvenNonRendering(
    input,
    prepared,
    first.visualPaths,
    workspaceRoot,
  );
  if (provenNonRendering.length === 0) return first;

  return classifyReview({ changedPaths, surface, requirement, workspaceRoot, provenNonRendering });
}

/**
 * Paths whose change provably cannot alter rendered output.
 *
 * Empty whenever anything is missing or goes wrong — no repository, no commit
 * to compare against, a failed read, a file that will not parse. Every one of
 * those leaves the path-based answer standing, which is the more thorough
 * review.
 */
async function loadProvenNonRendering(
  input: ReviewClassificationInput,
  prepared: { baseSha: string; commitSha: string | null },
  visualPaths: readonly string[],
  workspaceRoot: string,
): Promise<readonly string[]> {
  if (!input.reader || prepared.commitSha === null) return [];

  /*
   * The path guard runs before any network call, so an ordinary change — a
   * component, a stylesheet, a route handler — costs nothing at all. `typescript`
   * is ~9 MB, so the module that imports it is reached by dynamic import and
   * only once there is something for it to do. `next.config.ts` records what
   * eagerly loading a large package on a rendered page cost this product once
   * already.
   */
  const candidates = visualPaths.filter((path) => isRenderImpactCandidate(path, workspaceRoot));
  if (candidates.length === 0) return [];

  try {
    const { analyzeRenderImpact, RENDER_IMPACT_LIMITS } = await import("./render-impact");
    const reader = input.reader;
    const commitSha = prepared.commitSha;

    // `visualPaths` is already sorted, so the cap keeps a deterministic subset.
    const inspected = candidates.slice(0, RENDER_IMPACT_LIMITS.maxFilesInspected);

    const verdicts = await Promise.all(
      inspected.map(async (path) => {
        const [baseText, headText] = await Promise.all([
          reader.getTextFile(path, prepared.baseSha, RENDER_IMPACT_LIMITS.maxBytesPerFile),
          reader.getTextFile(path, commitSha, RENDER_IMPACT_LIMITS.maxBytesPerFile),
        ]);

        return { path, verdict: analyzeRenderImpact({ path, baseText, headText }) };
      }),
    );

    return verdicts
      .filter(({ verdict }) => verdict.kind === "no_render_impact")
      .map(({ path }) => path);
  } catch {
    // A probe that cannot run proves nothing, and proving nothing is the
    // pre-existing behaviour rather than a failure worth surfacing.
    return [];
  }
}

/**
 * The analyzer's route table for this project, when one resolved.
 *
 * `live` is null on purpose. A live scan may only ever *corroborate* the split
 * between public and authenticated pages, and this classification does not
 * depend on which side a route falls on — both are visual. Loading a second
 * snapshot to refine a distinction nobody reads would be work for its own sake.
 */
/**
 * Where this project's application lives, for reading a changed path against.
 *
 * From the same snapshot and the same resolver validation uses, never a second
 * detection of the same facts. `getLatestSuccessfulSnapshot` is request-cached,
 * so a list rendering twenty cards pays for one read.
 *
 * `.` on any failure, which is what every change classified before a repository
 * could hold its application anywhere — the answer that changes nothing rather
 * than one that quietly reclassifies a screen.
 */
export async function loadWorkspaceRoot(input: {
  supabase: SupabaseClient;
  projectId: string;
}): Promise<string> {
  try {
    const snapshot = await getLatestSuccessfulSnapshot(input.supabase, input.projectId);
    if (!snapshot?.result) return ".";

    const resolution = resolveValidationProfile(snapshot.result);
    return resolution.supported ? resolution.workspaceRoot : ".";
  } catch {
    return ".";
  }
}

export async function loadSurface(input: {
  supabase: SupabaseClient;
  projectId: string;
}): Promise<ResolvedExecutionSurface | null> {
  try {
    const snapshot = await getLatestSuccessfulSnapshot(input.supabase, input.projectId);
    if (!snapshot?.result) return null;

    return resolveExecutionSurface({ snapshot: snapshot.result, live: null, usablePath });
  } catch {
    return null;
  }
}

/**
 * The evidence-derived surface scopes, reached through the run that prepared
 * this change.
 *
 * The same chain the depth resolver walks — agent run, spec identity, stored
 * spec, plan step — because it is the only path from a prepared change back to
 * the trusted Action Step, and having two would mean having two that can
 * disagree.
 */
async function loadRequirement(
  input: ReviewClassificationInput,
  operationRunId: string,
): Promise<ExecutionSurfaceRequirement | null> {
  try {
    const agentRun = await findAgentRunByOperation(input.supabase, operationRunId);
    if (!agentRun) return null;

    const { data } = await input.supabase
      .from("execution_specs")
      .select("spec_identity")
      .eq("id", agentRun.executionSpecId)
      .eq("project_id", input.projectId)
      .maybeSingle();

    const specIdentity = (data as { spec_identity: string } | null)?.spec_identity;
    if (!specIdentity) return null;

    const stored = await findExecutionSpecByIdentity(input.supabase, {
      projectId: input.projectId,
      specIdentity,
    });
    if (!stored) return null;

    const planStep = await loadPlanStep({
      supabase: input.supabase,
      projectId: input.projectId,
      spec: stored.spec,
    });
    if (!planStep) return null;

    return deriveExecutionSurfaceRequirement({
      evidenceIds: planStep.evidenceIds,
      changeKind: planStep.changeKind,
    });
  } catch {
    return null;
  }
}

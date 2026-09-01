import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { approvalBlockMessage } from "@/modules/approvals/messages";
import { getApprovalCard } from "@/modules/approvals/service";
import { getLatestApprovalsForPreparedChanges } from "@/modules/approvals/store";
import type { ChangeApproval } from "@/modules/approvals/schema";
import {
  getBusinessImpactCards,
  unmergedBusinessImpactCard,
  type BusinessImpactCard,
} from "@/modules/business-measurement/service";
import { NoConnectedMetricSources } from "@/modules/business-measurement/source";
import { getPreviewCard, getPreviewStatus } from "@/modules/change-preview/service";
import {
  getLatestPreviewsForPreparedChanges,
  validatedArtifactFrom,
} from "@/modules/change-preview/store";
import type { PreviewSession, ValidatedArtifact } from "@/modules/change-preview/schema";
import { businessRationaleFor } from "@/modules/execution/business-rationale";
import { changeOriginFrom } from "@/modules/execution/change-origin";
import { deriveChangeProgress } from "@/modules/execution/change-progress";
import { buildBranchUrl, buildCompareUrl } from "@/modules/execution/diff";
import { listPreparedChangesForProject } from "@/modules/execution/store";
import { createGithubMergePort } from "@/modules/merge/github/adapter";
import { getLatestMergesForPreparedChanges } from "@/modules/merge/store";
import type { ChangeMerge } from "@/modules/merge/schema";
import { mergeFailureMessage } from "@/modules/merge/messages";
import { resolveMergeTarget, getMergeCard } from "@/modules/merge/service";
import { buildMergeCard } from "@/modules/merge/view";
import { OPERATION_FAILURE_MESSAGES } from "@/modules/operations/messages";
import { VercelWorkflowExecutor } from "@/modules/operations/vercel/executor";
import { getOpportunityById } from "@/modules/opportunities/store";
import {
  getOutcomeCards,
  unavailableOutcomeCard,
} from "@/modules/outcome-verification/service";
import type { OutcomeCard } from "@/modules/outcome-verification/view";
import {
  classifyReviewForPreparedChange,
  loadSurface,
  type FileTextReader,
} from "@/modules/review/classification-inputs";
import type { ReviewClassificationResult } from "@/modules/review/classification";
import { createGithubRepositoryReader } from "@/modules/github/repository-reader";
import { getReviewCard, getReviewImages } from "@/modules/review/service";
import { getLatestReviewsForPreparedChanges } from "@/modules/review/store";
import type { ReviewArtifact } from "@/modules/review/schema";
import { SANDBOX_POLICY_VERSION } from "@/modules/validation/schema";
import {
  getLatestValidationsForPreparedChanges,
  type StoredValidationRun,
} from "@/modules/validation/store";
import { createVercelSandboxProvider } from "@/modules/validation/vercel/provider";
import { buildValidationSummary } from "@/modules/validation/view";
import { mapWithConcurrency, PER_CHANGE_CONCURRENCY } from "@/lib/async/concurrency";

/**
 * The prepared-change workspace read model (Sprint UI-2 Phase B).
 *
 * ## Why this was extracted
 *
 * This assembly used to live inline in `page.tsx`, where it stitched ten
 * services together per prepared change. UI-1 identified it as the single
 * biggest obstacle to splitting the workspace into routes, and the reason is
 * cost rather than tidiness: **every** section of the project screen paid for
 * **all** of it. Opening the Business score signed review-image URLs and asked
 * Vercel for preview origins; opening Activity ran the merge preflight.
 *
 * Moving it here does not make it cheaper on its own. What it makes possible is
 * *not calling it* — which is what `listPreparedChangeSummaries` below is for.
 *
 * ## What was preserved exactly
 *
 * Everything. The order of the reads, the arguments, the failure-message
 * resolvers, the conditions guarding the expensive calls, and every comment
 * explaining why a given read is safe. This is a move, not a rewrite: the gate
 * semantics (validation → preview → review → approval → merge → outcome) are
 * decided by these services, and nothing here re-decides them.
 *
 * ## Cost, stated plainly
 *
 * `getPreparedChangeWorkspace` is the expensive one, and the shape of the
 * expense changed in VB-023.
 *
 * The lifecycle rows — validation, preview, review, approval, merge, outcome —
 * are now read **once for the whole list**: six queries, whether the project
 * has one prepared change or twenty. What is left per change is the work that
 * is genuinely per change: for an *approved* change up to four read-only
 * GitHub calls (the merge preflight) and one approval-identity lookup; for a
 * *ready* review, signed image URLs; for a *running* preview, an origin from
 * the sandbox provider. None of it is billed and none of it writes — but it is
 * not free, and it should only run where a prepared change is actually shown.
 *
 * What that replaced, measured rather than estimated: thirteen reads per
 * change without a repository connected, eighteen with one. At the list cap of
 * twenty changes that was upwards of 360 round trips for a single render, most
 * of them re-fetching a row the render was already holding.
 */

/** The union of everything a prepared change's panels need. */
export type PreparedChangeWorkspaceItem = Awaited<
  ReturnType<typeof buildPreparedChangeCard>
>;

/**
 * The cheap read: what a list needs to say a change exists and roughly where
 * it stands, without touching GitHub, the sandbox provider or signed URLs.
 *
 * Deliberately *not* derived from the full card — deriving it would mean paying
 * for the full card first, which is the cost this exists to avoid.
 */
export type PreparedChangeSummary = {
  id: string;
  branchName: string;
  commitSha: string | null;
  baseBranch: string;
  filePaths: string[];
  createdAt: string;
  branchUrl: string | null;
  /** `null` when the change has never been validated — never a false "failed". */
  validationStatus: string | null;
};

export async function listPreparedChangeSummaries(
  supabase: SupabaseClient,
  params: { projectId: string; repositoryFullName: string | null },
): Promise<PreparedChangeSummary[]> {
  const prepared = await listPreparedChangesForProject(supabase, params.projectId);

  /*
   * One read for every change's validation, not one read per change (VB-023).
   *
   * This used to fan out — correctly parallel, and still a round trip per card
   * for a column the list only needs in order to print a word. `map` preserves
   * order, so the list is the same list it was.
   */
  const validations = await getLatestValidationsForPreparedChanges(supabase, {
    projectId: params.projectId,
    preparedChangeIds: prepared.map((change) => change.id),
  });

  return prepared.map((change) => {
      const validation = validations.get(change.id) ?? null;

      return {
        id: change.id,
        branchName: change.branchName,
        commitSha: change.commitSha,
        baseBranch: change.baseBranch,
        filePaths: change.files.map((file) => file.path),
        createdAt: change.createdAt,
        branchUrl: params.repositoryFullName
          ? buildBranchUrl(params.repositoryFullName, change.branchName)
          : null,
        validationStatus: validation?.status ?? null,
      };
  });
}

/**
 * Every lifecycle row one prepared change has, read for the whole list at once.
 *
 * This is the *only* thing VB-023 changed about how a card is assembled. The
 * gates are unchanged, the services that decide them are unchanged, and each
 * card still asks exactly the same questions — it just no longer asks the
 * database for a row the list already holds.
 *
 * Note what is deliberately **not** here: the standing approval for the current
 * artifact identity, and the live default-branch head. Both are authority
 * questions, both are still asked per change at the moment they are needed, and
 * neither may be answered from a row handed in (CLAUDE.md rules 55, 70).
 */
type ChangeLifecycle = {
  validation: StoredValidationRun | null;
  preview: PreviewSession | null;
  /** Derived from the validation row above — never a seventh query. */
  artifact: ValidatedArtifact | null;
  review: ReviewArtifact | null;
  approval: ChangeApproval | null;
  merge: ChangeMerge | null;
  /**
   * The two cards whose reads are a *chain* only their own module knows.
   *
   * Outcome needs the verification, the project's public origin and the
   * snapshot the change was prepared against; business impact needs the merge's
   * plan and that plan's measurements. Both are batched inside the module that
   * owns the chain rather than by this file, which would otherwise have to
   * restate it (VB-023).
   */
  outcome: OutcomeCard;
  businessImpact: BusinessImpactCard;
  /**
   * Which review this change deserves (ADR 0063).
   *
   * Recomputed on read like everything else about it — it is never stored on a
   * prepared change, only pinned onto an approval when one is made. Null
   * whenever it could not be determined, which every consumer reads as the
   * stricter answer.
   */
  reviewClassification: ReviewClassificationResult | null;
};

function emptyLifecycle(outcome: OutcomeCard, businessImpact: BusinessImpactCard): ChangeLifecycle {
  return {
    validation: null,
    preview: null,
    artifact: null,
    review: null,
    approval: null,
    merge: null,
    outcome,
    businessImpact,
    reviewClassification: null,
  };
}

async function readChangeLifecycles(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    prepared: readonly Awaited<ReturnType<typeof listPreparedChangesForProject>>[number][];
    /**
     * Read-only repository access, built once for the whole list.
     *
     * Null when no repository is connected, which degrades every classification
     * to its path-based answer — the stricter one.
     */
    reader: FileTextReader | null;
  },
): Promise<Map<string, ChangeLifecycle>> {
  const scope = {
    projectId: params.projectId,
    preparedChangeIds: params.prepared.map((change) => change.id),
  };

  const [validations, previews, reviews, approvals, merges, surface] = await Promise.all([
    getLatestValidationsForPreparedChanges(supabase, scope),
    getLatestPreviewsForPreparedChanges(supabase, scope),
    getLatestReviewsForPreparedChanges(supabase, scope),
    getLatestApprovalsForPreparedChanges(supabase, scope),
    getLatestMergesForPreparedChanges(supabase, scope),
    /*
     * The analyzer's route table, once for the list rather than once per card.
     *
     * Every prepared change in a project is a change to the same repository at
     * roughly the same commit, so they share one route table. Loading it inside
     * the classifier — which is what a single-change caller does — would be the
     * same snapshot read repeated for every card on the screen.
     */
    // Skipped entirely for an empty list, like every read beside it: a project
    // with no prepared changes must ask the database nothing at all.
    params.prepared.length > 0
      ? loadSurface({ supabase, projectId: params.projectId })
      : Promise.resolve(null),
  ]);

  /*
   * Which review each change deserves (ADR 0063).
   *
   * Bounded like every other per-change read on this page, and genuinely per
   * change: the changed paths differ, and the render-impact probe reads two
   * versions of any candidate page file from GitHub. That probe costs nothing
   * at all for an ordinary change — a component, a stylesheet, a route handler
   * — because its path guard runs before any network call.
   *
   * Every failure inside degrades to `null`, which reads as the stricter
   * answer everywhere it is consulted. A classification that could not be
   * determined never becomes permission to skip a review (rule 44).
   */
  const classifications = new Map<string, ReviewClassificationResult | null>(
    await mapWithConcurrency(params.prepared, PER_CHANGE_CONCURRENCY, async (change) => [
      change.id,
      await classifyReviewForPreparedChange({
        supabase,
        projectId: params.projectId,
        preparedChangeId: change.id,
        reader: params.reader,
        surface,
        // The row this list already read, and `null` for the evidence-derived
        // scopes. Together with the shared surface those are every database
        // read the classifier would otherwise make per card — and the scopes
        // are four of them for a value nothing on this screen displays.
        prepared: change,
        requirement: null,
      }),
    ]),
  );

  /*
   * The two cards whose reads are chains, each batched by the module that owns
   * its chain (VB-023).
   *
   * A merged change is the one that keeps costing: it stays `prepared`, so it
   * stays on this screen for the life of the project, and both of these stop
   * short-circuiting for it. On a project where nothing has merged yet — every
   * project, until it ships — neither spends more than its own one read.
   *
   * Neither contacts anything outside the database. Rendering a project page
   * must never reach an analytics vendor, must never create a measurement plan,
   * and must never start a measurement or an observation (Sprint 12A §43,
   * Sprint 12B §36, §45).
   */
  const cardInputs = params.prepared.map((change) => ({
    preparedChangeId: change.id,
    merge: merges.get(change.id) ?? null,
    prepared: change,
  }));

  const [outcomes, businessImpact] = await Promise.all([
    getOutcomeCards(supabase, { projectId: params.projectId, changes: cardInputs }),
    getBusinessImpactCards(supabase, new NoConnectedMetricSources(), {
      projectId: params.projectId,
      changes: cardInputs,
    }),
  ]);

  const lifecycles = new Map<string, ChangeLifecycle>();

  for (const change of params.prepared) {
    const id = change.id;
    const validation = validations.get(id) ?? null;

    lifecycles.set(id, {
      validation,
      preview: previews.get(id) ?? null,
      // The same rule `getValidatedArtifact` applies, applied to the row that
      // is already here. See `validatedArtifactFrom`.
      artifact: validation ? validatedArtifactFrom(validation) : null,
      review: reviews.get(id) ?? null,
      approval: approvals.get(id) ?? null,
      merge: merges.get(id) ?? null,
      outcome: outcomes.get(id) ?? unavailableOutcomeCard(),
      businessImpact: businessImpact.get(id) ?? unmergedBusinessImpactCard(),
      reviewClassification: classifications.get(id) ?? null,
    });
  }

  return lifecycles;
}

/**
 * The full card for one prepared change. Extracted verbatim from `page.tsx`;
 * the comments are the originals and explain why each read is safe to make on
 * a page load.
 */
async function buildPreparedChangeCard(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    userId: string;
    repositoryFullName: string | null;
    mergeTarget: Awaited<ReturnType<typeof resolveMergeTarget>> | null;
    prepared: Awaited<ReturnType<typeof listPreparedChangesForProject>>[number];
    lifecycle: ChangeLifecycle;
  },
) {
  const { projectId, userId, prepared, mergeTarget, lifecycle } = params;

  const validation = lifecycle.validation;

  /*
   * Three waves, not nine queued reads (UI-4 §4).
   *
   * Every comment below is the original one and still says why each read is
   * safe to make on a page load. What changed is only the order: reads that
   * never depended on each other no longer wait for each other, and the two
   * that genuinely do — a preview needs its validation, an origin needs its
   * preview — still do.
   *
   * VB-023: what each of these calls *reads* changed, not what it decides.
   * Every row scoped to this change was fetched for the whole list above and
   * is handed in; what remains is the approval-identity lookup and the GitHub
   * preflight, which are per change on purpose.
   */

  const prefetchedApproval = {
    prepared,
    validation: lifecycle.validation,
    review: lifecycle.review,
    approval: lifecycle.approval,
  };

  const [review, approval, merge, opportunity] = await Promise.all([
    // Review state, read from persisted rows. Like the preview card, this costs
    // no provider call: opening the page must never spend anything (§40).
    getReviewCard(supabase, {
      projectId,
      preparedChangeId: prepared.id,
      prefetched: { review: lifecycle.review },
      resolveFailureMessage: (code) =>
        OPERATION_FAILURE_MESSAGES[code as keyof typeof OPERATION_FAILURE_MESSAGES] ?? null,
    }),

    // Approval state. Read-only, like every other card on this page: opening a
    // project must never approve, revoke, validate, preview or capture anything.
    getApprovalCard(supabase, {
      projectId,
      userId,
      preparedChangeId: prepared.id,
      classification: lifecycle.reviewClassification,
      prefetched: prefetchedApproval,
      resolveBlockMessage: approvalBlockMessage,
    }),

    // Merge state (Sprint 11C §17). Unlike every other card on this page this
    // one may spend four read-only GitHub calls — but only for a change a human
    // has already approved, because for anything else a live read could not
    // tell the user something they can act on. Nothing billed, nothing written,
    // and the answer authorizes nothing: the durable workflow re-runs every
    // critical check immediately before it writes.
    mergeTarget
      ? getMergeCard(supabase, createGithubMergePort(mergeTarget), {
          projectId,
          // Only so an "approved but unmergeable" observation can be attributed
          // when one is recorded. Never used to decide anything.
          userId,
          preparedChangeId: prepared.id,
          prefetched: { ...prefetchedApproval, merge: lifecycle.merge },
        })
      : buildMergeCard({
          latestMerge: null,
          eligibility: { outcome: "blocked", reason: "merge_repository_unavailable" },
          changeApprovalId: null,
          resolveFailureMessage: mergeFailureMessage,
        }),

    // Production outcome state (Sprint 12A §29, §43). Two database reads and
    // **no outbound HTTP at all**: opening a project page must never contact a
    // customer's production website, and must never start an observation. The
    // card is `unavailable` for everything that was not merged, which is most
    // prepared changes.
    // The Move this change was prepared to address. One row, no provider call,
    // and the only source of meaning an agent-produced change has: its
    // capability is `agentic_execution_v1` for every agentic change ever
    // written, so a per-capability rationale cannot say anything about it.
    //
    // Both ids are nullable on the row, and a change missing either is simply a
    // change with no origin to show — not an error, and not worth a query.
    prepared.opportunitySetId && prepared.opportunityId
      ? getOpportunityById(supabase, {
          setId: prepared.opportunitySetId,
          opportunityId: prepared.opportunityId,
        })
      : Promise.resolve(null),
  ]);

  // Preview state is the server's answer, not something the panel derives
  // from validation plus a guess. This read costs three rows and no provider
  // call: opening the page must never spend anything (Sprint 10B-3 §2, §22).
  //
  // Genuinely second: it is told which validation it is previewing.
  const preview = await getPreviewCard(supabase, {
    projectId,
    preparedChangeId: prepared.id,
    validation: validation ? { id: validation.id, status: validation.status } : null,
    prefetched: { preview: lifecycle.preview, artifact: lifecycle.artifact },
    resolveFailureMessage: (code) =>
      OPERATION_FAILURE_MESSAGES[code as keyof typeof OPERATION_FAILURE_MESSAGES] ?? null,
  });

  // The preview's public origin, only while it is genuinely running. Fetched
  // from the provider rather than stored, because it is capability-like
  // (ADR 0016 §4) — and absent after teardown, which is expected: the
  // comparison images outlive the sandbox they photographed.
  const previewOrigin =
    preview.state === "running" && preview.previewSessionId
      ? ((
          await getPreviewStatus(
            supabase,
            createVercelSandboxProvider(),
            new VercelWorkflowExecutor(),
            { projectId, userId, previewSessionId: preview.previewSessionId },
          )
        )?.origin ?? null)
      : null;

  /*
   * Hoisted so the card's own progress can read it. The construction is
   * unchanged — only its position moved.
   */
  const validationSummary = validation
    ? buildValidationSummary(validation, {
        currentPolicyVersion: SANDBOX_POLICY_VERSION,
        failureMessage: validation.failureCode
          ? (OPERATION_FAILURE_MESSAGES[validation.failureCode] ?? null)
          : null,
      })
    : null;

  return {
    /*
     * Where this change stands, decided once here rather than re-inferred by
     * each panel (UI-5 §1). Synchronous and free: it reads the answers the
     * gates above already gave and re-decides none of them.
     */
    progress: deriveChangeProgress({
      validation: validationSummary,
      preview,
      review,
      approval,
      merge,
      outcome: lifecycle.outcome,
      businessImpact: lifecycle.businessImpact,
      reviewClassification: lifecycle.reviewClassification,
    }),
    id: prepared.id,
    reviewClassification: lifecycle.reviewClassification,
    branchName: prepared.branchName,
    commitSha: prepared.commitSha,
    baseBranch: prepared.baseBranch,
    filePaths: prepared.files.map((file) => file.path),
    createdAt: prepared.createdAt,
    branchUrl: params.repositoryFullName
      ? buildBranchUrl(params.repositoryFullName, prepared.branchName)
      : null,
    /*
     * Only ever read: what moved under this change, when it can no longer go
     * in as it is (UI-5 §7).
     */
    compareUrl: params.repositoryFullName
      ? buildCompareUrl(params.repositoryFullName, prepared.baseBranch, prepared.branchName)
      : null,
    validation: validationSummary,
    preview,
    // The artifact's id is its validation run's, and only a passing run can
    // have one. A failed run offers nothing for the client to name.
    validatedArtifactId: validation?.status === "passed" ? validation.id : null,
    review,
    // Signed on this render, after the service re-checked ownership, the
    // ready state and the retention deadline. Never persisted, and short
    // enough that a leaked URL is a small window (§16, §34).
    reviewImages:
      review.state === "ready" && review.reviewArtifactId
        ? await getReviewImages(supabase, {
            projectId,
            userId,
            reviewArtifactId: review.reviewArtifactId,
          })
        : null,
    // Only a *running* preview can be photographed. Offering the button for a
    // stopped one would buy a browser session that fails (§6).
    previewSessionId: preview.state === "running" ? preview.previewSessionId : null,
    previewOrigin,
    // Approval state, resolved from persisted rows (Sprint 11B §24, §27).
    // Costs a handful of reads and no provider call of any kind: approval is
    // a database action, and looking at it must stay free.
    approval,
    merge,
    outcome: lifecycle.outcome,
    // Deterministic and free: a lookup on the capability, no provider call
    // and no model (§6).
    rationale: businessRationaleFor(prepared.capability),
    /*
     * The Move this change came from, narrowed to what a person reads.
     *
     * Not a second rationale: it is the request, written before the change
     * existed, and the card labels it as one. It exists because an agentic
     * change has no capability rationale and structurally cannot have one —
     * the first real dogfood showed a card opening with a status line and then
     * a branch name, which is the whole thing UI-5 set out to stop.
     */
    origin: changeOriginFrom(opportunity),
    /*
     * The Move this change answers, as an address rather than as prose
     * (UI-S3 §4).
     *
     * `origin` is what a person reads; this is what a link needs. It is the
     * stored `prepared_changes.opportunity_id` and nothing else — the row was
     * already read above to build the origin, so this costs no query and
     * invents no relationship.
     *
     * Null both when the change predates the column and when its Move can no
     * longer be read, which is exactly when `origin` is null too: a card never
     * offers a link to a Move it cannot name.
     */
    opportunityId: opportunity ? prepared.opportunityId : null,
    businessImpact: lifecycle.businessImpact,
  };
}

/**
 * Every prepared change for a project, fully assembled.
 *
 * Prepared changes are read as artifacts, independent of the current
 * opportunity set: looking them up through live opportunities made an existing
 * branch vanish from the UI whenever opportunities were regenerated
 * (Sprint 10A §44).
 */
export async function getPreparedChangeWorkspace(
  supabase: SupabaseClient,
  params: { projectId: string; userId: string; repositoryFullName: string | null },
): Promise<PreparedChangeWorkspaceItem[]> {
  /*
   * The merge target and the change list answer independent questions, so
   * they are asked together (UI-4 §4).
   *
   * The repository a merge would write to is resolved once for the whole set.
   * Null when no repository is connected, which is also the answer that keeps
   * the merge card from making any GitHub call at all.
   */
  const [mergeTarget, prepared] = await Promise.all([
    params.repositoryFullName ? resolveMergeTarget(supabase, params.projectId) : null,
    listPreparedChangesForProject(supabase, params.projectId),
  ]);

  /*
   * Every lifecycle row for every card, in six queries (VB-023).
   *
   * This has to happen before the fan-out rather than inside it, which is the
   * whole point: a batched read that ran per card would be the same N+1 with
   * more machinery.
   */
  /*
   * One read-only reader for the whole list, from the linkage the merge target
   * already resolved. Building it per change is the pattern the dogfood route
   * uses and the one this file exists to avoid: it re-reads the project and its
   * repository connection every time.
   *
   * Read-only by type. A read model must have no way to write, and here that is
   * a property of what it holds rather than a claim about what it does.
   */
  const reader: FileTextReader | null = mergeTarget
    ? createGithubRepositoryReader(mergeTarget.installationId, mergeTarget.owner, mergeTarget.repo)
    : null;

  const lifecycles = await readChangeLifecycles(supabase, {
    projectId: params.projectId,
    prepared,
    reader,
  });

  /*
   * Cards are built together rather than in a queue. Two of the reads inside
   * a card can write — `getMergeCard` may record a not-eligible observation,
   * and `getPreviewStatus` may request teardown of a session that has expired
   * — but both are scoped to their own prepared change and both are "at most
   * once per reason", so cards cannot race each other into either of them.
   */
  // VB-023. This was parallel already, and unbounded — every prepared change's
  // card at once, each of which can reach GitHub through `mergeTarget`. A
  // project with thirty of them turned one render into thirty simultaneous
  // calls. Bounded, order preserved.
  return await mapWithConcurrency(prepared, PER_CHANGE_CONCURRENCY, (change) =>
    buildPreparedChangeCard(supabase, {
      projectId: params.projectId,
      userId: params.userId,
      repositoryFullName: params.repositoryFullName,
      mergeTarget,
      prepared: change,
      lifecycle:
        lifecycles.get(change.id) ??
        emptyLifecycle(unavailableOutcomeCard(), unmergedBusinessImpactCard()),
    }),
  );
}

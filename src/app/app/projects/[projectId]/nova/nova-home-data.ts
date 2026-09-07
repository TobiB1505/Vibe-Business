import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CostBalance } from "@/components/system/cost-disclosure";
import { getLatestAuditStamp, getProjectAuditById } from "@/modules/business-audit/store";
import { getHeaderCreditBalance } from "@/modules/billing/overview";
import type { ActionPlanChecklist } from "@/modules/action-plans/service";
import { getMoveWithExecution } from "@/modules/execution/service";
import type { OpportunityActionState } from "@/modules/execution/view";
import type { BusinessOpportunity } from "@/modules/opportunities/schema";
import { listAuditEventsForProject } from "@/modules/audit-log/queries";
import { BLOCK_FOR_OPERATION } from "@/modules/nova/blocks";
import { getProductScanEvents } from "@/modules/product-scan/store";
import type { ProductScanEvent } from "@/modules/product-scan/schema";
import { findAgentRunByOperation } from "@/modules/coding-agent/store";
import { listExecutionEvents } from "@/modules/coding-agent/observability/store";
import type { StoredExecutionEvent } from "@/modules/coding-agent/observability/events";
import { buildActivityFeed, type ActivityEntry } from "@/modules/audit-log/view";
import { getFounderInputRequest } from "@/modules/founder-input/store";
import { getLatestSuccessfulSnapshot } from "@/modules/repository-intelligence/store";
import type { WorkspaceCandidate } from "@/modules/validation/profile";
import { resolveProjectValidationTarget } from "@/modules/validation/workspace-store";
import {
  getPreparedChangeWorkspaceItem,
  type PreparedChangeWorkspaceItem,
} from "@/modules/execution/workspace";
import type { FounderInputRequest } from "@/modules/founder-input/schema";
import { buildNovaHomeView, type NovaHomeView } from "@/modules/nova/home-view";
import { readNovaHomeReading } from "@/modules/nova/read";
import {
  buildBusinessBrainView,
  type BusinessBrainView,
} from "@/modules/projects/business-brain-view";
import { productDisplayName } from "@/modules/projects/display-name";
import { buildHeadline } from "@/modules/product-understanding/view";
import type { ProductProfile } from "@/modules/product-understanding/schema";

/**
 * Everything Nova Home renders, read once (UI Sourcing Spec §15).
 *
 * ## Why the reads are counted
 *
 * This is the most-visited route in the product, and the audit's own risk note
 * for this slice was the read count on it. So the shape is deliberate: five
 * concurrent reads, none of which fans out per candidate — and then at most
 * two conditional reads, in one batch, answering two different questions.
 *
 * Four of them answer *what did the ranking put first*, and are described on
 * `question`, `change`, `workspaceCandidates` and `move` below. They are
 * mutually exclusive by construction: one primary candidate is one moment, and
 * each of the four belongs to a different set of kinds.
 *
 * The fifth and sixth answer *what is running*, which is a different question
 * and can be true at the same time as any of the four — a scan can be in
 * flight while the moment that leads is a change to review. They are
 * `scanEvents` and `agentEvents`, they are mutually exclusive by construction
 * because one operation has one type, and they are why the count above says
 * two rather than one.
 *
 * ## What "a read" means here, and what it hid
 *
 * A call, not a query. That distinction is not free: `getMoveWithExecution`
 * counted as one conditional read and issued up to thirteen queries, because
 * it asked for every Move's execution state in order to answer about one. The
 * word "one" in this file was true and told nobody anything.
 *
 * It is constant now — `move-read-cost.test.ts` counts it, and counts that it
 * does not grow with the size of the opportunity set. The lesson is the one
 * this docblock keeps having to relearn: a count of calls is a claim about
 * this file, and the cost is behind them.
 *
 * One of the five arrived with the rail and was weighed rather than assumed:
 * the event log, one query for six rows. The rail's checklist is not a sixth —
 * it comes back from `readNovaHomeReading` with the ranking, for the reason
 * below.
 *
 * ## The overlap that was here, and is not any more
 *
 * On a project with a plan this route briefly read the plan twice and its
 * three evidence tables twice: once to answer *which step could Vibe build*
 * and once to answer *where is the founder in the sequence*.
 *
 * The answers still differ — an absorbed step counts as satisfied for routing
 * only once the change that absorbed it is merged, which the rail does not
 * require to draw a ticked box — so the derivations stayed apart and the reads
 * came together. `readNovaHomeReading` makes them once and returns both, which
 * is why the checklist arrives from there rather than from a call of its own.
 *
 * 1. `readNovaFocus` — already batches its own eight queries internally and is
 *    the *only* place the ranking is decided.
 * 2. The product's identity row — three columns, one project.
 * 3. The latest audit — a stamp, then that one document. Not the sixty-reading
 *    trend, which is Business Health's and draws a chart Home does not have.
 * 4. The balance — `getHeaderCreditBalance`, which is documented as the one
 *    billing read a per-page surface may make. Never `getBillingOverview`,
 *    which repairs on read.
 *
 * ## What it deliberately does not carry
 *
 * `moveCount`. The Business Brain uses it to label a control — *View 3 next
 * moves* — and Home has no such control to label, so it was a field read out
 * of the view model on every render of the product's most-visited route and
 * dropped. A number nothing renders is not a smaller feature than one that is
 * wrong; it is a read nobody can see going stale.
 *
 * ## What it must not do
 *
 * Re-rank anything. `deriveNovaFocus` decides what leads and what follows;
 * this assembles the facts around that decision and adds no candidate.
 */

export type NovaProductIdentity = {
  name: string;
  logoUrl: string | null;
  category: string | null;
  understood: "confirmed" | "unconfirmed" | "not_read";
};

export type NovaHomeData = {
  view: NovaHomeView;
  identity: NovaProductIdentity;
  /**
   * The audit's own reading, or null when none has ever completed.
   *
   * Not a score of zero — nothing has been measured. It used to be six fields
   * projected out of this view for a panel Home no longer has, and the file's
   * own rule applied: a number nothing renders is a read nobody can see going
   * stale. So the view travels whole and the audit block draws it.
   */
  audit: BusinessBrainView | null;
  /** Null when the account has no Credit account yet. */
  balance: CostBalance | null;
  /**
   * The question to answer here, when the ranking put one first.
   *
   * A fifth read, and the only one that is conditional — it happens when and
   * only when the primary candidate is a question, which is a state most loads
   * are not in. That is the price of answering here instead of sending the
   * founder to the surface that could: the request has to be in hand, and
   * `FounderInputCard` takes it whole.
   *
   * Null also covers a request that has since been answered elsewhere. The
   * ranking read a row that said open; if the request is gone by the time this
   * reads it, the card renders nothing rather than a form for a settled
   * question.
   */
  question: FounderInputRequest | null;
  /**
   * The change to decide here, when the ranking put one first.
   *
   * The other conditional read, and the expensive one. It signs review images,
   * resolves a live preview and performs a read-only
   * merge preflight against GitHub — which is the price of the gates being
   * real rather than a picture of them, and it is the same read the Agent
   * route makes for the same card. It happens only where the primary candidate
   * is about a prepared change.
   *
   * Null covers a change that has moved on since the ranking read it: merged
   * in another tab, superseded, no longer `prepared`. The card then renders
   * Nova's sentence with no gates under it rather than gates for a change that
   * is not there.
   */
  change: PreparedChangeWorkspaceItem | null;
  /**
   * The applications to choose between, when the ranking put that first.
   *
   * Empty is the ordinary answer, and also the answer when the question has
   * been settled since the ranking read it — a repository with one application
   * poses no choice, and neither does one whose owner has already answered.
   *
   * Repository-derived and therefore untrusted data (rule 25): directory names
   * and framework ids are rendered as text by `AgentWorkspaceChoice`, never
   * interpolated into a href, a class, or anything a browser would execute.
   */
  workspaceCandidates: readonly WorkspaceCandidate[];
  /**
   * The Move to read, when the ranking put one first.
   *
   * The third of the conditional reads, and the one with an argument behind
   * its execution half: `MoveCard` reads a null execution as "no executor
   * summary exists" and says so, which would be a guess if nobody had looked.
   * `getMoveWithExecution` looks, with the builder the Action Plan uses, and a
   * Move that genuinely has no summary still resolves to null.
   */
  move: { opportunity: BusinessOpportunity; execution: OpportunityActionState | null } | null;
  /**
   * The running scan's own event stream, for the block that watches it.
   *
   * Empty unless a Product Scan is in flight. `ProductScanExperience` polls
   * from there on and refreshes this route when the run lands, so this is the
   * first frame rather than the whole story — and it is deliberately the same
   * read the product page makes, because the thread composes that component
   * rather than reproducing it.
   *
   * There is no presentation beside it. A presentation is built from a
   * completed profile, and a run that is still going has not written one; the
   * component's own poll supplies it the moment it exists. Passing a stale one
   * would be showing a founder last week's reading under a live progress line.
   */
  scanEvents: ProductScanEvent[];
  /**
   * The running agent's own record: the files it has touched so far.
   *
   * Empty unless an agent execution is in flight, and empty is also the answer
   * before the harness starts — an operation can be queued with no run behind
   * it yet. Two reads when it is: which run the operation started, and that
   * run's events.
   *
   * The first frame only. `NovaAgentLive` polls from there, asking for the
   * tail after the sequence it already holds, because the alternative is a
   * file list that stops moving while the agent keeps working.
   *
   * Deliberately not the Agent workspace's reading. That one also resolves the
   * run view, the open interrupt, the credit reservation and the prepared
   * change — which signs review images and preflights a merge against GitHub —
   * because the Agent route draws all of it. This block draws one list.
   */
  agentEvents: StoredExecutionEvent[];
  /**
   * The plan as a sequence, for the rail. Null when no plan has completed.
   *
   * No reads of its own: `readNovaHomeReading` already fetched the plan and
   * its evidence to answer which step Vibe could build, and this is the second
   * answer from the same rows. It derives completion with the Action Plan
   * page's own functions, so the summary and the page cannot come to
   * disagree — and it asks nothing about staleness or open questions, which
   * are the five reads that make the page's own call cost nine.
   */
  checklist: ActionPlanChecklist | null;
  /**
   * What has already happened, oldest last.
   *
   * The event log, which has existed since the audit trail shipped and which
   * no founder-facing surface but Settings has ever rendered. It is the only
   * half of this screen that is a *record*: everything else is re-derived on
   * every load and carries no timestamp, because a sentence computed now was
   * never sent at any particular time.
   */
  activity: ActivityEntry[];
};

type IdentityRow = {
  product_name: string | null;
  product_logo_url: string | null;
  confirmed_at: string | null;
  synthesized: boolean | null;
  result: ProductProfile | null;
};

async function readIdentity(
  supabase: SupabaseClient,
  projectId: string,
  projectName: string,
): Promise<NovaProductIdentity> {
  const { data, error } = await supabase
    .from("product_profiles")
    .select("product_name, product_logo_url, confirmed_at, synthesized, result")
    .eq("project_id", projectId)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;

  const row = (data ?? null) as IdentityRow | null;

  /*
   * The category goes through `buildHeadline` rather than out of the document.
   *
   * Every profile field is an `Attributed<T>` — `{ value, confidence, sources,
   * evidence }` — so `identity.category` is an object, and the enum inside it
   * (`developer_tool`) is a machine token no founder should ever read. Reaching
   * in for it produced both faults at once: React was handed an object to
   * render, and had it been a string it would have been the raw member.
   *
   * The module's own view boundary already resolves the label and is the only
   * place that holds the table, so Home asks it instead of parsing.
   */
  const headline = row?.result ? buildHeadline(row.result, row.synthesized ?? false) : null;

  return {
    // The product's own name, falling back to the label typed at connection
    // time. The rail says the project's; Home says the product's.
    name: productDisplayName({ name: projectName, productName: row?.product_name ?? null }),
    logoUrl: row?.product_logo_url ?? null,
    category: headline?.category ?? null,
    understood: row === null ? "not_read" : row.confirmed_at ? "confirmed" : "unconfirmed",
  };
}

/**
 * The applications Vibe found, for the one moment that is a choice between them.
 *
 * Two reads, and `readNovaFocus` has already made both — it resolves the same
 * target to decide whether to raise the candidate at all, then keeps the
 * boolean and discards the list. Reading it again here is the price of the
 * ranking model staying a ranking model: `FocusCandidate` is deliberately bare
 * for this kind, and threading a repository-derived list of directories
 * through it so that one surface can render them would put data in the domain
 * that nothing ranks on.
 *
 * It is paid only where the choice leads, which is a state a project is in
 * once, briefly, and never again after it answers.
 */
async function readWorkspaceCandidates(
  supabase: SupabaseClient,
  projectId: string,
): Promise<readonly WorkspaceCandidate[]> {
  const snapshot = await getLatestSuccessfulSnapshot(supabase, projectId);
  if (!snapshot?.result) return [];

  const target = await resolveProjectValidationTarget(supabase, {
    projectId,
    snapshot: snapshot.result,
  });

  /* Anything else is not this question. A supported target has no choice to
     make, and an outdated analysis is a different refusal with its own moment. */
  if (target.supported || target.reason !== "workspace_choice_required") return [];

  return target.candidates ?? [];
}

/**
 * The audit's reading, whole.
 *
 * A stamp, then that one document, then the module's own view boundary —
 * never the sixty-reading trend, which is Business Health's and draws a chart
 * Home does not have, and never the per-conclusion Move counts, which are the
 * Action Plan's. `buildBusinessBrainView` treats both as empty.
 */
async function readAudit(
  supabase: SupabaseClient,
  projectId: string,
): Promise<BusinessBrainView | null> {
  const stamp = await getLatestAuditStamp(supabase, projectId);
  if (!stamp) return null;

  const stored = await getProjectAuditById(supabase, { projectId, auditId: stamp.id });
  if (!stored?.result) return null;

  return (
    buildBusinessBrainView({
      audit: stored.result,
      lastScanAt: stored.completedAt ?? stored.createdAt,
      auditReadings: [],
      movesByConclusion: {},
    }) ?? null
  );
}

/**
 * What the agent has touched, for the block that watches it.
 *
 * Two reads, sequential because the second needs the first: the events are
 * keyed by the agent run, and only the operation is in hand. A queued run has
 * no row yet, which is an empty list rather than a failure — the block draws
 * its own empty state and the poll keeps asking.
 *
 * No audience filter, matching the Agent workspace: the split calls the
 * per-file detail `internal`, and this is the surface where a founder watches
 * it happen. Every summary is Vibe-authored from a closed vocabulary and the
 * redaction layer strips secrets on write, so there is no model narration in
 * here to leak (rules 25, 43).
 */
async function readAgentEvents(
  supabase: SupabaseClient,
  projectId: string,
  operationId: string,
): Promise<StoredExecutionEvent[]> {
  const run = await findAgentRunByOperation(supabase, operationId);
  if (!run || run.projectId !== projectId) return [];

  return listExecutionEvents(supabase, { runId: run.id, projectId });
}

export async function readNovaHomeData(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    userId: string;
    projectName: string;
    /** The connected repository, for the gates' preflight. Null when none is. */
    repositoryFullName: string | null;
  },
): Promise<NovaHomeData> {
  const [reading, identity, audit, balance, events] = await Promise.all([
    readNovaHomeReading(supabase, params.projectId, params.userId),
    readIdentity(supabase, params.projectId, params.projectName),
    readAudit(supabase, params.projectId),
    getHeaderCreditBalance(supabase, { userId: params.userId }),
    listAuditEventsForProject(supabase, {
      projectId: params.projectId,
      userId: params.userId,
      /* Six rows. The rail is a reminder of what happened, not the audit trail
         — Settings owns that, with paging. A column that scrolled would be a
         second log beside the one that already exists. */
      limit: 6,
    }),
  ]);

  const view = buildNovaHomeView(reading.focus);

  /*
   * After the four, not beside them: the id to read comes out of the ranking,
   * so this cannot join the batch above. It runs on the loads where the top of
   * the ranking is a question and on no others — which is what keeps the
   * documented read count honest rather than quietly five.
   */
  const control = view.primary.control;
  /*
   * The candidate carries the Move's id, rank and title — enough to rank it,
   * not enough to read it. The card wants the whole opportunity.
   */
  const primaryMove = "move" in view.primary.candidate ? view.primary.candidate.move : null;

  /*
   * Not keyed on the control: a run in flight and the moment that leads are
   * different questions, and a project can be in both at once.
   */
  const running = view.working;

  const [question, change, workspaceCandidates, move, scanEvents, agentEvents] = await Promise.all([
    control.kind === "answer"
      ? getFounderInputRequest(supabase, control.founderInputRequestId)
      : Promise.resolve(null),
    control.kind === "gate"
      ? getPreparedChangeWorkspaceItem(supabase, {
          projectId: params.projectId,
          userId: params.userId,
          repositoryFullName: params.repositoryFullName,
          preparedChangeId: control.preparedChangeId,
        })
      : Promise.resolve(null),
    control.kind === "choose"
      ? readWorkspaceCandidates(supabase, params.projectId)
      : Promise.resolve([]),
    primaryMove
      ? getMoveWithExecution(supabase, {
          projectId: params.projectId,
          opportunityId: primaryMove.id,
        })
      : Promise.resolve(null),
    /*
     * One query, on the loads where a scan is actually running. Both operation
     * types that draw the scan block write to the same event table keyed by
     * the operation, so the registry's answer is the whole condition — a
     * legacy run with no events renders the component's own empty state.
     */
    running && BLOCK_FOR_OPERATION[running.type] === "scan"
      ? getProductScanEvents(supabase, {
          projectId: params.projectId,
          operationId: running.operationId,
        })
      : Promise.resolve<ProductScanEvent[]>([]),
    running && BLOCK_FOR_OPERATION[running.type] === "agent"
      ? readAgentEvents(supabase, params.projectId, running.operationId)
      : Promise.resolve<StoredExecutionEvent[]>([]),
  ]);

  return {
    view,
    identity,
    audit,
    balance,
    question,
    change,
    workspaceCandidates,
    move,
    scanEvents,
    agentEvents,
    checklist: reading.checklist,
    /* Oldest last: a thread reads downward and the log arrives newest first. */
    activity: buildActivityFeed(events.events).reverse(),
  };
}

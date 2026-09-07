import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { EvidenceCitation } from "@/components/system/evidence-drawer";
import type { CostBalance } from "@/components/system/cost-disclosure";
import type { FindingSeverity } from "@/components/system/finding-card";
import { describeEvidenceId } from "@/modules/business-audit/evidence-labels";
import type { AuditEvidence } from "@/modules/business-audit/service";
import { getHeaderCreditBalance } from "@/modules/billing/overview";
import { getFounderInputRequest } from "@/modules/founder-input/store";
import { getLatestSuccessfulSnapshot } from "@/modules/repository-intelligence/store";
import type { WorkspaceCandidate } from "@/modules/validation/profile";
import { resolveProjectValidationTarget } from "@/modules/validation/workspace-store";
import {
  getPreparedChangeWorkspaceItem,
  type PreparedChangeWorkspaceItem,
} from "@/modules/execution/workspace";
import type { FounderInputRequest } from "@/modules/founder-input/schema";
import type { BusinessOpportunity } from "@/modules/opportunities/schema";
import type { PrimaryGoal } from "@/modules/projects/founder-intent";
import { situationAside } from "@/modules/nova/briefing/aside";
import { readBriefing } from "@/modules/nova/briefing/read";
import type { NovaSituation } from "@/modules/nova/briefing/situation";
import { getOpportunityExecutionState } from "@/modules/execution/service";
import type { OpportunityActionState } from "@/modules/execution/view";
import type { OpportunitySetView } from "@/modules/opportunities/service";
import { BLOCK_FOR_MOMENT } from "@/modules/nova/blocks";
import type { FocusCandidate, FocusCandidateKind } from "@/modules/nova/focus";
import { buildNovaAuditEntry } from "@/modules/nova/feed";
import { readNovaAuditVoice } from "@/modules/nova/voice/audit-slot";
import { readNovaMoveVoice } from "@/modules/nova/voice/move-slot";
import { buildNovaHomeView, type NovaHomeView } from "@/modules/nova/home-view";
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
 * for this slice was the read count on it. So the shape is deliberate: one
 * awaited briefing read, then a short concurrent wave, none of which fans out
 * per candidate — and then at most one conditional read, decided by what the
 * ranking put first and described on `question`, `change` and
 * `workspaceCandidates` below. Those three are mutually exclusive by
 * construction: one primary candidate is one moment, and each belongs to a
 * different set of kinds.
 *
 * 0. `readBriefing` — the six evidence documents, the ranking, the Move set,
 *    the currency judgements and the founder's name, assembled once. It hands
 *    the evidence and the focus back, so the score and the ranking below cost
 *    nothing more (VB-022). Awaited first for the reason Business Health
 *    awaits its evidence first: one round trip's latency buys back eight.
 * 1. The product's identity row — three columns, one project.
 * 2. The balance — `getHeaderCreditBalance`, which is documented as the one
 *    billing read a per-page surface may make. Never `getBillingOverview`,
 *    which repairs on read.
 * 3. Then, and only when the ranking put one of these moments first, the one
 *    subject it needs: the open question, the prepared change, the
 *    applications to choose between, the sentence Nova already wrote about the
 *    document, or the Move with its execution state. Every one of them is
 *    skipped on a load whose moment is about something else.
 *
 * The latest audit is not read at all — it arrives inside the evidence, which
 * is two queries fewer than the stamp-then-document pair this used to make,
 * and it is now the same audit the briefing's chain judges. Not the
 * sixty-reading trend, which is Business Health's and draws a chart Home does
 * not have.
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

export type NovaPriorityFinding = {
  headline: string;
  explanation: string;
  whyItMatters: string | null;
  severity: FindingSeverity;
  citations: EvidenceCitation[];
};

export type NovaHealth = {
  /**
   * The audit's own reading, kept rather than discarded.
   *
   * `buildBusinessBrainView` was already being called to produce the four
   * numbers below and then thrown away, which meant Home held the whole map
   * and rendered a score. The thread shows it when the audit is the moment,
   * and the read did not grow by a row.
   */
  view: BusinessBrainView;
  score: number | null;
  stateLabel: string;
  scoredLenses: number;
  eligibleLenses: number;
  insufficientCoverageReason: string | null;
  priority: NovaPriorityFinding | null;
};

export type NovaHomeData = {
  view: NovaHomeView;
  identity: NovaProductIdentity;
  /** Null when no audit has ever completed — not a score of zero. */
  health: NovaHealth | null;
  /** Null when the account has no Credit account yet. */
  balance: CostBalance | null;
  /**
   * What Nova wrote about the document this moment is about, when she has.
   *
   * A **read**, never a generation: the sentence was written at the tail of the
   * operation that produced the document, and this resolves it by identity
   * (ADR 0086, condition 5 — a render cannot reach a provider). Null is the
   * ordinary state, and the thread then says exactly what it said before.
   */
  momentVoice: string | null;
  /**
   * Vibe's own line about the evidence under this moment, when it says
   * something the moment does not — and only when Nova wrote nothing.
   *
   * Deterministic, free, and current on every draw. `briefing/aside.ts` has
   * the two rules and why it yields rather than repeat.
   */
  situationAside: string | null;
  /**
   * The Move this moment is about, read before it is paid for.
   *
   * Null when the moment is about something else, when the ranking named a
   * Move the current set no longer holds, or when the moment is a plan step
   * rather than a Move — `execution_offered` carries a step order and no Move
   * id, so there is nothing to draw and a frame around that would be worse
   * than none.
   */
  move: { opportunity: BusinessOpportunity; execution: OpportunityActionState } | null;
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
 * A citation, resolved to the sentence a founder reads.
 *
 * The id never leaves this function. `describeEvidenceId` is the same resolver
 * the Business Brain uses, so the drawer on Home and the evidence on Business
 * Health say the same thing about the same id.
 */
function citation(id: string): EvidenceCitation {
  const described = describeEvidenceId(id);
  return { detail: described.detail, source: described.source, certainty: described.certainty };
}

/**
 * The business reading, from the audit the evidence read already holds.
 *
 * It used to fetch its own — a stamp, then that document by id — which was two
 * queries for the row `readAuditEvidence` returns as `latestAudit`. Now that
 * the briefing needs the evidence anyway, taking the audit from it is two
 * reads back rather than two more, and it removes the way the two could
 * disagree: Home's score and Home's briefing are the same audit by
 * construction.
 */
function buildHealth(latestAudit: AuditEvidence["latestAudit"]): NovaHealth | null {
  const stored = latestAudit;
  if (!stored?.result) return null;

  /*
   * No readings and no moves. Home draws no trend and offers no per-conclusion
   * Move count that it could act on, so asking for either would be reading
   * rows to throw them away. `buildBusinessBrainView` treats both as empty.
   */
  const view = buildBusinessBrainView({
    audit: stored.result,
    lastScanAt: stored.completedAt ?? stored.createdAt,
    auditReadings: [],
    movesByConclusion: {},
  });

  if (!view) return null;

  const priority = view.primaryPriority;

  return {
    view,
    score: view.overall.score,
    stateLabel: view.overall.stateLabel,
    scoredLenses: view.overall.scoredLenses,
    eligibleLenses: view.overall.eligibleLenses,
    // The sentence behind a missing score. Computed by the scorer since the
    // audit shipped, and until now rendered nowhere.
    insufficientCoverageReason: stored.result.overall.insufficientCoverageReason,
    priority: priority
      ? {
          headline: priority.headline,
          explanation: priority.explanation,
          whyItMatters: priority.whyItMatters,
          severity: priority.tone,
          citations: priority.evidence.map((item) => citation(item.id)),
        }
      : null,
  };
}

/**
 * The sentence Nova already wrote about the document this moment is about.
 *
 * ## Why this is a lookup and not a call
 *
 * Nova has been writing about two documents since the voice tier was wired —
 * the audit, at the tail of the audit that produced it, and the top Move, at
 * the tail of the Move generation. Those sentences are in `nova_voice_messages`
 * and Business Health and the Plan read them back. Home never did, which meant
 * the one surface where Nova is *speaking* was the one surface with none of her
 * writing on it.
 *
 * So this reads what is there. It cannot generate: neither slot reader takes a
 * provider, and a render that wanted one would have to be rewritten rather than
 * edited (ADR 0086, condition 5).
 *
 * ## Why the moment decides which sentence
 *
 * `BLOCK_FOR_MOMENT` already says which document a moment is about — it is what
 * chooses the block below the sentence — so asking it again for the sentence is
 * the same question answered from the same table. A moment about a question or
 * a change gets nothing: a question is not Nova's to rephrase, and the change
 * slot is not generated yet.
 *
 * ## Why the situation has to be passed in
 *
 * It is part of the identity the durable step wrote under, composed by
 * `readBriefing` from the same chain. Recomputing it differently here would
 * resolve to nothing at all, permanently, and look exactly like Nova never
 * having spoken.
 */
async function readMomentVoice(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    moment: FocusCandidateKind;
    latestAudit: AuditEvidence["latestAudit"];
    health: NovaHealth | null;
    topMove: BusinessOpportunity | null;
    primaryGoal: PrimaryGoal | null;
    situation: NovaSituation;
  },
): Promise<string | null> {
  const block = BLOCK_FOR_MOMENT[params.moment];

  if (block === "audit") {
    const synthesis = params.latestAudit?.result?.synthesis ?? null;
    if (!params.health || synthesis === null) return null;

    const read = await readNovaAuditVoice(supabase, {
      projectId: params.projectId,
      /* The same entry Business Health builds, from the same view — which is
         what makes the two surfaces resolve one message rather than two. */
      entry: buildNovaAuditEntry(params.health.view, synthesis),
      situation: params.situation,
    });

    /* Only her own words. The template belongs to the surface that owns the
       document; here it would be a second sentence saying what the moment
       already said. */
    return read.source === "voice" ? read.message : null;
  }

  if (block === "move") {
    if (!params.topMove) return null;

    const read = await readNovaMoveVoice(supabase, {
      projectId: params.projectId,
      move: params.topMove,
      primaryGoal: params.primaryGoal,
      situation: params.situation,
    });

    return read.source === "voice" ? read.message : null;
  }

  return null;
}

/**
 * The Move the moment names, and whether Vibe can act on it.
 *
 * ## Why the candidate names the Move rather than the briefing
 *
 * `readBriefing` carries the engine's rank-1, and the ranking is free to put a
 * different one first — `next_move_available` is precisely the moment where it
 * does. Drawing rank 1 under a sentence about another Move would be a card
 * about the wrong thing, which is worse than no card.
 *
 * ## Why the execution state is resolved rather than passed as null
 *
 * Because `MoveCard` reads `null` as *"Vibe has no executor for this"* and
 * says so — "Not automated yet", from a field the opportunity model wrote
 * about itself. Rule 54 is explicit that model output is never authority, and
 * a surface that had simply not asked would have been asserting it. So Home
 * asks: three reads, on a Move moment and nowhere else.
 */
async function readMomentMove(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    productionUrl: string | null;
    candidate: FocusCandidate;
    moment: FocusCandidateKind;
    opportunities: OpportunitySetView | null;
    repository: AuditEvidence["repository"];
  },
): Promise<NovaHomeData["move"]> {
  if (BLOCK_FOR_MOMENT[params.moment] !== "move") return null;

  /* `execution_offered` is about a plan step and names no Move. */
  const candidate = params.candidate;
  if (!("move" in candidate)) return null;

  const set = params.opportunities?.set;
  const repository = params.repository;
  if (!set || !repository?.result) return null;

  const opportunity = set.opportunities.find((entry) => entry.id === candidate.move.id);
  if (!opportunity) return null;

  const execution = await getOpportunityExecutionState(supabase, {
    projectId: params.projectId,
    opportunity,
    opportunitySetId: set.id,
    repositorySnapshotId: repository.id,
    repository: repository.result,
    hasProductionOrigin: params.productionUrl !== null,
  });

  return { opportunity, execution };
}

export async function readNovaHomeData(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    userId: string;
    projectName: string;
    /** The connected repository, for the gates' preflight. Null when none is. */
    repositoryFullName: string | null;
    /**
     * The product's own origin, for resolving whether a Move is executable.
     * Null when none is set — which is itself an answer, not a missing one.
     */
    productionUrl: string | null;
    /** Injected so a briefing is a function of its inputs and one clock. */
    now?: Date;
  },
): Promise<NovaHomeData> {
  /*
   * The briefing's own read is genuinely first, so it is awaited before the
   * wave rather than inside it — the same shape Business Health uses, and for
   * the same reason. It hands back the evidence and the focus it assembled, so
   * the score and the ranking cost nothing more (VB-022).
   */
  const { evidence, focus, situation, topMove, opportunities } = await readBriefing(
    supabase,
    params,
  );

  const [identity, balance] = await Promise.all([
    readIdentity(supabase, params.projectId, params.projectName),
    getHeaderCreditBalance(supabase, { userId: params.userId }),
  ]);

  const view = buildNovaHomeView(focus);

  /*
   * After the wave, not beside it: the id to read comes out of the ranking, so
   * this cannot join the batch above. It runs on the loads where the top of
   * the ranking is a question and on no others — which is what keeps the
   * documented read count honest rather than quietly one more.
   */
  const control = view.primary.control;
  const health = buildHealth(evidence.latestAudit);

  const [question, change, workspaceCandidates, momentVoice, move] = await Promise.all([
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
    /*
     * The sentence Nova already wrote about whatever this moment is about, if
     * she wrote one. One row by identity, and only for the two moments that
     * have a document behind them — see `readMomentVoice`.
     */
    readMomentVoice(supabase, {
      projectId: params.projectId,
      moment: view.primary.kind,
      latestAudit: evidence.latestAudit,
      health,
      topMove,
      primaryGoal: evidence.founderIntent.intent.primaryGoal,
      situation,
    }),
    /*
     * The Move the moment names, with the one thing the card cannot show
     * without asking: whether Vibe can act on it. Three reads, and only on a
     * moment that is about a Move — the alternative was a card claiming "Not
     * automated yet" because nobody had asked.
     */
    readMomentMove(supabase, {
      projectId: params.projectId,
      productionUrl: params.productionUrl,
      candidate: view.primary.candidate,
      moment: view.primary.kind,
      opportunities,
      repository: evidence.repository,
    }),
  ]);

  return {
    view,
    identity,
    /* From the evidence already read, not from a stamp-then-document pair of
       its own — which is two reads fewer and makes the score and the briefing
       the same audit by construction. */
    health,
    balance,
    question,
    change,
    workspaceCandidates,
    momentVoice,
    move,
    situationAside: situationAside({
      situation,
      moment: view.primary.kind,
      spoken: momentVoice !== null,
    }),
  };
}

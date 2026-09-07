import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { EvidenceCitation } from "@/components/system/evidence-drawer";
import type { CostBalance } from "@/components/system/cost-disclosure";
import type { FindingSeverity } from "@/components/system/finding-card";
import { describeEvidenceId } from "@/modules/business-audit/evidence-labels";
import { getLatestAuditStamp, getProjectAuditById } from "@/modules/business-audit/store";
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
import { buildNovaHomeView, type NovaHomeView } from "@/modules/nova/home-view";
import { readNovaFocus } from "@/modules/nova/read";
import { buildBusinessBrainView } from "@/modules/projects/business-brain-view";
import { productDisplayName } from "@/modules/projects/display-name";
import { buildHeadline } from "@/modules/product-understanding/view";
import type { ProductProfile } from "@/modules/product-understanding/schema";

/**
 * Everything Nova Home renders, read once (UI Sourcing Spec §15).
 *
 * ## Why the reads are counted
 *
 * This is the most-visited route in the product, and the audit's own risk note
 * for this slice was the read count on it. So the shape is deliberate: four
 * concurrent reads, none of which fans out per candidate — and then at most
 * one conditional read, decided by what the ranking put first and described on
 * `question`, `change` and `workspaceCandidates` below. They are mutually
 * exclusive by construction: one primary candidate is one moment, and each of
 * the three belongs to a different set of kinds.
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

export type NovaPriorityFinding = {
  headline: string;
  explanation: string;
  whyItMatters: string | null;
  severity: FindingSeverity;
  citations: EvidenceCitation[];
};

export type NovaHealth = {
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

async function readHealth(supabase: SupabaseClient, projectId: string): Promise<NovaHealth | null> {
  const stamp = await getLatestAuditStamp(supabase, projectId);
  if (!stamp) return null;

  const stored = await getProjectAuditById(supabase, { projectId, auditId: stamp.id });
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
  const [focus, identity, health, balance] = await Promise.all([
    readNovaFocus(supabase, params.projectId),
    readIdentity(supabase, params.projectId, params.projectName),
    readHealth(supabase, params.projectId),
    getHeaderCreditBalance(supabase, { userId: params.userId }),
  ]);

  const view = buildNovaHomeView(focus);

  /*
   * After the four, not beside them: the id to read comes out of the ranking,
   * so this cannot join the batch above. It runs on the loads where the top of
   * the ranking is a question and on no others — which is what keeps the
   * documented read count honest rather than quietly five.
   */
  const control = view.primary.control;
  const [question, change, workspaceCandidates] = await Promise.all([
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
  ]);

  return { view, identity, health, balance, question, change, workspaceCandidates };
}

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { EvidenceCitation } from "@/components/system/evidence-drawer";
import type { CostBalance } from "@/components/system/cost-disclosure";
import type { FindingSeverity } from "@/components/system/finding-card";
import { describeEvidenceId } from "@/modules/business-audit/evidence-labels";
import type { AuditEvidence } from "@/modules/business-audit/service";
import { getHeaderCreditBalance } from "@/modules/billing/overview";
import { readBriefingView } from "@/modules/nova/briefing/read";
import type { BriefingView } from "@/modules/nova/briefing/view";
import { readNovaBriefingVoice } from "@/modules/nova/voice/briefing-slot";
import { buildNovaHomeView, type NovaHomeView } from "@/modules/nova/home-view";
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
 * for this slice was the read count on it. So the shape is deliberate: one
 * awaited briefing read, then a single concurrent wave, none of which fans out
 * per candidate.
 *
 * 0. `readBriefingView` — the six evidence documents, the ranking, the Move
 *    set, the currency judgements and the founder's name, assembled once. It
 *    hands the evidence and the focus back, so the score and the ranking below
 *    cost nothing more (VB-022). Awaited first for the reason Business Health
 *    awaits its evidence first: one round trip's latency buys back eight.
 * 1. The product's identity row — three columns, one project.
 * 2. The balance — `getHeaderCreditBalance`, which is documented as the one
 *    billing read a per-page surface may make. Never `getBillingOverview`,
 *    which repairs on read.
 * 3. `readNovaBriefingVoice` — one row by identity. It takes no provider and
 *    cannot obtain one (ADR 0086, condition 5): a render resolves a stored
 *    sentence or falls through to Vibe's own.
 *
 * The latest audit is not read at all — it arrives inside the evidence, which
 * is two queries fewer than the stamp-then-document pair this used to make,
 * and it is now the same audit the briefing's chain judges. Not the
 * sixty-reading trend, which is Business Health's and draws a chart Home does
 * not have.
 *
 * ## What it must not do
 *
 * Re-rank anything. `deriveNovaFocus` decides what leads and what follows;
 * this assembles the facts around that decision and adds no candidate. The
 * briefing is held to the same rule: `buildProvenanceChain` judges the
 * evidence and the opportunity engine ranked the Move, so what is assembled
 * here is the join and never a second opinion.
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
  moveCount: number;
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
  /** Where the founder stands, joined from the evidence this read already holds. */
  briefing: BriefingView;
  /**
   * What the panel says about the evidence: a stored sentence when a durable
   * step wrote one for this exact situation, and `briefing.situation`
   * otherwise. **Never a provider call** — this read cannot reach one
   * (ADR 0086, condition 5).
   */
  briefingVoice: string;
  identity: NovaProductIdentity;
  /** Null when no audit has ever completed — not a score of zero. */
  health: NovaHealth | null;
  /** Null when the account has no Credit account yet. */
  balance: CostBalance | null;
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
          moveCount: priority.moveCount,
        }
      : null,
  };
}

export async function readNovaHomeData(
  supabase: SupabaseClient,
  params: { projectId: string; userId: string; projectName: string; now?: Date },
): Promise<NovaHomeData> {
  /*
   * The briefing's own read is genuinely first, so it is awaited before the
   * wave rather than inside it — the same shape Business Health uses, and for
   * the same reason. It hands back the evidence and the focus it assembled, so
   * the score and the ranking cost nothing more (VB-022).
   */
  const { view: briefing, evidence, focus } = await readBriefingView(supabase, params);

  const [identity, balance, briefingVoice] = await Promise.all([
    readIdentity(supabase, params.projectId, params.projectName),
    getHeaderCreditBalance(supabase, { userId: params.userId }),
    readNovaBriefingVoice(supabase, { projectId: params.projectId, view: briefing }),
  ]);

  return {
    view: buildNovaHomeView(focus),
    briefing,
    briefingVoice: briefingVoice.message,
    identity,
    health: buildHealth(evidence.latestAudit),
    balance,
  };
}

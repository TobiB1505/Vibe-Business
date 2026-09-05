import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { EvidenceCitation } from "@/components/system/evidence-drawer";
import type { CostBalance } from "@/components/system/cost-disclosure";
import type { FindingSeverity } from "@/components/system/finding-card";
import { describeEvidenceId } from "@/modules/business-audit/evidence-labels";
import { getLatestAuditStamp, getProjectAuditById } from "@/modules/business-audit/store";
import { getHeaderCreditBalance } from "@/modules/billing/overview";
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
 * concurrent reads, none of which fans out per candidate.
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
          moveCount: priority.moveCount,
        }
      : null,
  };
}

export async function readNovaHomeData(
  supabase: SupabaseClient,
  params: { projectId: string; userId: string; projectName: string },
): Promise<NovaHomeData> {
  const [focus, identity, health, balance] = await Promise.all([
    readNovaFocus(supabase, params.projectId),
    readIdentity(supabase, params.projectId, params.projectName),
    readHealth(supabase, params.projectId),
    getHeaderCreditBalance(supabase, { userId: params.userId }),
  ]);

  return { view: buildNovaHomeView(focus), identity, health, balance };
}

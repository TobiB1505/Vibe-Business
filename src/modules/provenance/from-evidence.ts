import type {
  AuditCurrency,
  AuditEvidence,
  AuditReadiness,
} from "@/modules/business-audit/service";
import type { OpportunitySetView } from "@/modules/opportunities/service";

import type { ProvenanceInputs } from "./chain";

/**
 * The chain's inputs, taken from what a page has already read.
 *
 * ## Why an adapter and not a reader
 *
 * Because the Business Health page measured what a second reader costs. Six
 * documents were being fetched four times over per render of the most-visited
 * route in the product, on multi-hundred-kilobyte JSONB columns, and VB-022
 * fixed it by reading once and passing the evidence down. A provenance surface
 * that went back to the database for the same six rows would put half of that
 * back — and, worse, could return a different answer than the button beside it.
 *
 * So this takes the documents and the two already-computed judgments, and does
 * nothing but rename fields. Every decision in here was made somewhere else.
 *
 * ## Why `result` decides presence, not the row
 *
 * `outdatedScans` guards on `evidence.repository?.result` rather than on the
 * row, and this mirrors it exactly. A snapshot row that carries no document is
 * not evidence, and treating it as present would put a date on the panel for
 * something the audit cannot read.
 */
export function provenanceInputsFrom(inputs: {
  evidence: AuditEvidence;
  /** For `productProfileCurrent`. */
  readiness: AuditReadiness;
  /** For `upToDate`. */
  currency: AuditCurrency;
  opportunities: OpportunitySetView | null;
}): ProvenanceInputs {
  const { evidence, readiness, currency, opportunities } = inputs;

  const repository = evidence.repository?.result ? evidence.repository : null;
  const live = evidence.live?.result ? evidence.live : null;
  const audit = evidence.latestAudit?.result ? evidence.latestAudit : null;

  return {
    repositoryScan: repository
      ? { producedAt: producedAt(repository), analyzerVersion: repository.analyzerVersion }
      : null,
    liveScan: live ? { producedAt: producedAt(live), analyzerVersion: live.analyzerVersion } : null,
    productProfile: evidence.profile
      ? {
          producedAt: producedAt(evidence.profile.stored),
          current: readiness.productProfileCurrent,
        }
      : null,
    businessAudit: audit ? { producedAt: producedAt(audit), upToDate: currency.upToDate } : null,
    opportunitySet: opportunities
      ? { producedAt: producedAt(opportunities.set), stale: opportunities.stale }
      : null,
  };
}

/**
 * When Vibe finished producing it, falling back to when it started.
 *
 * `completed_at` is the honest answer — it is the instant the document became
 * what it is — and it is nullable on every one of these tables. The fallback
 * keeps a date on screen rather than a dash for a row that finished before the
 * column existed.
 */
function producedAt(row: { completedAt: string | null; createdAt: string }): string {
  return row.completedAt ?? row.createdAt;
}

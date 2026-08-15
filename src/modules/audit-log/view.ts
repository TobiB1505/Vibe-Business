import type { AuditEventType } from "./events";
import type { AuditEventRecord } from "./queries";

/**
 * The Activity view model (Sprint UI-2 Phase A).
 *
 * ## What this is for
 *
 * The stored row is `event_type` plus a free-form `metadata` blob. That is the
 * right shape for an append-only log and the wrong shape for a screen: an
 * activity feed reading `change_merge.default_branch_updated` is a database
 * table with a heading on it.
 *
 * So this maps each event to a sentence, and pulls out only the handful of
 * metadata fields that are safe, present and worth showing.
 *
 * ## Two rules it enforces
 *
 * - **Nothing is invented.** Every field is read from what the writer actually
 *   stored; a missing one is absent, never a placeholder. The label table is a
 *   `Record<AuditEventType, …>`, so adding an event type without a label is a
 *   type error rather than a row rendering its raw identifier in production.
 * - **Nothing sensitive is surfaced.** The writers already refuse to log signed
 *   URLs, preview origins, tokens and page content (see `events.ts`). This
 *   reads a deliberate allowlist rather than spreading `metadata`, so a future
 *   writer that records something it should not cannot leak it through here by
 *   default.
 */

/** How an event landed. Drives the dot's colour and the word beside it. */
export type ActivityTone = "success" | "waiting" | "problem" | "neutral";

export type ActivityEntry = {
  id: string;
  eventType: AuditEventType;
  /** ISO timestamp, formatted by the component. */
  at: string;
  title: string;
  tone: ActivityTone;
  /** Short machine facts, already filtered to the safe allowlist. */
  facts: { label: string; value: string }[];
};

const LABELS: Record<AuditEventType, string> = {
  "github.authorization.started": "GitHub authorization started",
  "github.identity.verified": "GitHub identity verified",
  "github.installation.connected": "GitHub installation connected",
  "github.access.failed": "GitHub access failed",
  "repository.selected": "Repository selected",
  "project.created": "Project created",
  "project.disconnected": "Project disconnected",
  "project.production_url.updated": "Production URL updated",
  "business_context.updated": "Business context updated",

  // Written the way the flow speaks (CORE-1 §45): the Activity feed is the one
  // place these events are read by a person, and "Product understanding
  // synthesis succeeded" is infrastructure talking to itself.
  "product_understanding.started": "Vibe started getting to know your product",
  "product_understanding.completed": "Vibe understood your product",
  "product_understanding.completed_without_synthesis":
    "Vibe described your product from what it found",
  "product_understanding.reused": "Product understanding reused",
  "product_understanding.confirmed": "You confirmed Vibe understood your product",
  "product_understanding.corrected": "You corrected what Vibe understood",

  "repository.intelligence.started": "Repository analysis started",
  "repository.intelligence.completed": "Repository analyzed",
  "repository.intelligence.failed": "Repository analysis failed",
  "repository.intelligence.reused": "Repository analysis reused",

  "live_product.intelligence.started": "Website inspection started",
  "live_product.intelligence.completed": "Website inspected",
  "live_product.intelligence.failed": "Website inspection failed",
  "live_product.intelligence.reused": "Website inspection reused",

  "deep_scan.started": "Deep Scan started",
  "deep_scan.completed": "Deep Scan completed",
  "deep_scan.failed": "Deep Scan failed",
  "deep_scan.cancelled": "Deep Scan cancelled",

  "business_audit.started": "Business audit started",
  "business_audit.completed": "Business audit completed",
  "business_audit.failed": "Business audit failed",
  "business_audit.reused": "Business audit reused",

  "operation.started": "Operation started",
  "operation.completed": "Operation completed",
  "operation.failed": "Operation failed",

  "opportunities.completed": "Opportunities identified",
  "opportunities.failed": "Opportunity analysis failed",
  "opportunities.reused": "Opportunities reused",

  "change_preparation.started": "Change preparation started",
  "change_preparation.completed": "Change prepared",
  "change_preparation.failed": "Change preparation failed",

  "change_validation.started": "Validation started",
  "change_validation.passed": "Validation passed",
  "change_validation.failed": "Validation failed",
  "change_validation.artifact_capture_failed": "Validation artifact capture failed",

  "change_preview.started": "Preview starting",
  "change_preview.running": "Preview running",
  "change_preview.stopped": "Preview stopped",
  "change_preview.expired": "Preview expired",
  "change_preview.failed": "Preview failed",
  "change_preview.integrity_failed": "Preview integrity check failed",
  "change_preview.cleanup_incomplete": "Preview cleanup incomplete",

  "change_review.started": "Review comparison started",
  "change_review.ready": "Review comparison ready",
  "change_review.failed": "Review comparison failed",

  "change_approval.created": "Change approved",
  "change_approval.revoked": "Approval revoked",
  "change_approval.invalidated": "Approval no longer applies",

  "change_merge.requested": "Merge requested",
  "change_merge.preflight_passed": "Merge preflight passed",
  "change_merge.not_eligible": "Merge not eligible",
  "change_merge.blocked": "Merge blocked",
  "change_merge.default_branch_updated": "Default branch updated",
  "change_merge.verified": "Merge verified",
  "change_merge.failed": "Merge failed",

  "change_outcome.started": "Production check started",
  "change_outcome.verified": "Production outcome verified",
  "change_outcome.partial": "Production outcome partial",
  "change_outcome.not_observed": "Production outcome not observed",
  "change_outcome.failed": "Production check failed",

  "business_measurement.created": "Measurement planned",
  "business_measurement.started": "Measurement started",
  "business_measurement.completed": "Measurement completed",
  "business_measurement.insufficient_data": "Not enough data to measure",
  "business_measurement.failed": "Measurement failed",
};

/**
 * Tone is derived from the event's suffix rather than listed per event, so a
 * new `*.failed` cannot accidentally render as success. The explicit entries
 * above it are the ones whose suffix would mislead.
 */
const EXPLICIT_TONES: Partial<Record<AuditEventType, ActivityTone>> = {
  // Not a failure of Vibe's, and not a success either: the product did not show
  // the change within the window. Sprint 12A made that distinction the point.
  "change_outcome.not_observed": "waiting",
  "change_outcome.partial": "waiting",
  "business_measurement.insufficient_data": "waiting",
  // A refusal working correctly. The merge did not happen, and that is the
  // safety property doing its job rather than an error.
  "change_merge.blocked": "waiting",
  "change_merge.not_eligible": "waiting",
  "change_approval.invalidated": "waiting",
  "change_approval.revoked": "neutral",
  "change_preview.cleanup_incomplete": "waiting",
  // The one event that means bytes moved on the customer's default branch.
  "change_merge.default_branch_updated": "success",
};

export function toneFor(eventType: AuditEventType): ActivityTone {
  const explicit = EXPLICIT_TONES[eventType];
  if (explicit) return explicit;

  if (eventType.endsWith(".failed")) return "problem";
  if (
    eventType.endsWith(".completed") ||
    eventType.endsWith(".passed") ||
    eventType.endsWith(".verified") ||
    eventType.endsWith(".ready") ||
    eventType.endsWith(".connected") ||
    eventType.endsWith(".created")
  ) {
    return "success";
  }
  return "neutral";
}

/**
 * The allowlist. A metadata key not named here is never displayed, however
 * useful it looks — that is what keeps a future writer's mistake from becoming
 * this screen's leak.
 *
 * Deliberately absent: anything origin-, URL- or image-shaped.
 */
const FACT_KEYS: { key: string; label: string; shorten?: boolean }[] = [
  { key: "branchName", label: "branch" },
  { key: "baseBranch", label: "base" },
  { key: "commitSha", label: "commit", shorten: true },
  { key: "mergedSha", label: "commit", shorten: true },
  { key: "approvedCommitSha", label: "approved", shorten: true },
  { key: "capability", label: "capability" },
  { key: "failureCode", label: "reason" },
  { key: "reason", label: "reason" },
  { key: "metricKey", label: "metric" },
  { key: "pagesInspected", label: "pages" },
];

function readFact(
  metadata: Record<string, unknown>,
  entry: (typeof FACT_KEYS)[number],
): { label: string; value: string } | null {
  const raw = metadata[entry.key];
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string" && typeof raw !== "number") return null;

  const value = String(raw);
  if (value.trim().length === 0) return null;

  // A SHA is shown the way the rest of the product shows one.
  return { label: entry.label, value: entry.shorten ? value.slice(0, 7) : value };
}

export function buildActivityEntry(record: AuditEventRecord): ActivityEntry {
  const facts: { label: string; value: string }[] = [];
  for (const entry of FACT_KEYS) {
    const fact = readFact(record.metadata, entry);
    // One value per label: `commitSha` and `mergedSha` both mean "commit", and
    // an event carrying both should not print the column twice.
    if (fact && !facts.some((existing) => existing.label === fact.label)) {
      facts.push(fact);
    }
  }

  return {
    id: record.id,
    eventType: record.eventType,
    at: record.createdAt,
    // An unknown type still renders — as its identifier, which is ugly on
    // purpose and better than an empty row. The Record type makes this
    // unreachable for any type declared in `events.ts`.
    title: LABELS[record.eventType] ?? record.eventType,
    tone: toneFor(record.eventType),
    facts,
  };
}

export function buildActivityFeed(records: AuditEventRecord[]): ActivityEntry[] {
  return records.map(buildActivityEntry);
}

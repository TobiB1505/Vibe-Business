/**
 * What the audit section says about Deep Scan evidence (Sprint 6 §11, §14).
 *
 * Pure and synchronous so every state is a unit test rather than a screenshot.
 *
 * Three rules the copy downstream must keep:
 *
 *  1. **Never block the audit.** Deep Scan is optional evidence; an audit
 *     without it is a valid audit with a stated gap.
 *  2. **Never promise a better score.** A Deep Scan adds evidence, and more
 *     evidence can move an assessment in either direction. Promising an
 *     improvement would be selling a paid action on a claim we cannot make.
 *  3. **Never spend inference on its own.** New evidence produces an offer to
 *     re-run, never a re-run.
 */

export type AuditEvidenceNotice =
  /** A Deep Scan exists that the displayed audit has not seen yet. */
  | { kind: "deep_scan_stale" }
  /** Vibe has evidence of a signed-in product, but has never looked inside it. */
  | { kind: "deep_scan_suggested"; canStartDeepScan: boolean }
  /** Nothing useful to say — stay quiet. */
  | { kind: "none" };

export type AuditEvidenceNoticeInput = {
  /** A latest *successful* Deep Scan snapshot exists. */
  hasSuccessfulDeepScan: boolean;
  /** The surface detector believes part of the product sits behind a login. */
  authenticatedSurfacesLikely: boolean;
  /** The Deep Scan panel would currently accept a start. */
  canStartDeepScan: boolean;
  /** The displayed audit predates the current Deep Scan snapshot. */
  auditPredatesDeepScan: boolean;
};

export function buildAuditEvidenceNotice(input: AuditEvidenceNoticeInput): AuditEvidenceNotice {
  // Staleness first: it is the only state with an action attached, and it
  // implies the "ready" state it would otherwise be shadowed by.
  if (input.hasSuccessfulDeepScan && input.auditPredatesDeepScan) return { kind: "deep_scan_stale" };

  /*
   * A current Deep Scan used to produce a fourth kind — a row reading
   * "Authenticated product evidence · Ready", above the verdict, on every
   * visit, forever (UI-7 §4). It is rule 4 of this file's own list: nothing
   * useful to say. There is no action, nothing changed, and it sat in the
   * space reserved for the one thing that ever needs to interrupt a verdict —
   * the question Vibe is waiting on.
   *
   * The fact itself was worth keeping and did not need a notice to carry it.
   * It is now a segment of the audit's own provenance line, beside the lens
   * and signal counts, which is where a reader already looks to find out what
   * this audit was made from.
   */
  if (input.hasSuccessfulDeepScan) return { kind: "none" };

  // Only offered where there is evidence to justify it. Suggesting a Deep Scan
  // for a product with no sign of a login would be noise on every audit.
  if (input.authenticatedSurfacesLikely) {
    return { kind: "deep_scan_suggested", canStartDeepScan: input.canStartDeepScan };
  }

  return { kind: "none" };
}

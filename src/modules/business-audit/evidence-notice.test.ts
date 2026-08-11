import { describe, expect, it } from "vitest";
import { buildAuditEvidenceNotice, type AuditEvidenceNoticeInput } from "./evidence-notice";

/**
 * The Deep Scan notice above the audit (Sprint 6 §11, §13).
 *
 * "Appears only when appropriate" is the requirement, so the negative cases
 * matter more than the positive ones: a suggestion on every audit would be
 * noise, and a stale banner that never clears would be a lie.
 */

function notice(overrides: Partial<AuditEvidenceNoticeInput> = {}) {
  return buildAuditEvidenceNotice({
    hasSuccessfulDeepScan: false,
    authenticatedSurfacesLikely: false,
    canStartDeepScan: true,
    auditPredatesDeepScan: false,
    ...overrides,
  });
}

describe("buildAuditEvidenceNotice", () => {
  it("says nothing when there is no sign of a signed-in product", () => {
    expect(notice()).toEqual({ kind: "none" });
  });

  it("suggests a Deep Scan when surfaces are detected but none has run", () => {
    expect(notice({ authenticatedSurfacesLikely: true })).toEqual({
      kind: "deep_scan_suggested",
      canStartDeepScan: true,
    });
  });

  it("still explains the gap when a Deep Scan cannot be started right now", () => {
    // The notice is informational; it must not vanish just because the action
    // behind it is unavailable.
    expect(notice({ authenticatedSurfacesLikely: true, canStartDeepScan: false })).toEqual({
      kind: "deep_scan_suggested",
      canStartDeepScan: false,
    });
  });

  it("stops suggesting once a Deep Scan has succeeded", () => {
    expect(notice({ hasSuccessfulDeepScan: true, authenticatedSurfacesLikely: true })).toEqual({
      kind: "deep_scan_ready",
    });
  });

  it("reports staleness when the displayed audit predates the Deep Scan", () => {
    expect(notice({ hasSuccessfulDeepScan: true, auditPredatesDeepScan: true })).toEqual({
      kind: "deep_scan_stale",
    });
  });

  it("cannot report staleness without a Deep Scan to be stale against", () => {
    expect(notice({ auditPredatesDeepScan: true })).toEqual({ kind: "none" });
  });
});

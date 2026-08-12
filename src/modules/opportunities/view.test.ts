import { describe, expect, it } from "vitest";
import { OPERATION_FAILURE_MESSAGES } from "@/modules/operations/messages";
import type { OpportunityBlockReason } from "./service";
import { BUSINESS_AUDIT_ANCHOR, buildOpportunityBlockNotice } from "./view";

/**
 * The blocked state of the Opportunities section (Sprint 8 §34).
 *
 * One invariant carries the whole file: **a block always offers a way out.**
 * Deep Scan shipped a dead end twice — a heading, a sentence, a disabled
 * button, nothing to click — and both times it was reported as the feature
 * being broken. This is the test that stops the third time.
 */

const ALL_REASONS: OpportunityBlockReason[] = ["audit_missing", "audit_stale"];

describe("buildOpportunityBlockNotice", () => {
  it("says nothing when generation is available", () => {
    expect(buildOpportunityBlockNotice(null)).toBeNull();
  });

  it.each(ALL_REASONS)("gives %s an action and somewhere to go", (reason) => {
    const notice = buildOpportunityBlockNotice(reason);

    expect(notice).not.toBeNull();
    expect(notice?.actionLabel.length).toBeGreaterThan(0);
    expect(notice?.anchor).toBe(BUSINESS_AUDIT_ANCHOR);
  });

  it.each(ALL_REASONS)("has user-facing copy for %s", (reason) => {
    // The panel renders this message beside the action. A reason with an
    // action but no explanation is only half a way out.
    expect(OPERATION_FAILURE_MESSAGES[reason]).toBeTruthy();
  });

  it("asks for a first audit rather than an update when none exists", () => {
    expect(buildOpportunityBlockNotice("audit_missing")?.actionLabel).toContain("Run");
    expect(buildOpportunityBlockNotice("audit_stale")?.actionLabel).toContain("Update");
  });
});

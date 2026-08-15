import { describe, expect, it } from "vitest";
import type { AuditEventType } from "./events";
import type { AuditEventRecord } from "./queries";
import { buildActivityEntry, buildActivityFeed, toneFor } from "./view";

function record(
  eventType: AuditEventType,
  metadata: Record<string, unknown> = {},
): AuditEventRecord {
  return { id: "evt_1", eventType, createdAt: "2026-08-14T13:34:00.000Z", metadata };
}

describe("activity tone", () => {
  it("never renders a failure as anything but a problem", () => {
    const failures: AuditEventType[] = [
      "change_merge.failed",
      "change_validation.failed",
      "deep_scan.failed",
      "business_audit.failed",
      "change_outcome.failed",
    ];
    for (const eventType of failures) {
      expect(toneFor(eventType), eventType).toBe("problem");
    }
  });

  it("keeps honest non-results out of the failure bucket", () => {
    // Sprint 12A's whole distinction: `not_observed` is about the customer's
    // product, `failed` is about Vibe. Collapsing them would tell a user their
    // change broke when Vibe simply could not see it yet.
    expect(toneFor("change_outcome.not_observed")).toBe("waiting");
    expect(toneFor("change_outcome.partial")).toBe("waiting");
    expect(toneFor("business_measurement.insufficient_data")).toBe("waiting");
  });

  it("shows a refused merge as attention, not as an error", () => {
    // A blocked merge is the safety property working. Painting it red would
    // teach people to expect breakage from a guard doing its job.
    expect(toneFor("change_merge.blocked")).toBe("waiting");
    expect(toneFor("change_merge.not_eligible")).toBe("waiting");
    expect(toneFor("change_approval.invalidated")).toBe("waiting");
  });

  it("marks the one event that means bytes moved as a success", () => {
    expect(toneFor("change_merge.default_branch_updated")).toBe("success");
  });
});

describe("activity entries", () => {
  it("gives every event a human title rather than its identifier", () => {
    const entry = buildActivityEntry(record("change_merge.default_branch_updated"));
    expect(entry.title).toBe("Default branch updated");
    expect(entry.title).not.toContain("_");
  });

  it("shortens a commit sha the way the rest of the product does", () => {
    const entry = buildActivityEntry(
      record("change_approval.created", { commitSha: "2f05958e3410deaeb97029861abc05889139b4a7" }),
    );
    expect(entry.facts).toContainEqual({ label: "commit", value: "2f05958" });
  });

  it("shows a branch name in full", () => {
    const entry = buildActivityEntry(
      record("change_preparation.completed", { branchName: "vibe/seo-foundations-cc32273131c5" }),
    );
    expect(entry.facts).toContainEqual({
      label: "branch",
      value: "vibe/seo-foundations-cc32273131c5",
    });
  });

  it("never surfaces a metadata key outside the allowlist", () => {
    // The writers already refuse to log these. This is the second line: if one
    // ever does, the feed must not be the thing that publishes it.
    const entry = buildActivityEntry(
      record("change_preview.running", {
        previewOrigin: "https://leaky.example.com",
        signedUrl: "https://storage.example.com/x?token=secret",
        accessToken: "ghs_secret",
        branchName: "vibe/ok",
      }),
    );

    const rendered = JSON.stringify(entry.facts);
    expect(rendered).not.toContain("leaky.example.com");
    expect(rendered).not.toContain("token=secret");
    expect(rendered).not.toContain("ghs_secret");
    expect(entry.facts).toContainEqual({ label: "branch", value: "vibe/ok" });
  });

  it("omits an absent or empty value rather than printing a placeholder", () => {
    const entry = buildActivityEntry(
      record("change_preparation.completed", { branchName: "", commitSha: null }),
    );
    expect(entry.facts).toEqual([]);
  });

  it("ignores non-scalar metadata rather than rendering [object Object]", () => {
    const entry = buildActivityEntry(
      record("change_preparation.completed", { branchName: { nested: true } }),
    );
    expect(entry.facts).toEqual([]);
  });

  it("prints one value per label when two keys mean the same thing", () => {
    const entry = buildActivityEntry(
      record("change_merge.verified", {
        commitSha: "2f05958e3410deaeb97029861abc05889139b4a7",
        mergedSha: "2f05958e3410deaeb97029861abc05889139b4a7",
      }),
    );
    expect(entry.facts.filter((fact) => fact.label === "commit")).toHaveLength(1);
  });

  it("preserves the order it was given, which is the query's order", () => {
    const feed = buildActivityFeed([
      { ...record("change_merge.verified"), id: "a" },
      { ...record("change_approval.created"), id: "b" },
    ]);
    expect(feed.map((entry) => entry.id)).toEqual(["a", "b"]);
  });
});

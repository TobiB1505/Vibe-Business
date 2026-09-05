import { describe, expect, it } from "vitest";
import type { CompletenessReason } from "./budgets";
import { completenessReasonLabel, completenessReasonsClause } from "./completeness-labels";

/**
 * The founder never reads a budget tracker's vocabulary (audit D12).
 *
 * `CompletenessReason` names a limit in Vibe's own analysis, and the human
 * view used to join those names straight into its sentence. This is the table
 * that stands between the two, and the assertions are about the one property
 * that matters: nothing on screen is an identifier, and nothing reads as a
 * fault in the customer's repository.
 */

const ALL: CompletenessReason[] = [
  "tree_truncated",
  "tree_entry_budget_reached",
  "file_budget_reached",
  "byte_budget_reached",
  "duration_budget_reached",
  "unsupported_structure",
];

describe("completeness reasons in a founder's words", () => {
  it("says something for every reason the tracker can record", () => {
    for (const reason of ALL) {
      const label = completenessReasonLabel(reason);
      expect(label.length, reason).toBeGreaterThan(10);
    }
  });

  it("never puts the identifier itself on screen", () => {
    for (const reason of ALL) {
      expect(completenessReasonLabel(reason)).not.toContain(reason);
      expect(completenessReasonLabel(reason)).not.toMatch(/_/);
    }
  });

  it("blames a limit Vibe sets, never the repository", () => {
    for (const reason of ALL) {
      const label = completenessReasonLabel(reason).toLowerCase();
      expect(label, reason).not.toMatch(/error|invalid|broken|malformed|fail/);
    }
  });

  it("writes one clause, however many reasons there are", () => {
    expect(completenessReasonsClause([])).toBe("");
    expect(completenessReasonsClause(["tree_truncated"])).toBe(
      completenessReasonLabel("tree_truncated"),
    );

    const two = completenessReasonsClause(["tree_truncated", "duration_budget_reached"]);
    expect(two).toContain(" and ");
    expect(two).not.toContain(", and");

    const three = completenessReasonsClause([
      "tree_truncated",
      "file_budget_reached",
      "duration_budget_reached",
    ]);
    expect(three).toContain(", ");
    expect(three).toContain(" and ");
  });
});

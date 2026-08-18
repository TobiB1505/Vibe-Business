import { describe, expect, it } from "vitest";
import { checkedValues } from "@/modules/operations/migration-test-support";
import { DETERMINISTIC_EXECUTION_CAPABILITIES } from "@/modules/execution/schema";
import {
  EXECUTION_ACTIVITY_EVENTS,
  EXECUTION_ADMISSION_REFUSALS,
  EXECUTION_CLASSES,
  EXECUTION_MODES,
  EXECUTION_RESOLUTION_REASONS,
  EXECUTION_RISK_CLASSES,
  VIBE_EXECUTABLE_MODES,
  riskExceeds,
} from "./schema";
import {
  EXECUTION_ACTIVITY_LABELS,
  EXECUTION_ADMISSION_LABELS,
  EXECUTION_MODE_LABELS,
  EXECUTION_REASON_LABELS,
  EXECUTION_RISK_LABELS,
} from "./view";

/**
 * Where the TypeScript unions and the SQL CHECK constraints must agree
 * (EXECUTION CORE-3 §36, §55).
 *
 * The in-memory test database does not evaluate constraints, so no behavioural
 * test can see these drift. This project has been bitten twice — see
 * `operations/migration-test-support.ts` — and the fix was to read the
 * migration history directly.
 */

describe("SQL and TypeScript agree", () => {
  it("permits exactly the executable modes in the mode column", () => {
    // Deliberately narrower than `EXECUTION_MODES`: a spec exists only for work
    // Vibe could carry out, so `blocked` and `needs_user_input` must not be
    // storable at all.
    expect(checkedValues("execution_specs", "mode").sort()).toEqual(
      [...VIBE_EXECUTABLE_MODES].sort(),
    );
  });

  it("permits exactly the declared execution classes", () => {
    expect(checkedValues("execution_specs", "execution_class").sort()).toEqual(
      [...EXECUTION_CLASSES].sort(),
    );
  });

  it("permits exactly the declared risk classes", () => {
    expect(checkedValues("execution_specs", "risk_class").sort()).toEqual(
      [...EXECUTION_RISK_CLASSES].sort(),
    );
  });

  /**
   * Deterministic capabilities only, and that is the whole point of the column.
   *
   * A spec's `capability` is non-null exactly when a registry-backed generator
   * matched — the resolver leaves it null for every agentic resolution. The
   * agentic capability (EXECUTION CORE-4) is recorded on the `PreparedChange`
   * instead, where it says what produced the bytes. Permitting it here would
   * let a spec claim a deterministic executor that does not exist, which is the
   * distinction the six-value mode enum was built to protect.
   */
  it("permits exactly the deterministic capabilities the execution module declares", () => {
    expect(checkedValues("execution_specs", "capability").sort()).toEqual(
      [...DETERMINISTIC_EXECUTION_CAPABILITIES].sort(),
    );
  });
});

describe("risk ordering", () => {
  it("orders the four classes from low to prohibited", () => {
    expect(riskExceeds("low", "moderate")).toBe(false);
    expect(riskExceeds("moderate", "moderate")).toBe(false);
    expect(riskExceeds("high", "moderate")).toBe(true);
    expect(riskExceeds("prohibited", "high")).toBe(true);
  });
});

describe("customer-safe copy exists for every internal enum (§5)", () => {
  it("labels every mode", () => {
    for (const mode of EXECUTION_MODES) {
      expect(EXECUTION_MODE_LABELS[mode].length).toBeGreaterThan(0);
    }
  });

  it("labels every risk class", () => {
    for (const risk of EXECUTION_RISK_CLASSES) {
      expect(EXECUTION_RISK_LABELS[risk].length).toBeGreaterThan(0);
    }
  });

  it("labels every resolution reason", () => {
    for (const reason of EXECUTION_RESOLUTION_REASONS) {
      expect(EXECUTION_REASON_LABELS[reason].length).toBeGreaterThan(0);
    }
  });

  it("labels every admission refusal", () => {
    for (const refusal of EXECUTION_ADMISSION_REFUSALS) {
      expect(EXECUTION_ADMISSION_LABELS[refusal].length).toBeGreaterThan(0);
    }
  });

  it("labels every activity state", () => {
    for (const event of EXECUTION_ACTIVITY_EVENTS) {
      expect(EXECUTION_ACTIVITY_LABELS[event].length).toBeGreaterThan(0);
    }
  });

  it("never renders an internal enum value as customer copy", () => {
    const copy = [
      ...Object.values(EXECUTION_MODE_LABELS),
      ...Object.values(EXECUTION_RISK_LABELS),
      ...Object.values(EXECUTION_REASON_LABELS),
      ...Object.values(EXECUTION_ADMISSION_LABELS),
      ...Object.values(EXECUTION_ACTIVITY_LABELS),
    ];

    for (const sentence of copy) {
      expect(sentence).not.toMatch(/_[a-z]+_/);
      expect(sentence).not.toContain("execution-spec.v");
    }
  });
});

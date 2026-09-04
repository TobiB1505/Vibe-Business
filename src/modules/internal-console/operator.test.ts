import { describe, expect, it } from "vitest";
import { internalOperatorUserIds, isInternalOperator } from "./operator";

/**
 * The gate that replaces RLS for this surface ([ADR 0084](../../../docs/decisions/0084-the-internal-operator-console.md) §1, §2).
 *
 * Every other read in the application is bounded by a tenant. This one is
 * bounded by this function and nothing else, so the permissive cases are
 * asserted individually rather than covered by one happy path.
 */
describe("internal operator allowlist", () => {
  it("admits nobody when the variable is unset", () => {
    expect(internalOperatorUserIds({})).toEqual([]);
    expect(isInternalOperator("user-1", {})).toBe(false);
  });

  it("admits nobody when the variable is empty or only separators", () => {
    for (const raw of ["", "   ", ",", ",,", " , , "]) {
      expect(internalOperatorUserIds({ VIBE_INTERNAL_OPERATOR_USER_IDS: raw })).toEqual([]);
      expect(isInternalOperator("user-1", { VIBE_INTERNAL_OPERATOR_USER_IDS: raw })).toBe(false);
    }
  });

  it("admits exactly the ids named, and trims whitespace around them", () => {
    const env = { VIBE_INTERNAL_OPERATOR_USER_IDS: " user-1 , user-2 " };

    expect(internalOperatorUserIds(env)).toEqual(["user-1", "user-2"]);
    expect(isInternalOperator("user-1", env)).toBe(true);
    expect(isInternalOperator("user-2", env)).toBe(true);
    expect(isInternalOperator("user-3", env)).toBe(false);
  });

  it("never admits a signed-out caller", () => {
    const env = { VIBE_INTERNAL_OPERATOR_USER_IDS: "user-1" };

    expect(isInternalOperator(null, env)).toBe(false);
    expect(isInternalOperator(undefined, env)).toBe(false);
    expect(isInternalOperator("", env)).toBe(false);
  });

  it("matches the whole id, not a prefix of it", () => {
    const env = { VIBE_INTERNAL_OPERATOR_USER_IDS: "user-10" };

    expect(isInternalOperator("user-1", env)).toBe(false);
    expect(isInternalOperator("user-100", env)).toBe(false);
    expect(isInternalOperator("user-10", env)).toBe(true);
  });
});

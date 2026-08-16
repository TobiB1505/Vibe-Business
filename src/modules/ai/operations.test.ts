import { describe, expect, it } from "vitest";
import {
  BUSINESS_READINESS_AUDIT_CONFIG,
  getOperationConfig,
  PRODUCT_UNDERSTANDING_CONFIG,
} from "./operations";
import { resolvePricing } from "./pricing";
import type { AIOperation } from "./provider";

/**
 * Guards the pairing of a model with what that model can actually be asked
 * for (CORE-1 follow-up).
 *
 * Product Understanding shipped configured for Haiku 4.5 with `medium` effort.
 * Those two facts are individually reasonable and jointly impossible: Haiku
 * 4.5 predates adaptive thinking and the effort control and rejects a request
 * carrying either. Every run failed on its first call to the API, and because
 * that call is the free token count, it failed before it could spend anything
 * and reported a code that pointed nowhere near the cause.
 *
 * Nothing caught it, because nothing tied the two halves of the config
 * together. These tests are that tie.
 */

const OPERATIONS: AIOperation[] = [
  "business_readiness_audit",
  "opportunity_generation",
  "product_understanding",
];

/**
 * Models that support `thinking: {type: "adaptive"}` and `output_config.effort`.
 *
 * An explicit list rather than a version-string heuristic. Parsing a model id
 * to guess a generation is how you end up confidently wrong about the next
 * model that does not follow the pattern; a name that has been checked against
 * the provider's documentation is a fact, and an unknown name failing this
 * test is the correct outcome.
 */
const ADAPTIVE_CAPABLE_MODELS = ["claude-sonnet-5", "claude-opus-5"];

describe("operation configs", () => {
  it.each(OPERATIONS)("only asks %s for reasoning its model supports", (operation) => {
    const config = getOperationConfig(operation);
    if (config.reasoning.mode !== "adaptive") return;

    expect(
      ADAPTIVE_CAPABLE_MODELS,
      `${config.model} is configured for adaptive thinking and an effort level. ` +
        "If that model genuinely supports both, add it to ADAPTIVE_CAPABLE_MODELS. " +
        "If it does not, the request will be rejected by the API before anything runs.",
    ).toContain(config.model);
  });

  /**
   * An unpriced model throws `UnpricedModelError` when the usage ledger tries
   * to record the call — after the money has been spent. Cheaper to find here.
   */
  it.each(OPERATIONS)("has pricing configured for %s's model", (operation) => {
    const config = getOperationConfig(operation);
    expect(() => resolvePricing(config.model)).not.toThrow();
  });

  it("keeps Product Understanding off thinking and effort entirely", () => {
    // Named rather than left to the loop above: this is the specific
    // regression, and a test that says so is the one someone reads when they
    // are tempted to give this operation an effort level again.
    expect(PRODUCT_UNDERSTANDING_CONFIG.model).toBe("claude-haiku-4-5-20251001");
    expect(PRODUCT_UNDERSTANDING_CONFIG.reasoning).toEqual({ mode: "none" });
  });
});

/**
 * Timeouts are per operation (CORE-2a.3.2, after a real audit was discarded).
 *
 * A single client-level 120s default sat 13 seconds above the audit's real
 * duration. Growing the rubric pushed a complete, correct run past it, and the
 * whole call was thrown away at exactly 120,003ms — tokens generated, nothing
 * kept, and the founder shown "this took too long to complete".
 *
 * These assert the shape of the fix rather than specific numbers where the
 * number is a judgement call: every operation states its own, and the audit's
 * has real headroom over what audits actually take.
 */
describe("every operation states how long it may take", () => {
  it.each(["business_readiness_audit", "opportunity_generation", "product_understanding"] as const)(
    "%s declares a timeout",
    (operation) => {
      expect(getOperationConfig(operation).timeoutMs).toBeGreaterThan(0);
    },
  );

  /**
   * The longest audit ever recorded is 106.5s. Anything close to that is not
   * headroom — it is the same defect waiting for a slightly slower run.
   */
  it("gives the audit at least double its slowest observed run", () => {
    expect(BUSINESS_READINESS_AUDIT_CONFIG.timeoutMs).toBeGreaterThanOrEqual(213_000);
  });

  /**
   * The point of moving this off the transport. A shared default has to be
   * wrong for one of them, and these two differ by an order of magnitude.
   */
  it("does not give a Haiku extraction the same budget as a nine-lens audit", () => {
    expect(PRODUCT_UNDERSTANDING_CONFIG.timeoutMs).toBeLessThan(
      BUSINESS_READINESS_AUDIT_CONFIG.timeoutMs,
    );
  });
});

/**
 * The token ceiling and the time ceiling have to agree.
 *
 * Two real failures on the same audit, one after the other: a 120s timeout
 * discarded a complete answer, and then a 16,000-token ceiling truncated one
 * mid-object with $0.1965 already billed. Both were budgets set when the
 * operation was smaller.
 *
 * Fixing them independently is how you get a third failure. Generation runs at
 * a steady ~9.8 ms per output token across every measured audit, so a token
 * budget implies a duration — and a token budget the timeout can never reach is
 * not a budget, it is a number that looks like one.
 */
describe("output and time budgets are coherent", () => {
  /** Measured across four real audits: 9.0, 9.7, 9.9 and 10.8 ms per token. */
  const MS_PER_OUTPUT_TOKEN = 9.8;

  it.each(["business_readiness_audit", "opportunity_generation", "product_understanding"] as const)(
    "%s can generate its whole output budget before its timeout",
    (operation) => {
      const config = getOperationConfig(operation);
      const implied = config.maxOutputTokens * MS_PER_OUTPUT_TOKEN;

      expect(
        implied,
        `${operation} allows ${config.maxOutputTokens} tokens (~${Math.round(implied / 1000)}s) but times out at ${config.timeoutMs / 1000}s`,
      ).toBeLessThanOrEqual(config.timeoutMs);
    },
  );

  /**
   * The other direction. The structured JSON alone is ~5,800 tokens at
   * production cardinality, and under adaptive thinking reasoning shares the
   * same budget — 11,172 tokens on the run that truncated. A ceiling without
   * real room above the payload is the defect this test exists to catch.
   */
  it("leaves the audit's reasoning room well above the JSON it must also emit", () => {
    const JSON_PAYLOAD_TOKENS = 5_800;
    const HIGHEST_OBSERVED_THINKING = 11_172;

    expect(BUSINESS_READINESS_AUDIT_CONFIG.maxOutputTokens).toBeGreaterThan(
      JSON_PAYLOAD_TOKENS + HIGHEST_OBSERVED_THINKING,
    );
  });
});

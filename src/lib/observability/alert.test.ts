import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { alertOperator } from "./alert";

const captureMessage = vi.fn();
vi.mock("@sentry/nextjs", () => ({ captureMessage: (...args: unknown[]) => captureMessage(...args) }));

/**
 * VB-012 — the conditions that were detected and went nowhere.
 *
 * Every one of them already ended in a `console.error` with the right context.
 * On Vercel that is a line in a stream nobody watches, which is
 * indistinguishable from not detecting it at all.
 */

afterEach(() => {
  vi.restoreAllMocks();
  captureMessage.mockClear();
});

describe("what reaches a person", () => {
  it("reports the condition to Sentry with its context", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    await alertOperator("[billing] drift", { creditAccountId: "account_1", postedDrift: 7 });

    expect(captureMessage).toHaveBeenCalledWith("[billing] drift", {
      level: "error",
      extra: { creditAccountId: "account_1", postedDrift: 7 },
    });
  });

  /**
   * One gateway refusal is ordinary; a burst is the signal. Warning level keeps
   * the ordinary case off a pager while still giving an alert rule a count to
   * read.
   */
  it("keeps a warning a warning", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await alertOperator("[agent-gateway] refused", { refusal: "token_rejected" }, "warning");

    expect(captureMessage).toHaveBeenCalledWith(
      "[agent-gateway] refused",
      expect.objectContaining({ level: "warning" }),
    );
  });
});

describe("the local log is not a fallback", () => {
  /**
   * A developer reading `vercel logs` must see exactly what they saw before
   * this existed, whether or not Sentry is configured or reachable.
   */
  it("logs first, and logs even when reporting fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    captureMessage.mockImplementation(() => {
      throw new Error("sentry is down");
    });

    await expect(alertOperator("[operations] expired", { operationId: "op_1" })).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledWith("[operations] expired", { operationId: "op_1" });
  });

  it("routes a warning to console.warn rather than console.error", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await alertOperator("[agent-gateway] refused", {}, "warning");

    expect(warn).toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});

describe("the signals the finding names are wired", () => {
  /**
   * The finding is a list — drift, settlement, staleness, gateway refusals,
   * webhook failures. A helper that exists and is called from three of five
   * places leaves the other two exactly as they were, which is the failure
   * worth pinning rather than the helper's own behaviour.
   */
  it.each([
    ["balance drift", join("modules", "credits", "service.ts")],
    ["lot drift", join("modules", "credits", "lot-store.ts")],
    ["a swept operation", join("modules", "operations", "staleness.ts")],
    ["a failed Stripe webhook", join("app", "api", "billing", "stripe", "webhook", "route.ts")],
    ["a gateway refusal", join("app", "api", "agent-gateway", "v1", "messages", "route.ts")],
    ["an orphaned hold", join("modules", "billing", "overview.ts")],
  ])("%s reaches the operator", (_condition, file) => {
    const source = readFileSync(join(process.cwd(), "src", file), "utf8");
    expect(source).toContain("alertOperator");
  });
});

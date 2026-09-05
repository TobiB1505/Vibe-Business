import { buildOperationView, type OperationView } from "@/modules/operations/view";
import type { OperationStage } from "@/modules/operations/schema";

/**
 * The onboarding states this sprint changed, in a real browser (UI-S1 §23).
 *
 * ## Why fixtures rather than a database
 *
 * The same reason as every other suite here: there is no isolated database
 * available, and the production one was ruled out and stays ruled out. So the
 * **real** components are handed the same operation views the real page builds,
 * and the browser does the rest for real — server render, hydration, the
 * disclosure, a phone-width layout.
 *
 * What that proves is what a founder sees in each state. What it does not prove
 * is that `page.tsx` picks the right state, which is covered by
 * `first-journey.test.ts` and by `audit-surface.test.ts` — the wiring and the
 * rule respectively. Three layers, and none of them is sufficient alone.
 *
 * ## Why the views are built rather than written
 *
 * `buildOperationView` decides `shouldPoll`, `retryAllowed` and `stalled`, and
 * those decisions are the interesting part of several of these states. A
 * hand-written object would let a fixture claim a combination the real builder
 * cannot produce — a stalled run that still polls, a retryable
 * `inference_interrupted` — and the browser would faithfully render something
 * that can never happen.
 */

/** Fixed so `stalled` is a property of the fixture, not of when it ran. */
const NOW = new Date("2026-08-17T12:00:00.000Z");
const STARTED = new Date("2026-08-17T11:59:30.000Z").toISOString();
/** Well past `OPERATION_STALL_THRESHOLD_MS`. */
const LONG_AGO = new Date("2026-08-17T11:00:00.000Z").toISOString();

function running(stage: OperationStage, startedAt = STARTED): OperationView {
  return buildOperationView(
    {
      operationId: "operation_e2e",
      status: "running",
      stage,
      failureCode: null,
      resultId: null,
      startedAt,
      completedAt: null,
      createdAt: startedAt,
    },
    NOW,
  );
}

function failed(failureCode: string): OperationView {
  return buildOperationView(
    {
      operationId: "operation_e2e",
      status: "failed",
      stage: "reading_code",
      failureCode,
      resultId: null,
      startedAt: STARTED,
      completedAt: NOW.toISOString(),
      createdAt: STARTED,
    },
    NOW,
  );
}

export const E2E_ONBOARDING_SCENARIOS = {
  /** Early in the run. The stage line should name reading the code. */
  onboarding_running: () => ({ operation: running("reading_code") }),
  /**
   * The same run, later.
   *
   * Its whole purpose is to differ from `onboarding_running`: the defect this
   * sprint fixed was a stage line that never changed, so the suite needs two
   * stages to compare rather than one to look at.
   */
  onboarding_running_late: () => ({ operation: running("understanding_product") }),
  /** Running far longer than the work can take. Polling has already stopped. */
  onboarding_stalled: () => ({ operation: running("understanding_product", LONG_AGO) }),
  /** A retryable failure: offering "Try again" here is honest. */
  onboarding_failed: () => ({ operation: failed("provider_unavailable") }),
  /**
   * A failure that may already have been billed.
   *
   * `retryAllowed` is false for this code, so the screen must not offer a
   * one-click retry — which is the thing worth seeing in a browser.
   */
  onboarding_failed_unclear: () => ({ operation: failed("inference_interrupted") }),
} as const;

export type E2eOnboardingScenario = keyof typeof E2E_ONBOARDING_SCENARIOS;

export function isE2eOnboardingScenario(value: string): value is E2eOnboardingScenario {
  return value in E2E_ONBOARDING_SCENARIOS;
}

/**
 * States with no operation behind them: the audit's two prerequisite shapes,
 * and a logo whose URL will not load.
 */
export const E2E_ONBOARDING_STATIC_SCENARIOS = [
  "onboarding_audit_parked",
  "onboarding_audit_awaiting",
  "onboarding_logo_broken",
  /*
   * The two facts the reveal asks a founder to confirm.
   *
   * The reveal needs a session, a project and a profile to reach, so the one
   * screen that asks the founder to check Vibe's work had no browser coverage
   * — which is how it kept a label and a value for as long as it did.
   */
  "onboarding_product_reveal",
] as const;

export type E2eOnboardingStaticScenario = (typeof E2E_ONBOARDING_STATIC_SCENARIOS)[number];

export function isE2eOnboardingStaticScenario(
  value: string,
): value is E2eOnboardingStaticScenario {
  return (E2E_ONBOARDING_STATIC_SCENARIOS as readonly string[]).includes(value);
}

import { createServiceClient } from "@/lib/supabase/service";
import { getBrowserSessionProvider } from "@/modules/authenticated-product-intelligence/browserbase/client";
import { createBrowserbaseCaptureProvider } from "@/modules/review/browserbase/capture";
import { REVIEW_POLICY } from "@/modules/review/policy";
import type { ReviewFailureCode } from "@/modules/review/schema";
import { createVercelSandboxProvider } from "@/modules/validation/vercel/provider";
import {
  captureReviewStep,
  completeReviewStep,
  failReviewStep,
  type ReviewDeps,
} from "./execution";

/**
 * The durable visual review (Sprint 11A §21).
 *
 * ```
 * capture (both sides, one session) ─▶ complete
 *              │
 *              └────────────────────▶ fail
 * ```
 *
 * Unreachable for new changes since Sprint 0114: a preview *is* the review now
 * (ADR 0065), and nothing starts this workflow. It stays so a historical
 * approval can still show what it was bound to. The screenshot retention sweep
 * that used to end this workflow moved to preview teardown, which still runs.
 *
 * Shorter than the validation and preview workflows because the work is
 * genuinely smaller: one browser session, two navigations, two uploads. It is
 * durable for authority rather than duration — the usage ledger has no INSERT
 * policy, so its write needs the service-role client, and only durable
 * execution may hold one (CLAUDE.md rule 53).
 *
 * ## Retries
 *
 * `capture` is `maxRetries = 0`. A platform retry cannot distinguish "the
 * browser session was never created" from "it ran and the result was lost", and
 * for a billed provider call that ambiguity must resolve to *not doing it
 * again*. Recovery is a fresh, explicit click — which is the same rule §23
 * applies to the first capture.
 */

function deps(): ReviewDeps {
  return {
    supabase: createServiceClient(),
    // The real adapters, only ever constructed here. Tests inject fakes that
    // open no browser and store nothing.
    capture: createBrowserbaseCaptureProvider(getBrowserSessionProvider(), {
      sessionTimeoutSeconds: REVIEW_POLICY.sessionTimeoutSeconds,
    }),
    sandbox: createVercelSandboxProvider(),
  };
}

async function captureReview(operationId: string) {
  "use step";
  return captureReviewStep(deps(), operationId);
}
// A browser session is billable and its outcome is not knowable from outside.
captureReview.maxRetries = 0;

async function finishReview(operationId: string) {
  "use step";
  await completeReviewStep(deps(), operationId);
}

async function abortReview(operationId: string, failureCode: ReviewFailureCode) {
  "use step";
  await failReviewStep(deps(), operationId, failureCode);
}

export async function changeReviewWorkflow(operationId: string) {
  "use workflow";

  let failureCode: ReviewFailureCode | null = null;

  try {
    const captured = await captureReview(operationId);
    if (!captured.ok) failureCode = captured.failureCode;
  } catch {
    // A step exhausted its retries or threw outside the returned-failure
    // convention. The error value is untyped and may carry provider prose, so
    // it is deliberately not inspected.
    failureCode = "review_failed";
  }

  if (failureCode !== null) {
    await abortReview(operationId, failureCode);
  } else {
    await finishReview(operationId);
  }
}

import { sleep } from "workflow";
import { createServiceClient } from "@/lib/supabase/service";
import { resolveDns } from "@/modules/live-product-intelligence/net/node-dns";
import { nodeHttpTransport } from "@/modules/live-product-intelligence/net/node-transport";
import { observationSchedule } from "@/modules/outcome-verification/schedule";
import type { OutcomeFailureCode } from "@/modules/outcome-verification/schema";
import {
  abortOutcomeStep,
  completeOutcomeOperationStep,
  concludeOutcomeStep,
  observeOutcomeStep,
  openOutcomeWindowStep,
  type OutcomeDeps,
  type OutcomeStepOutcome,
} from "./execution";

/**
 * The durable outcome verification (Sprint 12A §17, §18, §19, §42).
 *
 * ```
 * openWindow ─▶ observe(0) ─sleep─▶ observe(1) ─sleep─▶ … ─▶ conclude ─▶ complete
 *      │             │                    │                     │
 *      └─────────────┴────────────────────┴─────────────────────┴──▶ abort
 * ```
 *
 * The ninth operation type on the Sprint 7 foundation, and the first that
 * *waits*. Same shape as the others — thin `"use step"` shims over plain
 * functions, an operation id as the only thing crossing the durable boundary —
 * with one addition: `sleep()` between attempts, which is precisely why this
 * cannot be an HTTP request. Fifteen minutes is not a request, it is a process.
 *
 * ## Retries
 *
 * Every step here is read-only and idempotent, so the platform default retry is
 * appropriate and bounded to two attempts. This is the deliberate opposite of
 * `changeMergeWorkflow`, whose write step is `maxRetries = 0` because a retried
 * default-branch write can move somebody's repository twice. A retried
 * `GET /robots.txt` observes the same public file again (§19).
 *
 * ## What the schedule cannot do
 *
 * Extend itself. The offsets are a compile-time constant, the deadline is
 * written to the database once, and every attempt re-reads it. A replay walks
 * the identical loop and the journaled sleeps and steps return their recorded
 * results, so a resumed workflow neither re-observes nor pushes the window out
 * (§42).
 *
 * No model is called. No sandbox is created. No browser is opened. No GitHub
 * request is made, read or write. No deployment provider is contacted — Vibe
 * has none (§24, §28, §52).
 */

function deps(): OutcomeDeps {
  return {
    supabase: createServiceClient(),
    // The same DNS resolver and pinned-address transport live product
    // intelligence uses. Not a fetcher the step could swap for something
    // simpler — the address gate and the redirect revalidation are the reason
    // this module is allowed to make outbound requests at all (CLAUDE.md rule
    // 35, ADR 0010).
    http: { resolveDns, transport: nodeHttpTransport },
  };
}

async function openWindow(operationId: string) {
  "use step";
  return openOutcomeWindowStep(deps(), operationId);
}
openWindow.maxRetries = 2;

async function observe(operationId: string, attemptNumber: number) {
  "use step";
  return observeOutcomeStep(deps(), operationId, attemptNumber);
}
// Safe to retry, and this is the one place in the codebase where that sentence
// is uncontroversial: the step performs public GETs and overwrites a row with
// what it saw (§19).
observe.maxRetries = 2;

async function conclude(operationId: string) {
  "use step";
  return concludeOutcomeStep(deps(), operationId);
}
conclude.maxRetries = 2;

async function finish(operationId: string) {
  "use step";
  await completeOutcomeOperationStep(deps(), operationId);
}

async function abort(operationId: string, failureCode: OutcomeFailureCode) {
  "use step";
  await abortOutcomeStep(deps(), operationId, failureCode);
}

export async function changeOutcomeVerificationWorkflow(operationId: string) {
  "use workflow";

  let failure: OutcomeFailureCode | null = null;

  const record = (outcome: OutcomeStepOutcome): "stop" | "continue" => {
    if (outcome.ok) return outcome.done ? "stop" : "continue";
    failure = outcome.failureCode;
    return "stop";
  };

  try {
    if (record(await openWindow(operationId)) === "continue") {
      // The schedule is walked in full rather than looped on a clock, so a
      // replay takes the identical path and the journaled sleeps resolve
      // instantly instead of waiting again.
      const schedule = observationSchedule();

      let concluded = false;

      for (const attempt of schedule) {
        if (attempt.sleepMs > 0) await sleep(attempt.sleepMs);

        // Attempts are numbered from one in the record, because "0 attempts"
        // must keep meaning "we never looked".
        if (record(await observe(operationId, attempt.index + 1)) === "stop") {
          concluded = true;
          break;
        }
      }

      // Reached only when the window closed without every expectation holding.
      // `conclude` reads the recorded results and decides between partial,
      // not_observed and "we could not look" (§21, §22, §23).
      if (!concluded && failure === null) record(await conclude(operationId));
    }
  } catch {
    // A step exhausted its retries or threw outside the returned-failure
    // convention. The error value is untyped and may carry provider prose, so
    // it is deliberately not inspected. It becomes "Vibe could not observe" —
    // never a claim about the customer's product (§23).
    failure = "outcome_verification_failed";
  }

  if (failure !== null) {
    await abort(operationId, failure);
    return;
  }

  await finish(operationId);
}

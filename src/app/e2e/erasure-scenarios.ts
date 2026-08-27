import type { ErasureViewState } from "@/modules/operations/account-erasure/view";

/**
 * Browser fixtures for the account erasure control (ADR 0056 §4).
 *
 * ## Why this one is browser-tested at all
 *
 * Rule 69's third question. `view.test.ts` proves the state machine and
 * `delete-account-ui.test.ts` proves what copy the component *can* render —
 * neither proves that a person looking at the screen can see it. For the single
 * irreversible action in this product, "the copy exists in the file" is not the
 * same claim as "the copy is on the screen before the button is".
 *
 * ## Why three scenarios and not one
 *
 * The three states render completely differently, and two of them are the ones
 * that go wrong quietly: a running erasure must not show an inviting button,
 * and a failed one must not look like nothing ever happened.
 */
export const E2E_ERASURE_SCENARIOS = {
  "account-erasure-idle": (): ErasureViewState => ({ kind: "idle" }),
  "account-erasure-running": (): ErasureViewState => ({ kind: "running" }),
  "account-erasure-failed": (): ErasureViewState => ({
    kind: "failed",
    reason: "stripe_cancel_failed",
  }),
} as const;

export type E2eErasureScenario = keyof typeof E2E_ERASURE_SCENARIOS;

export function isE2eErasureScenario(value: string): value is E2eErasureScenario {
  return value in E2E_ERASURE_SCENARIOS;
}

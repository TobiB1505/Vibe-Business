import { creditsToUnits } from "@/modules/credits/units";
import type { AuditCreditGate } from "@/modules/business-audit/entitlement";

/**
 * The spent-entitlement states of the score page (BILLING CORE-2 §39, §43).
 *
 * ## Why these needed a browser
 *
 * Because the defect they exist to prevent was invisible to everything else.
 * The domain was correct — `startBusinessAudit` had been routing
 * `credits_required` into a Credit reservation since Core-2 — and the screen
 * still showed a disabled "Re-run business audit", the price "35 Credits"
 * beside it, and a notice saying credits "aren't available yet", on an account
 * holding 6,080. Three elements, one screen, mutually contradictory, and every
 * unit test green (CLAUDE.md rule 69).
 *
 * The claim under test is therefore not a string. It is the **agreement**
 * between the button's enabled state, the price beside it and the sentence
 * below it — which is a property of a rendered page and of nothing smaller.
 *
 * The gate itself comes from the real `resolveAuditCreditGate` type, and the
 * harness derives `disabled` from the real `auditBlockedByCredits`, so a change
 * to either reaches the browser rather than leaving a fixture behind.
 */

export const E2E_AUDIT_CREDIT_SCENARIOS = {
  /** The reported case: entitlement spent, wallet funded. Payable. */
  "audit-credits-payable": {
    gate: {
      kind: "payable",
      requiredCredits: creditsToUnits(35),
      availableCredits: creditsToUnits(6_080),
    },
  },

  /** Payable in principle, not today. The one remaining wall. */
  "audit-credits-short": {
    gate: {
      kind: "unaffordable",
      requiredCredits: creditsToUnits(35),
      availableCredits: creditsToUnits(20),
    },
  },

  /** Exact change. A boundary that blocks here keeps money for nothing. */
  "audit-credits-exact": {
    gate: {
      kind: "payable",
      requiredCredits: creditsToUnits(35),
      availableCredits: creditsToUnits(35),
    },
  },
} as const satisfies Record<string, { gate: AuditCreditGate }>;

export type E2eAuditCreditScenario = keyof typeof E2E_AUDIT_CREDIT_SCENARIOS;

export function isE2eAuditCreditScenario(value: string): value is E2eAuditCreditScenario {
  return Object.hasOwn(E2E_AUDIT_CREDIT_SCENARIOS, value);
}

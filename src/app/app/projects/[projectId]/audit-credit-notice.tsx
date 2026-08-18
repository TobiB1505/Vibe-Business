import Link from "next/link";

import { Notice } from "@/components/ui/states";
import type { AuditCreditGate } from "@/modules/business-audit/entitlement";
import { formatCreditsForDisplay } from "@/modules/credits/units";

/**
 * What the score page says about a spent audit entitlement
 * (BILLING CORE-2 §39, §43, §55).
 *
 * ## Why this is a component and not four lines of JSX in the page
 *
 * Because the defect it replaces was invisible to every test that existed. The
 * domain was right — `startBusinessAudit` had been routing `credits_required`
 * into a reservation since Core-2 — and the screen still said "credits … aren't
 * available yet" beside a 35-Credit price on an account holding thousands, with
 * the button disabled. Nothing failed. There was simply no test that could see
 * a screen (CLAUDE.md rule 69).
 *
 * A page body cannot be rendered in the browser harness; a component can. So
 * the sentence lives here, and `e2e/business-audit.spec.ts` reads it in a real
 * browser for every state of the gate.
 *
 * ## What it will not do
 *
 * No urgency, no "upgrade", no repetition of the price already rendered beside
 * the button. The customer is told what it costs and what they hold, and left
 * to decide.
 */
export function AuditCreditNotice({ gate }: { gate: AuditCreditGate }) {
  switch (gate.kind) {
    case "not_applicable":
      return null;

    case "payable":
      // A price, drawn as information rather than as an obstacle. The button
      // beside it is enabled, and this sentence must not imply otherwise.
      return (
        <Notice tone="info" label="Included audit used">
          You&rsquo;ve used the free audit for this project. Running another one costs{" "}
          {formatCreditsForDisplay(gate.requiredCredits)} Credits, and you have{" "}
          {formatCreditsForDisplay(gate.availableCredits)}.
        </Notice>
      );

    case "unaffordable":
      // The only remaining wall — and it names which number is short, rather
      // than claiming Credits are unavailable in general (§43).
      return (
        <Notice tone="waiting" label="Not enough Credits">
          Another business audit costs {formatCreditsForDisplay(gate.requiredCredits)} Credits. You
          have {formatCreditsForDisplay(gate.availableCredits)}.{" "}
          <Link href="/app/billing" className="underline underline-offset-2">
            Top up
          </Link>{" "}
          to run another one.
        </Notice>
      );

    case "unpriced":
      // No price resolved. Saying "not enough Credits" here would be a guess
      // about the customer's wallet to explain a gap in ours.
      return (
        <Notice tone="waiting" label="Not available">
          You&rsquo;ve used the free audit for this project, and another one isn&rsquo;t priced
          right now.
        </Notice>
      );
  }
}

import Link from "next/link";

import { cn } from "@/lib/utils/cn";
import type { AuditCreditGate } from "@/modules/business-audit/entitlement";
import { formatCreditsForDisplay } from "@/modules/credits/units";

function AuditStatusIcon({ tone }: { tone: "mint" | "amber" }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-full border",
        tone === "mint"
          ? "border-mint/25 bg-mint/[0.08] text-mint"
          : "border-amber/25 bg-amber/[0.08] text-amber",
      )}
    >
      {tone === "mint" ? (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          className="size-[1.1rem]"
        >
          <path
            d="m7 12 3.2 3.2L17.5 8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          className="size-[1.1rem]"
        >
          <path
            d="M12 8v5m0 3.2v.1M4.8 19h14.4a1.3 1.3 0 0 0 1.1-2L13.1 4.5a1.3 1.3 0 0 0-2.2 0L3.7 17a1.3 1.3 0 0 0 1.1 2Z"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </span>
  );
}

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
 * No urgency and no "upgrade" framing. The customer is told what the next run
 * costs and what they hold, in the same command surface as the action, and is
 * left to decide.
 */
export function AuditCreditNotice({ gate }: { gate: AuditCreditGate }) {
  switch (gate.kind) {
    case "not_applicable":
      return null;

    case "payable":
      // A price, drawn as information rather than as an obstacle. The button
      // beside it is enabled, and this sentence must not imply otherwise.
      return (
        <div
          role="status"
          className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
          data-testid="audit-credit-status"
        >
          <div className="flex min-w-0 items-center gap-3">
            <AuditStatusIcon tone="mint" />
            <div className="min-w-0">
              <p className="text-fg text-sm font-semibold">Included audit used</p>
              <p className="text-fg-muted mt-0.5 text-xs leading-relaxed">
                Your included audit is complete. Running another one costs{" "}
                <span className="text-fg-secondary font-medium">
                  {formatCreditsForDisplay(gate.requiredCredits)} Credits
                </span>
                .
              </p>
            </div>
          </div>
          <div className="border-line-1 flex shrink-0 items-baseline gap-2 sm:border-l sm:pl-4">
            <span className="text-fg-meta text-[0.65rem] tracking-[0.12em] uppercase">
              Available
            </span>
            <span className="text-fg text-sm font-semibold tabular-nums">
              {formatCreditsForDisplay(gate.availableCredits)} Credits
            </span>
          </div>
        </div>
      );

    case "unaffordable":
      // The only remaining wall — and it names which number is short, rather
      // than claiming Credits are unavailable in general (§43).
      return (
        <div
          role="status"
          className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
          data-testid="audit-credit-status"
        >
          <div className="flex min-w-0 items-center gap-3">
            <AuditStatusIcon tone="amber" />
            <div className="min-w-0">
              <p className="text-fg text-sm font-semibold">Not enough Credits</p>
              <p className="text-fg-muted mt-0.5 text-xs leading-relaxed">
                Another business audit costs {formatCreditsForDisplay(gate.requiredCredits)} Credits.
                You have {formatCreditsForDisplay(gate.availableCredits)}.
              </p>
            </div>
          </div>
          <Link
            href="/app/billing"
            className="border-amber/30 bg-amber/[0.08] text-amber hover:border-amber/55 hover:bg-amber/[0.12] inline-flex min-h-10 shrink-0 items-center justify-center rounded-xl border px-4 text-sm font-semibold transition-interactive focus-visible:ring-2 focus-visible:ring-amber"
          >
            Top up Credits
          </Link>
        </div>
      );

    case "unpriced":
      // No price resolved. Saying "not enough Credits" here would be a guess
      // about the customer's wallet to explain a gap in ours.
      return (
        <div
          role="status"
          className="flex min-w-0 items-center gap-3"
          data-testid="audit-credit-status"
        >
          <AuditStatusIcon tone="amber" />
          <div className="min-w-0">
            <p className="text-fg text-sm font-semibold">Another audit is not available yet</p>
            <p className="text-fg-muted mt-0.5 text-xs leading-relaxed">
              Your included audit is complete, but another run is not priced right now.
            </p>
          </div>
        </div>
      );
  }
}

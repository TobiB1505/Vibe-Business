import { Notice } from "@/components/ui/states";
import { Surface } from "@/components/ui/surface";
import { MonoLabel, SectionHeader } from "@/components/ui/typography";
import { listCreditPacks, listPaidPlans } from "@/modules/billing/catalog";
import type { BillingOverview } from "@/modules/billing/overview";
import { RETAIL_OPERATION_KINDS, resolveRetailPrice } from "@/modules/credits/retail";
import { formatCreditUnits } from "@/modules/credits/units";
import {
  BuyCreditPackForm,
  ClaimWelcomeCreditsForm,
  ManageBillingForm,
  StartPlanForm,
} from "./purchase-forms";

/**
 * The billing screen's body (BILLING CORE-2 §49–§53, §93, §94).
 *
 * Presentational and prop-driven, exactly like `AuditOverview` and
 * `OpportunitiesPanel`. The page assembles the overview from Supabase and hands
 * it here; the browser suite hands it fixtures. Both render the same component,
 * so the suite cannot pass on a screen the product does not actually show.
 *
 * ## The five questions, in the order a founder asks them
 *
 * ```
 * How many Credits do I have?      the balance, first and largest
 * What plan am I on?               and what that gives them
 * How can I get more?              the packs
 * What does everything cost?       the price list
 * What did I recently spend on?    a short history, last
 * ```
 *
 * Nothing else. No lots, no allocations, no reservations, no provider cost, no
 * tokens, no nanodollars (§50, §52), and no raw enums (§53) — the shape of
 * `BillingOverview` is what keeps them off the screen rather than a rule about
 * not rendering them.
 */

/** Checkout return states. Neither adds a Credit — only a webhook does (§25). */
export const CHECKOUT_NOTICES: Record<
  string,
  { tone: "waiting" | "info"; label: string; body: string }
> = {
  complete: {
    tone: "waiting",
    label: "Payment received",
    // Deliberately does not say "Credits added". At this moment Vibe genuinely
    // does not know — the browser came back from a redirect, and the money is
    // confirmed by a signed Stripe event that may not have arrived yet (§25,
    // §95). Claiming otherwise would be the one lie this page could tell.
    body: "Your payment is being confirmed. Your Credits will appear here within a moment.",
  },
  cancelled: {
    tone: "info",
    label: "Checkout cancelled",
    body: "Nothing was purchased and you weren't charged.",
  },
};

/** Customer names for the priced operations. Never the internal keys (§94). */
const OPERATION_NAMES: Record<string, string> = {
  business_audit: "Business Audit",
  opportunity_generation: "Next moves",
  action_plan: "Action Plan",
  product_understanding: "Understanding your product",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function formatPrice(cents: number): string {
  return `€${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

export function BillingView({
  overview,
  stripeReady,
  checkoutState,
}: {
  overview: BillingOverview;
  /** False when this deployment has no Stripe configuration at all. */
  stripeReady: boolean;
  checkoutState?: string;
}) {
  const notice = checkoutState ? CHECKOUT_NOTICES[checkoutState] : undefined;
  const packs = listCreditPacks();
  const plans = listPaidPlans();

  return (
    <div className="flex flex-col gap-10">
      <SectionHeader
        level={1}
        label="Billing"
        title="Credits"
        description="Credits pay for the work Vibe does for you. Product understanding is always free."
      />

      {notice && (
        <Notice tone={notice.tone} label={notice.label}>
          {notice.body}
        </Notice>
      )}

      {/* 1 — How many Credits do I have? (§50) */}
      <Surface level="card" padding="lg" className="flex flex-col gap-4">
        <MonoLabel>Available</MonoLabel>
        <p className="text-fg text-display font-bold tabular-nums" data-testid="credit-balance">
          {overview.displayAvailable}
          <span className="text-fg-meta text-title ml-3 font-normal">Credits</span>
        </p>

        {overview.nextExpiry && (
          <p className="text-fg-meta text-sm">
            {overview.nextExpiry.displayCredits} expire on {formatDate(overview.nextExpiry.expiresAt)}
          </p>
        )}

        {!overview.welcomeGranted && (
          <div className="border-line-2 flex flex-col gap-3 border-t pt-4">
            <p className="text-fg-prose text-sm">
              Your account is eligible for 100 Welcome Credits. They&rsquo;re valid for 30 days.
            </p>
            <ClaimWelcomeCreditsForm />
          </div>
        )}
      </Surface>

      {/* 2 — What plan am I on? (§51) */}
      <section className="flex flex-col gap-4">
        <SectionHeader label="Plan" title={`You're on ${overview.plan.name}`} />

        <Surface level="panel" padding="md" className="flex flex-col gap-3">
          {overview.plan.key === "free" ? (
            <p className="text-fg-prose text-sm">
              No monthly Credits. Your first Business Audit and first Deep Scan for each project are
              included.
            </p>
          ) : (
            <p className="text-fg-prose text-sm">
              {overview.plan.endingAtPeriodEnd
                ? `Your plan ends${overview.plan.renewsAt ? ` on ${formatDate(overview.plan.renewsAt)}` : ""}. Credits you've already been given stay until they expire, and any Credits you bought stay.`
                : overview.plan.renewsAt
                  ? `Renews on ${formatDate(overview.plan.renewsAt)}.`
                  : "Active."}
            </p>
          )}
          {stripeReady && overview.plan.key !== "free" && <ManageBillingForm />}
        </Surface>

        <div className="grid gap-4 sm:grid-cols-2">
          {plans.map((plan) => (
            <Surface key={plan.key} level="panel" padding="md">
              <StartPlanForm
                planKey={plan.key}
                planName={plan.name}
                price={`${formatPrice(plan.priceCents)} / month`}
                credits={formatCreditUnits(plan.monthlyCreditUnits)}
                disabled={!stripeReady}
                current={overview.plan.key === plan.key}
              />
            </Surface>
          ))}
        </div>
      </section>

      {/* 3 — How can I get more? (§52) */}
      <section className="flex flex-col gap-4">
        <SectionHeader
          label="Top up"
          title="Get more Credits"
          description="One-off purchases. These don't reset each month."
        />

        <div className="grid gap-4 sm:grid-cols-3">
          {packs.map((pack) => (
            <Surface key={pack.key} level="panel" padding="md">
              <BuyCreditPackForm
                packKey={pack.key}
                credits={pack.credits.toLocaleString("en-GB")}
                price={formatPrice(pack.priceCents)}
                disabled={!stripeReady}
              />
            </Surface>
          ))}
        </div>

        {!stripeReady && (
          <Notice tone="info" label="Not available yet">
            Payments aren&rsquo;t set up on this deployment yet, so Credits can&rsquo;t be purchased.
          </Notice>
        )}
      </section>

      {/* 4 — What does everything cost? (§55) */}
      <section className="flex flex-col gap-4">
        <SectionHeader label="Prices" title="What things cost" />

        <Surface level="panel" padding="none">
          <ul className="divide-line-2 divide-y">
            {RETAIL_OPERATION_KINDS.map((operation) => {
              const resolved = resolveRetailPrice(operation);
              if (!resolved) return null;

              return (
                <li key={operation} className="flex items-center justify-between gap-4 px-5 py-4">
                  <span className="text-fg-body text-sm">{OPERATION_NAMES[operation]}</span>
                  <span className="text-fg text-sm font-semibold tabular-nums">
                    {resolved.price.kind === "free"
                      ? "Free"
                      : `${formatCreditUnits(resolved.price.creditUnits)} Credits`}
                  </span>
                </li>
              );
            })}
          </ul>
        </Surface>
      </section>

      {/* 5 — What did I recently spend Credits on? (§53) */}
      <section className="flex flex-col gap-4">
        <SectionHeader label="History" title="Recent activity" />

        {overview.recentActivity.length === 0 ? (
          <Surface level="panel" padding="md">
            <p className="text-fg-meta text-sm">Nothing yet.</p>
          </Surface>
        ) : (
          <Surface level="panel" padding="none">
            <ul className="divide-line-2 divide-y">
              {overview.recentActivity.map((entry) => (
                <li key={entry.id} className="flex items-center justify-between gap-4 px-5 py-4">
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="text-fg-body truncate text-sm">{entry.label}</span>
                    <span className="text-fg-meta text-ui">{formatDate(entry.at)}</span>
                  </div>
                  <span
                    className={
                      entry.creditDelta > 0
                        ? "text-mint text-sm font-semibold tabular-nums"
                        : "text-fg-body text-sm font-semibold tabular-nums"
                    }
                  >
                    {/* The sign carries the meaning, so it is never colour
                        alone (§93) — a "+" and a "-" are readable without it. */}
                    {entry.displayAmount}
                  </span>
                </li>
              ))}
            </ul>
          </Surface>
        )}
      </section>
    </div>
  );
}

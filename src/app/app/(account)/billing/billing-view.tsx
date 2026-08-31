import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import {
  ArrowRightIcon,
  CheckIcon,
  InfoIcon,
  LockIcon,
  PlusIcon,
  SparklesIcon,
} from "@/components/ui/dashboard-icons";
import { Notice } from "@/components/ui/states";
import { Surface } from "@/components/ui/surface";
import { MonoLabel, SectionHeader } from "@/components/ui/typography";
import { getPlan, listCreditPacks, listPaidPlans } from "@/modules/billing/catalog";
import type { BillingOverview, CreditActivityEntry } from "@/modules/billing/overview";
import {
  RETAIL_OPERATION_KINDS,
  resolveRetailPrice,
  retailChargeFor,
  type ResolvedRetailPrice,
  type RetailOperationKind,
} from "@/modules/credits/retail";
import {
  EXECUTION_PRICING_CLASSES,
  type ExecutionPricingClass,
} from "@/modules/economy/execution-class";
import { formatCreditsForDisplay, type CreditUnits } from "@/modules/credits/units";
import {
  BuyCreditPackForm,
  ClaimWelcomeCreditsForm,
  ManageBillingForm,
  StartPlanForm,
} from "./purchase-forms";

/** Checkout return states. A redirect never grants Credits; the webhook does. */
export const CHECKOUT_NOTICES: Record<
  string,
  { tone: "waiting" | "info"; label: string; body: string }
> = {
  complete: {
    tone: "waiting",
    label: "Payment received",
    body: "Your payment is being confirmed. Your Credits will appear here within a moment.",
  },
  cancelled: {
    tone: "info",
    label: "Checkout cancelled",
    body: "Nothing was purchased and you weren't charged.",
  },
};

const OPERATION_NAMES: Record<RetailOperationKind, string> = {
  business_audit: "Business Audit",
  opportunity_generation: "Next moves",
  action_plan: "Action Plan",
  product_understanding: "Understanding your product",
  deep_scan: "Deep Scan (additional)",
  agent_execution: "Agent improvement",
};

/**
 * What a class-priced row shows instead of one number.
 *
 * Agent work costs one of three amounts and which one is decided by the step,
 * before anything runs. A price table has no step, so it shows all three rather
 * than a range or a "from" — a customer comparing plans needs to know the top
 * of the scale, and "from 150 Credits" hides exactly the number they would want
 * to budget against.
 */
const EXECUTION_CLASS_NAMES: Record<ExecutionPricingClass, string> = {
  small: "Focused",
  standard: "Standard",
  complex: "Broad",
};

/** One rendered row: an operation the policy in force actually sells. */
type PriceRow = {
  operation: RetailOperationKind;
  resolved: Omit<ResolvedRetailPrice, "price"> & {
    price: Exclude<ResolvedRetailPrice["price"], { kind: "not_priced" }>;
  };
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatPrice(cents: number): string {
  return `€${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

function expiryShare(overview: BillingOverview): number {
  if (!overview.nextExpiry || overview.availableCredits <= 0) return 0;
  return Math.min(100, Math.round((overview.nextExpiry.credits / overview.availableCredits) * 100));
}

function planTiming(overview: BillingOverview): string {
  if (overview.plan.key === "free") return "No renewal date";
  if (!overview.plan.renewsAt) return "Active subscription";
  return overview.plan.endingAtPeriodEnd
    ? `Ends on ${formatDate(overview.plan.renewsAt)}`
    : `Renews on ${formatDate(overview.plan.renewsAt)}`;
}

function activityIcon(entry: CreditActivityEntry) {
  if (entry.creditDelta > 0) return <PlusIcon size={17} />;
  return <SparklesIcon size={17} />;
}

/**
 * The reference composition, constrained to real billing data. This does not
 * fabricate a usage chart, product split, card suffix, invoices or an email:
 * none of those fields exist in `BillingOverview` yet.
 */
export function BillingView({
  overview,
  stripeReady,
  checkoutState,
  at = new Date(),
}: {
  overview: BillingOverview;
  stripeReady: boolean;
  checkoutState?: string;
  /**
   * The instant the price table resolves at. Defaults to now.
   *
   * A parameter rather than an implicit `new Date()`, so that the browser suite
   * can render this screen under a *future* policy. Without it the only page a
   * test could ever see is the one whose policy happens to be in force on the
   * day CI runs — which is how a repricing ships with a correct domain layer and
   * a screen nobody has looked at ([CLAUDE.md](../../../../CLAUDE.md) rule 69).
   *
   * It moves no money. Every reservation resolves its own price server-side
   * from the real clock; this only decides what is displayed.
   */
  at?: Date;
}) {
  const notice = checkoutState ? CHECKOUT_NOTICES[checkoutState] : undefined;
  const packs = listCreditPacks();
  const plans = listPaidPlans();
  const currentPlan = getPlan(overview.plan.key);
  const expiryPercent = expiryShare(overview);

  // Resolved once, so the table and the footnote below cannot disagree about
  // which prices exist.
  const priceRows = RETAIL_OPERATION_KINDS.map((operation) => ({
    operation,
    resolved: resolveRetailPrice(operation, at),
  })).filter((row): row is PriceRow => {
    // An operation the policy does not sell has no row at all. A "—" would
    // still be a claim about a price.
    return row.resolved !== null && row.resolved.price.kind !== "not_priced";
  });

  // Shown only when a row above actually needs it. A footnote explaining
  // agent tiers and Deep Scan under a policy that prices neither is a
  // statement about rows that are not on the page.
  const hasQualifiedPrice = priceRows.some((row) => row.resolved.basis !== "measured");

  return (
    <div className="flex flex-col gap-5 sm:gap-6">
      <SectionHeader level={1} title="Billing" description="Manage your plan, Credits and billing." />

      {notice && (
        <Notice tone={notice.tone} label={notice.label}>
          {notice.body}
        </Notice>
      )}

      <section aria-label="Billing overview" className="grid gap-4 lg:grid-cols-3">
        <Surface level="panel" padding="md" className="flex min-h-72 flex-col">
          <div className="flex items-start justify-between gap-4">
            <MonoLabel className="text-mint">Current plan</MonoLabel>
            <span aria-hidden="true" className="bg-mint-tint text-mint flex size-10 items-center justify-center rounded-full">
              <SparklesIcon size={20} />
            </span>
          </div>

          <h2 className="text-fg mt-4 text-[1.65rem] leading-none font-bold">{overview.plan.name}</h2>
          <p className="text-fg mt-2 flex items-baseline gap-1.5">
            <span className="text-title font-semibold">{formatPrice(currentPlan.priceCents)}</span>
            {currentPlan.priceCents > 0 && <span className="text-fg-muted text-sm">/ month</span>}
          </p>
          <p className={overview.plan.endingAtPeriodEnd ? "text-amber mt-2 text-sm" : "text-fg-muted mt-2 text-sm"}>
            {planTiming(overview)}
          </p>

          <ul className="mt-5 flex flex-col gap-2.5 text-sm">
            {overview.plan.key === "free" ? (
              <>
                <PlanBenefit>First Business Audit included</PlanBenefit>
                <PlanBenefit>First Deep Scan for each product</PlanBenefit>
                <PlanBenefit>No monthly charge</PlanBenefit>
              </>
            ) : (
              <>
                <PlanBenefit>{formatCreditsForDisplay(currentPlan.monthlyCreditUnits)} monthly Credits</PlanBenefit>
                <PlanBenefit>One-off top-ups stay available</PlanBenefit>
                <PlanBenefit>Renewal managed securely by Stripe</PlanBenefit>
              </>
            )}
          </ul>

          <div className="mt-auto pt-5">
            {overview.plan.key !== "free" && stripeReady ? (
              <ManageBillingForm />
            ) : overview.plan.key === "free" ? (
              <Link href="#plans" className={buttonClasses({ variant: "secondary", size: "sm" })}>
                View plans
                <ArrowRightIcon size={15} />
              </Link>
            ) : (
              <button type="button" disabled className={`${buttonClasses({ variant: "secondary", size: "sm" })} w-full`}>
                Management unavailable
              </button>
            )}
          </div>
        </Surface>

        <Surface level="panel" padding="md" className="flex min-h-72 flex-col">
          <MonoLabel className="text-mint">Available Credits</MonoLabel>
          <div className="mt-6 flex items-center justify-between gap-5">
            <div className="min-w-0">
              <p className="text-fg text-[2.65rem] leading-none font-bold tracking-[-0.04em] tabular-nums" data-testid="credit-balance">
                {overview.displayAvailable}
                <span className="sr-only"> Credits</span>
              </p>
              <p className="text-fg-muted mt-2 text-sm">Credits available</p>
            </div>

            <div
              className="relative flex size-28 shrink-0 items-center justify-center rounded-full p-3"
              style={{ background: `conic-gradient(var(--color-mint) 0 ${expiryPercent}%, var(--color-line-track) ${expiryPercent}% 100%)` }}
              aria-label={overview.nextExpiry ? `${expiryPercent}% of your available Credits expire next` : "No Credits currently have an expiry date"}
            >
              <div className="bg-app flex size-full flex-col items-center justify-center rounded-full">
                <span className="text-fg text-title font-bold tabular-nums">{overview.nextExpiry ? `${expiryPercent}%` : "—"}</span>
                <span className="text-fg-meta max-w-16 text-center text-[0.625rem] leading-tight">{overview.nextExpiry ? "next to expire" : "no expiry"}</span>
              </div>
            </div>
          </div>

          <div className="mt-5 min-h-10">
            {overview.nextExpiry ? (
              <p className="text-fg-prose text-sm">
                <span className="text-fg font-semibold tabular-nums">{overview.nextExpiry.displayCredits}</span>{" "}
                expire on {formatDate(overview.nextExpiry.expiresAt)}
              </p>
            ) : (
              <p className="text-fg-muted text-sm">No Credits currently have an expiry date.</p>
            )}
          </div>

          <a href="#credit-packs" className={`${buttonClasses({ variant: "primary", size: "sm" })} mt-auto w-full`}>
            Buy Credits
            <PlusIcon size={16} />
          </a>
        </Surface>

        <Surface level="panel" padding="md" className="flex min-h-72 flex-col">
          <div className="text-mint flex size-9 items-center justify-center"><SparklesIcon size={26} /></div>
          <h2 className="text-fg mt-4 text-title font-bold">How Credits work</h2>
          <p className="text-fg-prose mt-3 max-w-[34ch] text-sm leading-6">
            Credits power Vibe&rsquo;s business intelligence and Agent work. Each task uses a fixed amount, shown before you start it.
          </p>
          <a href="#credit-prices" className="text-mint mt-auto inline-flex items-center gap-2 self-start rounded-sm pt-5 text-sm font-semibold underline-offset-4 hover:underline">
            See Credit prices
            <ArrowRightIcon size={15} />
          </a>
        </Surface>
      </section>

      {!overview.welcomeGranted && (
        <Surface level="section" tone="mint" padding="md" className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <MonoLabel className="text-mint">Welcome Credits</MonoLabel>
            <p className="text-fg mt-2 font-semibold">Your account is eligible for 100 Welcome Credits.</p>
            <p className="text-fg-muted mt-1 text-sm">They are valid for 30 days.</p>
          </div>
          <ClaimWelcomeCreditsForm />
        </Surface>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(20rem,0.7fr)]">
        <Surface as="section" aria-labelledby="credit-prices-heading" id="credit-prices" level="panel" padding="none" className="scroll-mt-6 overflow-hidden">
          <div className="border-line-2 flex items-center justify-between gap-4 border-b px-5 py-5 sm:px-6">
            <div>
              <MonoLabel id="credit-prices-heading" as="h2" className="text-mint">Credit prices</MonoLabel>
              <p className="text-fg mt-2 font-semibold">Know the cost before you start</p>
            </div>
            <span className="text-fg-meta hidden items-center gap-1.5 text-xs sm:inline-flex"><InfoIcon size={14} /> Known before you start</span>
          </div>
          <ul className="divide-line-2 divide-y">
            {priceRows.map(({ operation, resolved }) => {
              const price = resolved.price;

              return (
                <li key={operation} className="flex items-start justify-between gap-4 px-5 py-4 sm:px-6">
                  <div className="flex min-w-0 items-center gap-3">
                    <span aria-hidden="true" className="bg-mint-tint text-mint flex size-9 shrink-0 items-center justify-center rounded-nav"><SparklesIcon size={16} /></span>
                    <span className="text-fg-body text-sm">
                      {OPERATION_NAMES[operation]}
                      {resolved.basis !== "measured" && (
                        <sup className="text-fg-meta ml-0.5 text-[0.65rem]">*</sup>
                      )}
                    </span>
                  </div>

                  {price.kind === "by_execution_class" ? (
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      {EXECUTION_PRICING_CLASSES.map((pricingClass) => (
                        <span key={pricingClass} className="flex items-baseline gap-2">
                          <span className="text-fg-meta text-xs">{EXECUTION_CLASS_NAMES[pricingClass]}</span>
                          <span className="text-fg text-sm font-semibold tabular-nums">
                            {formatCreditsForDisplay(price.creditUnitsByClass[pricingClass])} Credits
                          </span>
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span className="text-fg shrink-0 text-sm font-semibold tabular-nums">
                      {price.kind === "free"
                        ? "Free"
                        : `${formatCreditsForDisplay(price.creditUnits)} Credits`}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>

          {/*
            The footnote, not a badge.

            A badge next to a price reads as a property of the offer — "new",
            "popular", "discounted". This is a statement about Vibe's own
            confidence in the number, which is a smaller and more honest claim,
            and it belongs where a reader looks after the table rather than
            beside the figure they are trying to compare.
          */}
          {hasQualifiedPrice && (
            <p className="text-fg-meta border-line-2 border-t px-5 py-4 text-xs sm:px-6">
              <span aria-hidden="true">*</span> Agent prices scale with how broad a
              change is, and Vibe tells you which before you start. A Deep Scan
              price covers the browser session that reads your signed-in product.
            </p>
          )}
        </Surface>

        <Surface as="section" aria-labelledby="credit-packs-heading" id="credit-packs" level="panel" padding="none" className="scroll-mt-6 overflow-hidden">
          <div className="border-line-2 border-b px-5 py-5 sm:px-6">
            <MonoLabel id="credit-packs-heading" as="h2" className="text-mint">Top up Credits</MonoLabel>
            <p className="text-fg mt-2 font-semibold">One-off purchases</p>
          </div>
          <div className="divide-line-2 divide-y">
            {packs.map((pack) => (
              <BuyCreditPackForm key={pack.key} packKey={pack.key} credits={pack.credits.toLocaleString("en-GB")} price={formatPrice(pack.priceCents)} disabled={!stripeReady} />
            ))}
          </div>
        </Surface>
      </div>

      {!stripeReady && (
        <Notice tone="info" label="Not available yet">
          Payments aren&rsquo;t set up on this deployment yet, so Credits can&rsquo;t be purchased.
        </Notice>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(20rem,0.7fr)]">
        <Surface as="section" aria-labelledby="recent-activity-heading" level="panel" padding="none" className="overflow-hidden">
          <div className="border-line-2 flex items-center justify-between gap-4 border-b px-5 py-5 sm:px-6">
            <div>
              <MonoLabel id="recent-activity-heading" as="h2" className="text-mint">Recent usage</MonoLabel>
              <p className="text-fg mt-2 font-semibold">Latest Credit activity</p>
            </div>
            <span className="text-fg-meta text-xs">Newest first</span>
          </div>
          {overview.recentActivity.length === 0 ? (
            <p className="text-fg-muted px-5 py-8 text-sm sm:px-6">Nothing yet.</p>
          ) : (
            <ul className="divide-line-2 divide-y">
              {overview.recentActivity.map((entry) => (
                <li key={entry.id} className="flex items-center justify-between gap-4 px-5 py-4 sm:px-6">
                  <div className="flex min-w-0 items-center gap-3">
                    <span aria-hidden="true" className="bg-mint-tint text-mint flex size-9 shrink-0 items-center justify-center rounded-nav">{activityIcon(entry)}</span>
                    <div className="flex min-w-0 flex-col gap-1">
                      <span className="text-fg-body truncate text-sm font-medium">{entry.label}</span>
                      <span className="text-fg-meta text-xs">{formatDate(entry.at)}</span>
                    </div>
                  </div>
                  {/* The sign carries the meaning, so it is never colour
                      alone (§93) — a "+" and a "-" are readable without it.
                      No unit suffix here: unlike the price list and plan
                      benefit rows, this text must stay exactly the signed
                      amount, and a browser test asserts on it verbatim. */}
                  <span className={entry.creditDelta > 0 ? "text-mint shrink-0 text-sm font-semibold tabular-nums" : "text-fg-body shrink-0 text-sm font-semibold tabular-nums"}>{entry.displayAmount}</span>
                </li>
              ))}
            </ul>
          )}
        </Surface>

        <Surface as="section" aria-labelledby="plans-heading" id="plans" level="panel" padding="none" className="scroll-mt-6 overflow-hidden">
          <div className="border-line-2 border-b px-5 py-5 sm:px-6">
            <MonoLabel id="plans-heading" as="h2" className="text-mint">Plans</MonoLabel>
            <p className="text-fg mt-2 font-semibold">Monthly Credits</p>
          </div>
          <div className="divide-line-2 divide-y">
            {plans.map((plan) => (
              <StartPlanForm key={plan.key} planKey={plan.key} planName={plan.name} price={`${formatPrice(plan.priceCents)} / month`} credits={formatCreditsForDisplay(plan.monthlyCreditUnits)} disabled={!stripeReady} current={overview.plan.key === plan.key} />
            ))}
          </div>

          {/*
            What the grant is actually worth, in the units of work the customer
            came here to buy.

            "1,000 Credits" is a number nobody can price without the table
            above and a calculator, and a customer choosing a plan is choosing
            how much work they can do — not how many Credits they will hold.
            Both figures are computed from the same catalog and the same rate
            card the charge uses, so this can never drift from the real answer.
          */}
          <dl className="border-line-2 divide-line-2 divide-y border-t">
            {plans.map((plan) => {
              const buys = planPurchasingPower(plan.monthlyCreditUnits, at);
              if (!buys) return null;

              return (
                <div key={plan.key} className="flex items-baseline justify-between gap-4 px-5 py-3 sm:px-6">
                  <dt className="text-fg-meta shrink-0 text-xs">{plan.name} buys</dt>
                  <dd className="text-fg-body text-right text-xs">{buys} each month</dd>
                </div>
              );
            })}
          </dl>
        </Surface>
      </div>

      <footer className="text-fg-meta flex items-center justify-center gap-2 px-4 pb-2 text-center text-xs">
        <LockIcon size={14} /> Payments are securely processed by Stripe. Vibe never stores your card details.
      </footer>
    </div>
  );
}

/**
 * A monthly grant expressed as work, not as Credits.
 *
 * Whole units only, and rounded **down**: a plan that funds 4.8 audits buys
 * four, and telling somebody it buys five is the kind of small dishonesty a
 * billing page cannot afford. Returns null when nothing in the card is priced,
 * so a policy with no prices renders no claim rather than "0 audits".
 */
function planPurchasingPower(monthlyCreditUnits: CreditUnits, at: Date): string | null {
  if (monthlyCreditUnits <= 0) return null;

  const agent = retailChargeFor("agent_execution", at, { pricingClass: "standard" });
  const audit = retailChargeFor("business_audit", at);

  const parts: string[] = [];

  if (agent.kind === "charge") {
    const runs = Math.floor(monthlyCreditUnits / agent.creditUnits);
    if (runs > 0) parts.push(`${runs} standard agent ${runs === 1 ? "improvement" : "improvements"}`);
  }

  if (audit.kind === "charge") {
    const audits = Math.floor(monthlyCreditUnits / audit.creditUnits);
    if (audits > 0) parts.push(`${audits} Business ${audits === 1 ? "Audit" : "Audits"}`);
  }

  return parts.length === 0 ? null : `${parts.join(", or ")}`;
}

function PlanBenefit({ children }: { children: React.ReactNode }) {
  return (
    <li className="text-fg-prose flex items-start gap-2.5">
      <CheckIcon className="text-mint mt-0.5 shrink-0" size={15} />
      <span>{children}</span>
    </li>
  );
}

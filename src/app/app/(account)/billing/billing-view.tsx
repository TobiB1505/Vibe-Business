import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import {
  ArrowRightIcon,
  InfoIcon,
  LockIcon,
  PlusIcon,
  SparklesIcon,
} from "@/components/ui/dashboard-icons";
import { Notice } from "@/components/ui/states";
import { ActivityFeed } from "@/app/app/projects/[projectId]/activity-feed";
import type { ActivityEntry } from "@/modules/audit-log/view";
import { Surface } from "@/components/ui/surface";
import { MonoLabel, SectionHeader } from "@/components/ui/typography";
import {
  getPlan,
  listCreditPacks,
  listPaidPlans,
} from "@/modules/billing/catalog";
import type {
  BillingOverview,
  CreditActivityEntry,
} from "@/modules/billing/overview";
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
import {
  formatCreditsForDisplay,
  type CreditUnits,
} from "@/modules/credits/units";
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
  accountActivity = [],
  at = new Date(),
}: {
  overview: BillingOverview;
  stripeReady: boolean;
  checkoutState?: string;
  /**
   * The account's own record — the events that belong to no product.
   *
   * A Credit purchase and a GitHub connection are written to `audit_events`
   * with no `project_id`, which is exactly what the project-scoped read
   * filters out, so they had been recorded and shown nowhere.
   */
  accountActivity?: ActivityEntry[];
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

  // Resolved once, so the table and the footnote below cannot disagree about
  // which prices exist.
  const priceRows = RETAIL_OPERATION_KINDS.map((operation) => ({
    operation,
    resolved: resolveRetailPrice(operation, at),
  }))
    .filter((row): row is PriceRow => {
      // An operation the policy does not sell has no row at all. A "—" would
      // still be a claim about a price.
      return row.resolved !== null && row.resolved.price.kind !== "not_priced";
    })
    /*
     * Priced rows first, included ones last.
     *
     * `RETAIL_OPERATION_KINDS` is ordered by the product's own journey, which
     * put "Understanding your product · Free" in the middle of four amounts —
     * so the one column a reader is scanning stopped being a column of numbers
     * halfway down. Order within each group is left exactly as the policy
     * declares it; only the two groups are separated.
     */
    .sort(
      (a, b) =>
        Number(a.resolved.price.kind === "free") -
        Number(b.resolved.price.kind === "free"),
    );

  // Shown only when a row above actually needs it. A footnote explaining
  // agent tiers and Deep Scan under a policy that prices neither is a
  // statement about rows that are not on the page.
  const hasQualifiedPrice = priceRows.some(
    (row) => row.resolved.basis !== "measured",
  );

  // Whether the balance has any context worth a line beneath it.
  const hasBalanceFacts =
    overview.monthlyAllowance !== null ||
    (overview.plan.renewsAt !== null && !overview.plan.endingAtPeriodEnd) ||
    overview.reservedCredits > 0 ||
    overview.nextExpiry !== null;

  return (
    <div className="flex flex-col gap-5 sm:gap-6">
      <SectionHeader
        level={1}
        title="Billing"
        description="Manage your plan, Credits and billing."
      />

      {notice && (
        <Notice tone={notice.tone} label={notice.label}>
          {notice.body}
        </Notice>
      )}

      {/*
        The balance leads, and the plan sits beside it.

        Three equal cards is three equal claims on attention, and the question
        somebody opens this page with is not "what plan am I on" — it is "how
        many Credits do I have". So the balance takes two thirds and everything
        it needs to be understood sits inside it: the number, what share of the
        included allowance is left, when that renews, anything a running job is
        holding, and what lapses next. A card that answers one question with a
        number and leaves the rest of the sentence on another card is how a
        customer ends up doing arithmetic on a billing page.

        The card that used to sit third — "How Credits work", three lines of
        static copy and a jump link — is gone. Its one real sentence now sits
        under the price table it was pointing at.
      */}
      <section
        aria-label="Billing overview"
        className="grid gap-4 lg:grid-cols-3"
      >
        <Surface
          level="panel"
          padding="md"
          className="flex flex-col lg:col-span-2"
        >
          <MonoLabel className="text-mint">Available Credits</MonoLabel>

          <p
            className="text-fg mt-5 text-[3.15rem] leading-none font-bold tracking-[-0.04em] tabular-nums"
            data-testid="credit-balance"
          >
            {overview.displayAvailable}
            <span className="sr-only"> Credits</span>
          </p>
          <p className="text-fg-muted mt-2 text-sm">Credits available</p>

          {/*
            Rendered only when there is something to say.

            An account with no plan, no hold and no expiry has no facts to list,
            and an empty `dl` still occupies its margins — which on the
            zero-balance screen left a visible hole between "Credits available"
            and the buttons, in the card that is supposed to be the calmest
            thing on the page.
          */}
          {hasBalanceFacts && (
            <dl className="mt-6 flex flex-col gap-2.5 text-sm">
              {overview.monthlyAllowance && (
                <BalanceFact term="Included this month">
                  <span className="text-fg font-semibold tabular-nums">
                    {overview.monthlyAllowance.displayRemaining}
                  </span>{" "}
                  of {overview.monthlyAllowance.displayInitial} monthly Credits
                  left
                </BalanceFact>
              )}

              {overview.plan.renewsAt && !overview.plan.endingAtPeriodEnd && (
                <BalanceFact term="Renews">
                  Your included Credits renew on{" "}
                  {formatDate(overview.plan.renewsAt)}
                </BalanceFact>
              )}

              {/*
              Shown only while something is actually holding Credits.

              A permanent "0 Credits reserved" line would teach every customer
              what a reservation is in order to tell them nothing, which is
              exactly the internal vocabulary §52 keeps off this page. When it
              is not zero it is the only thing on the screen that explains a
              balance the history does not add up to.
            */}
              {overview.reservedCredits > 0 && (
                <BalanceFact term="In progress">
                  <span className="text-fg font-semibold tabular-nums">
                    {overview.displayReserved}
                  </span>{" "}
                  Credits are held for work that is still running
                </BalanceFact>
              )}

              {overview.nextExpiry && (
                <BalanceFact term="Expiring">
                  <span className="text-fg font-semibold tabular-nums">
                    {overview.nextExpiry.displayCredits}
                  </span>{" "}
                  expire on {formatDate(overview.nextExpiry.expiresAt)}
                </BalanceFact>
              )}
            </dl>
          )}

          <div className="mt-auto flex flex-col gap-3 pt-6 sm:flex-row sm:items-center">
            <a
              href="#credit-packs"
              className={buttonClasses({ variant: "primary", size: "sm" })}
            >
              Buy Credits
              <PlusIcon size={16} />
            </a>
            <a
              href="#credit-prices"
              className="text-mint inline-flex items-center gap-2 self-start rounded-sm text-sm font-semibold underline-offset-4 hover:underline sm:self-auto"
            >
              See what Credits buy
              <ArrowRightIcon size={15} />
            </a>
          </div>
        </Surface>

        {/*
          The plan card states the plan and offers the one control that manages
          it. It used to also list the plan's benefits — which is the `#plans`
          section's job, two screens down, where the plans are actually
          compared. Saying it twice made the page longer without answering
          anything a second time.
        */}
        <Surface level="panel" padding="md" className="flex flex-col">
          <div className="flex items-start justify-between gap-4">
            <MonoLabel className="text-mint">Your plan</MonoLabel>
            <span
              aria-hidden="true"
              className="bg-mint-tint text-mint flex size-10 items-center justify-center rounded-full"
            >
              <SparklesIcon size={20} />
            </span>
          </div>

          <h2 className="text-fg mt-4 text-[1.65rem] leading-none font-bold">
            {overview.plan.name}
          </h2>
          <p className="text-fg mt-2 flex items-baseline gap-1.5">
            <span className="text-title font-semibold">
              {formatPrice(currentPlan.priceCents)}
            </span>
            {currentPlan.priceCents > 0 && (
              <span className="text-fg-muted text-sm">/ month</span>
            )}
          </p>
          <p
            className={
              overview.plan.endingAtPeriodEnd
                ? "text-amber mt-2 text-sm"
                : "text-fg-muted mt-2 text-sm"
            }
          >
            {planTiming(overview)}
          </p>

          <p className="text-fg-prose mt-4 text-sm">
            {overview.plan.key === "free"
              ? "Your first Business Audit and first Deep Scan for each product are included."
              : `${formatCreditsForDisplay(currentPlan.monthlyCreditUnits)} Credits included every month.`}
          </p>

          <div className="mt-auto pt-6">
            {overview.plan.key !== "free" && stripeReady ? (
              <ManageBillingForm />
            ) : overview.plan.key === "free" ? (
              <Link
                href="#plans"
                className={buttonClasses({ variant: "secondary", size: "sm" })}
              >
                View plans
                <ArrowRightIcon size={15} />
              </Link>
            ) : (
              <button
                type="button"
                disabled
                className={`${buttonClasses({ variant: "secondary", size: "sm" })} w-full`}
              >
                Management unavailable
              </button>
            )}
          </div>
        </Surface>
      </section>

      {!overview.welcomeGranted && (
        <Surface
          level="section"
          tone="mint"
          padding="md"
          className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center"
        >
          <div>
            <MonoLabel className="text-mint">Welcome Credits</MonoLabel>
            <p className="text-fg mt-2 font-semibold">
              Your account is eligible for 100 Welcome Credits.
            </p>
            <p className="text-fg-muted mt-1 text-sm">
              They are valid for 30 days.
            </p>
          </div>
          <ClaimWelcomeCreditsForm />
        </Surface>
      )}

      {/*
        One grid, two columns that each stack — not two grids stacked.

        The price table is roughly twice the height of the pack list, so as two
        separate rows the right-hand side ended in several hundred pixels of
        nothing before the plans began again below it. Reading order is
        unchanged, and each column still flows in the order it did.
      */}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(20rem,0.7fr)]">
        <div className="flex flex-col gap-4">
          <Surface
            as="section"
            aria-labelledby="credit-prices-heading"
            id="credit-prices"
            level="panel"
            padding="none"
            className="scroll-mt-6 overflow-hidden"
          >
            <div className="border-line-2 flex items-start justify-between gap-4 border-b px-5 py-5 sm:px-6">
              <div className="min-w-0">
                <MonoLabel
                  id="credit-prices-heading"
                  as="h2"
                  className="text-mint"
                >
                  Credit prices
                </MonoLabel>
                <p className="text-fg mt-2 font-semibold">
                  Know the cost before you start
                </p>
                <p className="text-fg-prose mt-1.5 max-w-[46ch] text-sm">
                  Credits power Vibe&rsquo;s business intelligence and Agent
                  work. Every task shows what it costs beside the button that
                  starts it.
                </p>
              </div>
              <span className="text-fg-meta hidden shrink-0 items-center gap-1.5 pt-1 text-xs sm:inline-flex">
                <InfoIcon size={14} /> Known before you start
              </span>
            </div>
            <ul className="divide-line-2 divide-y">
              {priceRows.map(({ operation, resolved }) => {
                const price = resolved.price;

                return (
                  /*
                   * Stacked on a phone, opposed on a desktop.
                   *
                   * The agent row is three label/amount pairs, and on a narrow
                   * screen forcing it to share a line with the operation name
                   * squeezed both into two-line wraps. Below `sm` the name gets
                   * the full width and the amounts sit under it, indented past
                   * the icon so the column still reads as a column.
                   */
                  <li
                    key={operation}
                    className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4 sm:px-6"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span
                        aria-hidden="true"
                        className="bg-mint-tint text-mint flex size-9 shrink-0 items-center justify-center rounded-nav"
                      >
                        <SparklesIcon size={16} />
                      </span>
                      <span className="text-fg-body text-sm">
                        {OPERATION_NAMES[operation]}
                        {resolved.basis !== "measured" && (
                          <sup className="text-fg-meta ml-0.5 text-[0.65rem]">
                            *
                          </sup>
                        )}
                      </span>
                    </div>

                    {price.kind === "by_execution_class" ? (
                      <span className="flex shrink-0 flex-col gap-1 pl-12 sm:items-end sm:pl-0">
                        {EXECUTION_PRICING_CLASSES.map((pricingClass) => (
                          <span
                            key={pricingClass}
                            className="flex items-baseline justify-between gap-2 sm:justify-end"
                          >
                            <span className="text-fg-meta text-xs">
                              {EXECUTION_CLASS_NAMES[pricingClass]}
                            </span>
                            <span className="text-fg text-sm font-semibold tabular-nums">
                              {formatCreditsForDisplay(
                                price.creditUnitsByClass[pricingClass],
                              )}{" "}
                              Credits
                            </span>
                          </span>
                        ))}
                      </span>
                    ) : (
                      <span className="text-fg shrink-0 pl-12 text-sm font-semibold tabular-nums sm:pl-0">
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
            {/*
            The settlement truth, in the customer's words.

            `settleOperationCredits` settles at the reserved amount and
            `releaseOperationCredits` returns the whole hold, so an Agent
            improvement costs exactly its tier price or exactly nothing —
            there is no partial charge anywhere in the system. "Up to 200
            Credits" would therefore be the wrong kind of hedge: it implies a
            variable settlement no code path can produce, and a customer who
            budgeted for "up to" and was charged the top of it every time would
            be right to feel misled. What is genuinely conditional is not the
            amount but whether anything is charged at all, and that is what
            this says.
          */}
            {hasQualifiedPrice && (
              <p className="text-fg-meta border-line-2 border-t px-5 py-4 text-xs sm:px-6">
                <span aria-hidden="true">*</span> Agent prices scale with how
                broad a change is, and Vibe tells you which before you start.
                You are charged only if the Agent delivers a change &mdash; if
                it doesn&rsquo;t, the Credits stay yours. A Deep Scan price
                covers the browser session that reads your signed-in product.
              </p>
            )}
          </Surface>

          {accountActivity.length > 0 && (
            <Surface
              as="section"
              aria-labelledby="account-activity-heading"
              level="panel"
              padding="lg"
              className="flex flex-col gap-4"
            >
              <div>
                <MonoLabel id="account-activity-heading" as="h2" className="text-mint">
                  Your account
                </MonoLabel>
                <p className="text-fg mt-2 font-semibold">Account activity</p>
                <p className="text-fg-muted mt-1 text-ui">
                  What happened to the account itself — Credits bought, accounts connected.
                </p>
              </div>
              <ActivityFeed entries={accountActivity} hasMore={false} />
            </Surface>
          )}

          {/*
            Where the Credits went, per product (audit R24). The history below
            says what happened; this says which product it happened to — the
            question a founder with four products asks first, and the one the
            ledger could answer all along and never did.
          */}
          {overview.spendByProduct.length > 0 && (
            <Surface
              as="section"
              aria-labelledby="spend-by-product-heading"
              level="panel"
              padding="lg"
              className="flex flex-col gap-4"
            >
              <div>
                <MonoLabel id="spend-by-product-heading" as="h2" className="text-mint">
                  Where it went
                </MonoLabel>
                <p className="text-fg mt-2 font-semibold">Spend by product</p>
                {/*
                  Over the history below, not ever. A total that silently
                  covered the last hundred movements would be read as lifetime.
                */}
                <p className="text-fg-muted mt-1 text-ui">
                  Across the activity shown below.
                </p>
              </div>
              <ul className="divide-line-2 divide-y" data-testid="spend-by-product">
                {overview.spendByProduct.map((product) => (
                  <li
                    key={product.projectId}
                    className="flex items-baseline justify-between gap-4 py-2.5 first:pt-0 last:pb-0"
                  >
                    <span className="text-fg-body truncate text-sm">{product.name}</span>
                    <span className="text-fg-secondary text-sm tabular-nums">
                      {product.displayCredits} Credits
                    </span>
                  </li>
                ))}
              </ul>
            </Surface>
          )}

          <Surface
            as="section"
            aria-labelledby="recent-activity-heading"
            level="panel"
            padding="none"
            className="overflow-hidden"
          >
            <div className="border-line-2 flex items-center justify-between gap-4 border-b px-5 py-5 sm:px-6">
              <div>
                <MonoLabel
                  id="recent-activity-heading"
                  as="h2"
                  className="text-mint"
                >
                  Recent usage
                </MonoLabel>
                <p className="text-fg mt-2 font-semibold">
                  Latest Credit activity
                </p>
              </div>
              <span className="text-fg-meta text-xs">Newest first</span>
            </div>
            {overview.recentActivity.length === 0 ? (
              /*
              An empty history is a normal state, not a missing one. It says
              what will fill it, so a new account reads this as "nothing has
              happened yet" rather than "something failed to load".
            */
              <div className="px-5 py-8 sm:px-6">
                <p className="text-fg-body text-sm font-medium">
                  No Credit activity yet
                </p>
                <p className="text-fg-muted mt-1.5 max-w-[42ch] text-sm">
                  Credits you add and tasks you run will appear here.
                </p>
              </div>
            ) : (
              <ul className="divide-line-2 divide-y">
                {overview.recentActivity.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex items-center justify-between gap-4 px-5 py-4 sm:px-6"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span
                        aria-hidden="true"
                        className="bg-mint-tint text-mint flex size-9 shrink-0 items-center justify-center rounded-nav"
                      >
                        {activityIcon(entry)}
                      </span>
                      <div className="flex min-w-0 flex-col gap-1">
                        <span className="text-fg-body truncate text-sm font-medium">
                          {entry.label}
                        </span>
                        <span className="text-fg-meta text-xs">
                          {/* Which product, when the movement belongs to one. */}
                          {entry.productName ? `${entry.productName} · ` : ""}
                          {formatDate(entry.at)}
                        </span>
                      </div>
                    </div>
                    {/* The sign carries the meaning, so it is never colour
                      alone (§93) — a "+" and a "-" are readable without it.
                      No unit suffix here: unlike the price list and plan
                      benefit rows, this text must stay exactly the signed
                      amount, and a browser test asserts on it verbatim. */}
                    <span
                      className={
                        entry.creditDelta > 0
                          ? "text-mint shrink-0 text-sm font-semibold tabular-nums"
                          : "text-fg-body shrink-0 text-sm font-semibold tabular-nums"
                      }
                    >
                      {entry.displayAmount}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Surface>
        </div>

        <div className="flex flex-col gap-4">
          <Surface
            as="section"
            aria-labelledby="credit-packs-heading"
            id="credit-packs"
            level="panel"
            padding="none"
            className="scroll-mt-6 overflow-hidden"
          >
            <div className="border-line-2 border-b px-5 py-5 sm:px-6">
              <MonoLabel
                id="credit-packs-heading"
                as="h2"
                className="text-mint"
              >
                Top up Credits
              </MonoLabel>
              <p className="text-fg mt-2 font-semibold">One-off purchases</p>
            </div>
            <div className="divide-line-2 divide-y">
              {packs.map((pack) => (
                <BuyCreditPackForm
                  key={pack.key}
                  packKey={pack.key}
                  credits={pack.credits.toLocaleString("en-GB")}
                  price={formatPrice(pack.priceCents)}
                  disabled={!stripeReady}
                />
              ))}
            </div>
          </Surface>

          {/* Beside the controls it disables, rather than a page-width banner
            between two sections that both still look purchasable. */}
          {!stripeReady && (
            <Notice tone="info" label="Not available yet">
              Payments aren&rsquo;t set up on this deployment yet, so Credits
              can&rsquo;t be purchased.
            </Notice>
          )}

          <Surface
            as="section"
            aria-labelledby="plans-heading"
            id="plans"
            level="panel"
            padding="none"
            className="scroll-mt-6 overflow-hidden"
          >
            <div className="border-line-2 border-b px-5 py-5 sm:px-6">
              <MonoLabel id="plans-heading" as="h2" className="text-mint">
                Plans
              </MonoLabel>
              {/*
              "Choose a plan", not "Monthly Credits".

              The activity list now labels a plan renewal "Monthly Credits", and
              this panel headed the same two words — two different things saying
              the same thing on one screen. This one is a chooser, so it says so.
            */}
              <p className="text-fg mt-2 font-semibold">Choose a plan</p>
            </div>
            <div className="divide-line-2 divide-y">
              {plans.map((plan) => (
                <StartPlanForm
                  key={plan.key}
                  planKey={plan.key}
                  planName={plan.name}
                  price={`${formatPrice(plan.priceCents)} / month`}
                  credits={formatCreditsForDisplay(plan.monthlyCreditUnits)}
                  disabled={!stripeReady}
                  current={overview.plan.key === plan.key}
                />
              ))}
            </div>

            {/*
            What the grant is actually worth, in the units of work the customer
            came here to buy — and given room, because it is the only thing on
            this page that answers the question a plan is actually chosen on.

            "1,000 Credits" is a number nobody can price without the table above
            and a calculator, and a customer choosing a plan is choosing how much
            work they can do, not how many Credits they will hold. Both figures
            are computed from the same catalog and the same rate card the charge
            uses, so this can never drift from the real answer. It was an `xs`
            right-aligned `dl` at the bottom of the narrow column, wrapping to
            three lines: the least legible element on the screen carrying the
            most decision-relevant sentence.
          */}
            <dl className="border-line-2 divide-line-2 divide-y border-t">
              {plans.map((plan) => {
                const buys = planPurchasingPower(plan.monthlyCreditUnits, at);
                if (!buys) return null;

                return (
                  <div key={plan.key} className="px-5 py-3.5 sm:px-6">
                    <dt className="text-fg-meta text-xs">{plan.name} buys</dt>
                    <dd className="text-fg-body mt-1 text-sm">
                      {buys} each month
                    </dd>
                  </div>
                );
              })}
            </dl>
          </Surface>
        </div>
      </div>

      <footer className="text-fg-meta flex items-center justify-center gap-2 px-4 pb-2 text-center text-xs">
        <LockIcon size={14} /> Payments are securely processed by Stripe. Vibe
        never stores your card details.
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
function planPurchasingPower(
  monthlyCreditUnits: CreditUnits,
  at: Date,
): string | null {
  if (monthlyCreditUnits <= 0) return null;

  const agent = retailChargeFor("agent_execution", at, {
    pricingClass: "standard",
  });
  const audit = retailChargeFor("business_audit", at);

  const parts: string[] = [];

  if (agent.kind === "charge") {
    const runs = Math.floor(monthlyCreditUnits / agent.creditUnits);
    if (runs > 0)
      parts.push(
        `${runs} standard agent ${runs === 1 ? "improvement" : "improvements"}`,
      );
  }

  if (audit.kind === "charge") {
    const audits = Math.floor(monthlyCreditUnits / audit.creditUnits);
    if (audits > 0)
      parts.push(`${audits} Business ${audits === 1 ? "Audit" : "Audits"}`);
  }

  return parts.length === 0 ? null : `${parts.join(", or ")}`;
}

/**
 * One line of context under the balance.
 *
 * A `dt`/`dd` pair rather than a sentence in a `<p>`, because each of these is
 * genuinely a labelled fact and a screen reader should be able to hear which.
 * The term is visually hidden: sighted readers get it from the sentence itself
 * ("… monthly Credits left", "expire on …"), and printing both would say
 * everything twice.
 */
function BalanceFact({
  term,
  children,
}: {
  term: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="sr-only">{term}</dt>
      <dd className="text-fg-prose">{children}</dd>
    </div>
  );
}

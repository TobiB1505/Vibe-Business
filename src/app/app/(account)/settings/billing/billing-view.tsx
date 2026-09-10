import { formatDate } from "@/lib/utils/format-datetime";
import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { ArrowRightIcon, LockIcon, PlusIcon } from "@/components/ui/dashboard-icons";
import { Notice } from "@/components/ui/states";
import { Surface } from "@/components/ui/surface";
import { MonoLabel, SectionHeader } from "@/components/ui/typography";
import {
  ANNUAL_PAID_MONTHS,
  getPlan,
  listCreditPacks,
  listPaidPlans,
} from "@/modules/billing/catalog";
import type { BillingOverview } from "@/modules/billing/overview";
import { retailChargeFor } from "@/modules/credits/retail";
import {
  CREDIT_UNITS_PER_CREDIT,
  formatCreditsForDisplay,
  type CreditUnits,
} from "@/modules/credits/units";
import {
  BuyCreditPackForm,
  ClaimWelcomeCreditsForm,
  ManageBillingForm,
  StartPlanForm,
} from "./purchase-forms";
import { figureClasses } from "@/components/ui/figure";
import { AllowanceMeter } from "@/components/ui/allowance-meter";

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

function formatPrice(cents: number): string {
  return `€${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

function planTiming(overview: BillingOverview): string {
  if (overview.plan.key === "free") return "No renewal date";
  if (!overview.plan.renewsAt) return "Active subscription";
  /*
   * The shared formatter returns null for a date it cannot parse, where the
   * local one returned the string "Invalid Date". Neither belongs in a
   * sentence, so an unparseable renewal says what is still true — there is a
   * subscription — instead of naming a day that does not exist.
   */
  const renews = formatDate(overview.plan.renewsAt);
  if (!renews) return "Active subscription";

  return overview.plan.endingAtPeriodEnd ? `Ends on ${renews}` : `Renews on ${renews}`;
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

  /*
   * Whether the `dl` under the meter has anything in it.
   *
   * Exactly the three conditions that list renders, and not one more. It used
   * to include `monthlyAllowance` and the renewal date, which UI-22 moved up
   * beside the meter — leaving the list true and empty on the most common
   * screen there is, and an empty `dl` still occupies its margins. The result
   * was a visible hole between the meter and the buttons, in the card that is
   * supposed to be the calmest thing on the page. The same defect the original
   * comment here warned about, reintroduced by moving its contents.
   */
  const showsRenewalHere =
    overview.monthlyAllowance === null &&
    overview.plan.renewsAt !== null &&
    !overview.plan.endingAtPeriodEnd;
  const hasBalanceFacts =
    showsRenewalHere || overview.reservedCredits > 0 || overview.nextExpiry !== null;

  return (
    <div className="flex flex-col gap-5 sm:gap-6">
      <SectionHeader
        level={1}
        title="Billing"
        description="Your Credits, your plan, and where they went."
      />

      {notice && (
        <Notice tone={notice.tone} label={notice.label}>
          {notice.body}
        </Notice>
      )}

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
            <p className="text-fg-muted mt-1 text-body">They are valid for 30 days.</p>
          </div>
          <ClaimWelcomeCreditsForm />
        </Surface>
      )}

      {/*
        One panel, not two (UI-22).

        The balance and the plan were two cards in a 2:1 grid, and answering
        "can I run this, and until when" meant reading across a gap: the number
        on the left, what renews it on the right. They are one question. The
        plan sits on the same card as a line, the meter shows what the two
        numbers under it make a reader divide, and both controls are in one row.
      */}
      <Surface
        as="section"
        aria-labelledby="balance-heading"
        level="panel"
        padding="lg"
        className="flex flex-col gap-6"
      >
        <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
          <div className="min-w-0">
            <MonoLabel id="balance-heading" as="h2" className="text-mint">
              Available Credits
            </MonoLabel>
            <p className={figureClasses("lg", "text-fg mt-4")} data-testid="credit-balance">
              {overview.displayAvailable}
              <span className="sr-only"> Credits</span>
            </p>
            <p className="text-fg-muted mt-2 text-body">Credits available</p>
          </div>

          {/*
            The plan as a fact on this card rather than a card of its own. It
            answers "what refills this", which is the second half of the
            sentence the number above starts.
          */}
          <div className="flex min-w-0 flex-col items-start gap-1.5 sm:items-end">
            <span className="text-fg-meta text-caption">Your plan</span>
            {/*
              A heading, because it names a thing. It was one on the plan card
              this replaced, and dropping to a `<p>` took the plan out of the
              document outline — invisible on screen and immediately visible to
              anyone navigating by heading.
            */}
            <div className="flex items-baseline gap-2">
              {/*
                The price is beside the heading, not inside it: a heading
                named "Builder €19 / month" is not the plan's name, and it is
                what a reader navigating by heading would hear.
              */}
              <h3 className="text-fg text-title font-semibold">{overview.plan.name}</h3>
              <span className="text-fg-muted text-body">
                {formatPrice(currentPlan.priceCents)}
                {currentPlan.priceCents > 0 && " / month"}
              </span>
            </div>
            <p
              className={
                overview.plan.endingAtPeriodEnd
                  ? "text-amber text-caption"
                  : "text-fg-muted text-caption"
              }
            >
              {planTiming(overview)}
            </p>
            {/*
              What the Free plan includes, which no meter can show: it has no
              monthly allowance to be a share of, so without this sentence the
              only plan a new account is on says nothing about what it gives.
              A paid plan needs no second sentence — the meter above states its
              allowance in the numbers it is a share of.
            */}
            {overview.plan.key === "free" && (
              <p className="text-fg-prose max-w-[38ch] text-caption sm:text-right">
                Your first Business Audit and first Deep Scan for each product are included.
              </p>
            )}
          </div>
        </div>

        {/*
          The meter, only where there is an allowance to be a share of. On a
          plan that includes none there is no denominator, and a full bar
          would be a claim about a limit that does not exist.
        */}
        {overview.monthlyAllowance && (
          <div className="flex flex-col gap-2">
            <AllowanceMeter
              label="Monthly Credits remaining"
              /*
                Credits, not the internal sub-units the ledger stores in. The
                ratio is identical either way, but `aria-valuenow` is read
                aloud where `aria-valuetext` is absent, and "1,000,000" is the
                internal vocabulary §52 keeps off this page — said out loud, to
                the reader least able to check it.
              */
              remaining={overview.monthlyAllowance.remaining / CREDIT_UNITS_PER_CREDIT}
              total={overview.monthlyAllowance.initial / CREDIT_UNITS_PER_CREDIT}
              valueText={`${overview.monthlyAllowance.displayRemaining} of ${overview.monthlyAllowance.displayInitial} monthly Credits left`}
            />
            <p className="text-fg-prose text-body">
              <span className="text-fg font-semibold tabular-nums">
                {overview.monthlyAllowance.displayRemaining}
              </span>{" "}
              of {overview.monthlyAllowance.displayInitial} monthly Credits left
              {overview.plan.renewsAt && !overview.plan.endingAtPeriodEnd && (
                <> · renews {formatDate(overview.plan.renewsAt)}</>
              )}
            </p>
          </div>
        )}

        {/*
          Rendered only when there is something to say. An account with no
          hold and no expiry has no facts to list, and an empty `dl` still
          occupies its margins.
        */}
        {hasBalanceFacts && (
          <dl className="flex flex-col gap-2 text-body">
            {/*
              The renewal line lives beside the meter above when there is an
              allowance, and here when there is not — so a plan with a renewal
              date and no monthly Credits still says when it renews.
            */}
            {showsRenewalHere && overview.plan.renewsAt && (
              <BalanceFact term="Renews">
                Your included Credits renew on {formatDate(overview.plan.renewsAt)}
              </BalanceFact>
            )}

            {/*
              Shown only while something is actually holding Credits.

              A permanent "0 Credits reserved" line would teach every customer
              what a reservation is in order to tell them nothing, which is
              exactly the internal vocabulary §52 keeps off this page.
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

        <div className="border-line-2 flex flex-col gap-3 border-t pt-5 sm:flex-row sm:items-center">
          <a href="#credit-packs" className={buttonClasses({ variant: "primary" })}>
            Buy Credits
            <PlusIcon size={16} />
          </a>
          {overview.plan.key !== "free" && stripeReady ? (
            <ManageBillingForm />
          ) : overview.plan.key === "free" ? (
            <Link href="#plans" className={buttonClasses({ variant: "secondary" })}>
              View plans
              <ArrowRightIcon size={15} />
            </Link>
          ) : (
            <button
              type="button"
              disabled
              className={buttonClasses({ variant: "secondary" })}
            >
              Management unavailable
            </button>
          )}
        </div>
      </Surface>

      {/*
        Top-ups and plans, side by side.

        They were two full-width rows separated by the price table. Both answer
        "how do I get more Credits" — one for now, one for every month — so a
        reader comparing them no longer scrolls between them.
      */}
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <Surface
            as="section"
            aria-labelledby="credit-packs-heading"
            id="credit-packs"
            level="panel"
            padding="none"
            className="scroll-mt-6 overflow-hidden"
          >
            <div className="border-line-2 border-b px-5 py-4 sm:px-6">
              <MonoLabel id="credit-packs-heading" as="h2" className="text-mint">
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
              Payments aren&rsquo;t set up on this deployment yet, so Credits can&rsquo;t be
              purchased.
            </Notice>
          )}
        </div>

        <Surface
          as="section"
          aria-labelledby="plans-heading"
          id="plans"
          level="panel"
          padding="none"
          className="scroll-mt-6 overflow-hidden"
        >
          <div className="border-line-2 border-b px-5 py-4 sm:px-6">
            <MonoLabel id="plans-heading" as="h2" className="text-mint">
              Plans
            </MonoLabel>
            {/*
              "Choose a plan", not "Monthly Credits".

              The activity list labels a plan renewal "Monthly Credits", and
              this panel headed the same two words — two different things
              saying the same thing on one screen. This one is a chooser.
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
                buys={planPurchasingPower(plan.monthlyCreditUnits, at)}
                annual={
                  plan.annual
                    ? {
                        price: formatPrice(plan.annual.priceCents),
                        saving: `A year is ${ANNUAL_PAID_MONTHS} months charged and 12 granted — ${formatCreditsForDisplay(plan.annual.creditUnits)} Credits, all at once, to spend across the year.`,
                      }
                    : null
                }
                disabled={!stripeReady}
                current={overview.plan.key === plan.key}
              />
            ))}
          </div>
        </Surface>
      </div>

      {/*
        Where the Credits went — one panel, two readings.

        "Spend by product" was a panel of its own beside "Account activity".
        The account panel is gone (it listed Credits bought and accounts
        connected, both of which the ledger below already records), and the
        product split is a strip at the head of the ledger it summarises rather
        than a card two sections away from it.
      */}
      <Surface
        as="section"
        aria-labelledby="recent-activity-heading"
        level="panel"
        padding="none"
        className="overflow-hidden"
      >
        <div className="border-line-2 flex items-center justify-between gap-4 border-b px-5 py-4 sm:px-6">
          <div>
            <MonoLabel id="recent-activity-heading" as="h2" className="text-mint">
              Recent usage
            </MonoLabel>
            <p className="text-fg mt-2 font-semibold">Latest Credit activity</p>
          </div>
          <span className="text-fg-meta text-caption">Newest first</span>
        </div>

        {overview.spendByProduct.length > 0 && (
          <div className="border-line-2 flex flex-wrap items-center gap-x-6 gap-y-2 border-b px-5 py-3 sm:px-6">
            {/*
              "Across the activity shown below", not ever: the page reads a
              capped page of the ledger, and a total that silently covered the
              last hundred movements would be read as lifetime.
            */}
            <span className="text-fg-meta text-caption">Across the activity below</span>
            <ul
              className="flex flex-wrap items-center gap-x-5 gap-y-1.5"
              data-testid="spend-by-product"
            >
              {overview.spendByProduct.map((product) => (
                <li key={product.projectId} className="flex items-baseline gap-2">
                  <span className="text-fg-body truncate text-caption">{product.name}</span>
                  <span className="text-fg-secondary text-caption tabular-nums">
                    {product.displayCredits} Credits
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {overview.recentActivity.length === 0 ? (
          /*
            An empty history is a normal state, not a missing one. It says what
            will fill it, so a new account reads this as "nothing has happened
            yet" rather than "something failed to load".
          */
          <div className="px-5 py-8 sm:px-6">
            <p className="text-fg-body text-body font-medium">No Credit activity yet</p>
            <p className="text-fg-muted mt-1.5 max-w-[42ch] text-body">
              Credits you add and tasks you run will appear here.
            </p>
          </div>
        ) : (
          <ul className="divide-line-2 divide-y">
            {overview.recentActivity.map((entry) => (
              <li
                key={entry.id}
                className="flex items-center justify-between gap-4 px-5 py-2.5 sm:px-6"
              >
                <div className="flex min-w-0 items-baseline gap-3">
                  <span className="text-fg-body truncate text-body font-medium">{entry.label}</span>
                  <span className="text-fg-meta shrink-0 text-caption">
                    {/* Which product, when the movement belongs to one. */}
                    {entry.productName ? `${entry.productName} · ` : ""}
                    {formatDate(entry.at)}
                  </span>
                </div>
                {/* The sign carries the meaning, so it is never colour
                  alone (§93) — a "+" and a "-" are readable without it.
                  No unit suffix here: this text must stay exactly the signed
                  amount, and a browser test asserts on it verbatim. */}
                <span
                  className={
                    entry.creditDelta > 0
                      ? "text-mint shrink-0 text-body font-semibold tabular-nums"
                      : "text-fg-body shrink-0 text-body font-semibold tabular-nums"
                  }
                >
                  {entry.displayAmount}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Surface>

      <footer className="text-fg-meta flex items-center justify-center gap-2 px-4 pb-2 text-center text-caption">
        <LockIcon size={14} /> Payments are securely processed by Stripe. Vibe never stores your
        card details.
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

  const agent = retailChargeFor("agent_execution", at, {
    pricingClass: "standard",
  });
  const audit = retailChargeFor("business_audit", at);

  const parts: string[] = [];

  if (agent.kind === "charge") {
    const runs = Math.floor(monthlyCreditUnits / agent.creditUnits);
    if (runs > 0)
      parts.push(`${runs} standard agent ${runs === 1 ? "improvement" : "improvements"}`);
  }

  if (audit.kind === "charge") {
    const audits = Math.floor(monthlyCreditUnits / audit.creditUnits);
    if (audits > 0) parts.push(`${audits} Business ${audits === 1 ? "Audit" : "Audits"}`);
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
function BalanceFact({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="sr-only">{term}</dt>
      <dd className="text-fg-prose">{children}</dd>
    </div>
  );
}

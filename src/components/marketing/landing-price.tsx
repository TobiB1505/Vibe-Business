import { LandingStep } from "@/components/marketing/landing-step";
import { PlanCards, type PlanCard } from "@/components/marketing/plan-cards";
import { Reveal } from "@/components/marketing/reveal";
import { CostDisclosure } from "@/components/system/cost-disclosure";
import { CostLine } from "@/components/system/cost-line";
import { MonoLabel } from "@/components/ui/typography";
import {
  ANNUAL_PAID_MONTHS,
  listCreditPacks,
  listPlans,
  WELCOME_CREDIT_UNITS,
} from "@/modules/billing/catalog";
import { resolveRetailPrice, type RetailOperationKind } from "@/modules/credits/retail";
import { creditsToUnits, formatCreditsForDisplay, type CreditUnits } from "@/modules/credits/units";
import type { ExecutionPricingClass } from "@/modules/economy/execution-class";

/**
 * What a month costs, in money (UI-34).
 *
 * ## The correction this block is
 *
 * The first version was the Credit rate card — six operations, each price
 * resolved from `launch-v1`. The founder: *"Nein, natürlich nicht die
 * Credit-Preise, sondern die Monatsabos mit Echtgeld."*
 *
 * They are right, and the reason is worth writing down. A visitor who has not
 * signed up does not have a Credit balance to reason about, so a page that
 * leads with "35 Credits" is answering a question they cannot ask yet. The
 * question they *do* have is what a month costs, and it has a two-digit euro
 * answer.
 *
 * So the euros lead. The Credit prices stay, underneath and quieter, because
 * "1,000 Credits" is meaningless without them — and between the two sits the
 * line that connects them: what a month's grant actually buys, divided out of
 * the same rate card rather than estimated.
 *
 * ## Nothing here is typed
 *
 * The plans come from `listPlans()`, the packs from `listCreditPacks()`, the
 * Welcome grant from `WELCOME_CREDIT_UNITS`, and every per-action price from
 * `resolveRetailPrice` — which is the function the reservation calls. A landing
 * page cannot advertise a price the product has stopped charging, and the
 * "five agent runs" line cannot drift from the rate card because it is a
 * division performed on it.
 *
 * The free operation renders **Included** rather than a zero: a free operation
 * names itself, because printing "0 Credits" beside a control invites the
 * question of when it might stop being zero (BILLING CORE-2 §56). The page
 * inherits that decision rather than re-taking it.
 *
 * ## The year
 *
 * `PlanCards` switches between two sets of already-formatted figures, and the
 * annual set is derived rather than typed: ten months charged, twelve granted
 * (ADR 0098). So the "two months free" on the switch is a subtraction on the
 * same constant the catalogue prices with, and the Credits on the annual card
 * are the year's whole allowance — one grant, at the start, with a year to
 * spend it.
 *
 * ## The half a price list leaves out
 *
 * A run that reserved Credits and then failed **returned them**, and an
 * ambiguous outcome resolves to a failure rather than to a second charge (rule
 * 50). Nothing spends on a schedule either: Vibe never starts a paid refresh on
 * somebody's behalf (rule 60). `CostLine` is the product's own component for
 * the first, so a founder reads the same sentence here that they will read on
 * their own screen.
 */

/** Per-plan promises, in the words the billing module's own rules allow. */
const PLAN_NOTES: Record<string, string[]> = {
  free: ["No card to start", "The Product Scan, free", "One product"],
  builder: ["A fresh grant each paid month", "One Credit ledger", "Top up when a month runs short"],
  pro: ["A fresh grant each paid month", "One Credit ledger", "Top up when a month runs short"],
};

/**
 * What a paid year promises, which is not what a paid month promises.
 *
 * "A fresh grant each paid month" is false of an annual subscription — Stripe
 * invoices it once and Vibe grants once, for the period that was paid. The
 * first render of the switch said the monthly sentence under €190, which is
 * the class of quietly-false line this whole page exists to not have.
 */
const ANNUAL_NOTES = [
  "The whole year's Credits, at the start",
  "One Credit ledger",
  "Top up when a year runs short",
];

/** What each priced action costs, kept for after the euros. */
const ACTIONS: {
  label: string;
  operation: RetailOperationKind;
  pricingClass?: ExecutionPricingClass;
}[] = [
  { label: "Product Scan", operation: "product_understanding" },
  { label: "Deep Scan", operation: "deep_scan" },
  { label: "Business Brain audit", operation: "business_audit" },
  { label: "The Moves, ranked", operation: "opportunity_generation" },
  { label: "A plan for a Move", operation: "action_plan" },
  { label: "An agent run", operation: "agent_execution", pricingClass: "standard" },
];

/** Twelve, so the saving on the switch is a subtraction rather than a claim. */
const MONTHS_PER_YEAR = 12;

/** Euro cents as the price a card shows. Whole euros — every plan is one. */
function euros(cents: number): string {
  return cents === 0 ? "€0" : `€${cents / 100}`;
}

/**
 * How many of one thing a grant buys.
 *
 * Divided out of the rate card rather than estimated, so the sentence cannot
 * come to disagree with the prices printed under it. `null` where the operation
 * has no single number — a free one buys no fixed count of anything, and
 * Agentic Execution is priced per class.
 */
function buys(grant: CreditUnits, operation: RetailOperationKind, klass?: ExecutionPricingClass) {
  const resolved = resolveRetailPrice(operation);
  if (!resolved) return null;

  const price =
    resolved.price.kind === "fixed"
      ? resolved.price.creditUnits
      : resolved.price.kind === "by_execution_class" && klass
        ? resolved.price.creditUnitsByClass[klass]
        : null;

  if (price === null || price <= 0) return null;
  return Math.floor(grant / price);
}

export function LandingPrice() {
  const plans = listPlans();
  const packs = listCreditPacks();
  const builder = plans.find((plan) => plan.key === "builder");

  /*
   * Every figure formatted here, on the server, from the catalogue. The switch
   * in `PlanCards` chooses between two strings it was handed; nothing about
   * money is computed in a browser.
   */
  const cards: PlanCard[] = plans.map((plan) => ({
    key: plan.key,
    name: plan.name,
    featured: plan.key === "builder",
    href:
      plan.key === "free"
        ? "/signup"
        : `/signup?next=${encodeURIComponent("/app/settings/billing")}`,
    monthly: {
      price: euros(plan.priceCents),
      grant:
        plan.key === "free"
          ? `${formatCreditsForDisplay(WELCOME_CREDIT_UNITS)} Welcome Credits, once`
          : `${formatCreditsForDisplay(plan.monthlyCreditUnits)} Credits each paid month`,
      notes: PLAN_NOTES[plan.key] ?? [],
    },
    annual: plan.annual
      ? {
          price: euros(plan.annual.priceCents),
          grant: `${formatCreditsForDisplay(plan.annual.creditUnits)} Credits for the year`,
          notes: ANNUAL_NOTES,
        }
      : null,
  }));

  // The connecting line, computed rather than claimed.
  const runs = builder ? buys(builder.monthlyCreditUnits, "agent_execution", "standard") : null;
  const audits = builder ? buys(builder.monthlyCreditUnits, "business_audit") : null;

  return (
    <LandingStep index="08" id="pricing" labelledBy="pricing-heading" className="py-20 sm:py-28">
      <Reveal from="up">
        <div className="flex flex-col gap-5">
          <MonoLabel className="text-mint">What it costs</MonoLabel>
          <h2
            id="pricing-heading"
            className="text-fg max-w-[22ch] text-[clamp(2rem,3.6vw,3rem)] leading-[1.06] font-bold tracking-[-0.045em] text-balance"
          >
            Start free. {euros(builder?.priceCents ?? 0)} a month when it earns it.
          </h2>
          <p className="text-fg-prose max-w-[58ch] leading-relaxed">
            The Product Scan is free, so you can see what Vibe makes of your product before spending
            anything. A paid month is a grant of Credits, and every action that spends them shows
            its price at the control that starts it. Pay by the year and two of the twelve months
            are not charged.
          </p>
        </div>
      </Reveal>

      <Reveal from="up" className="mt-14 sm:mt-16">
        <PlanCards
          plans={cards}
          savingLabel={`${MONTHS_PER_YEAR - ANNUAL_PAID_MONTHS} months free`}
        />
      </Reveal>

      {/*
        The line between the two halves: what a grant is, in work. A division on
        the rate card below rather than a claim about it, so the two cannot come
        to disagree.

        "Every 1,000 Credits" rather than "1,000 Credits is", because the cards
        above it say 1,000 under a month and 12,000 under a year — a rate reads
        correctly under both, where a total reads as the wrong one half the
        time.
      */}
      {builder && runs !== null && audits !== null && (
        <Reveal from="up" delay={0.12} className="mt-10">
          <p className="text-fg-prose mx-auto max-w-[62ch] text-center leading-relaxed">
            Every {formatCreditsForDisplay(builder.monthlyCreditUnits)} Credits is{" "}
            <span className="text-fg">{runs} agent runs</span> at the standard class, or{" "}
            <span className="text-fg">{audits} Business Brain audits</span>, or any mix of the work
            below.
          </p>
        </Reveal>
      )}

      <Reveal from="up" delay={0.16} className="mt-12">
        <div className="border-line-2 rounded-card mx-auto w-full max-w-3xl border p-6">
          <MonoLabel as="h3" className="text-fg-meta mb-5 block">
            What each thing costs
          </MonoLabel>

          <ul className="grid gap-x-10 gap-y-3 sm:grid-cols-2">
            {ACTIONS.map(({ label, operation, pricingClass }) => (
              <li
                key={operation}
                className="border-line-1 flex items-baseline justify-between gap-6 border-b pb-3 last:border-b-0"
              >
                <span className="text-fg-body text-body">{label}</span>
                <CostDisclosure
                  operation={operation}
                  pricingClass={pricingClass ?? null}
                  className="shrink-0"
                />
              </li>
            ))}
          </ul>

          <div className="border-line-2 mt-6 flex flex-col gap-3 border-t pt-5">
            {/*
              The product's own component, in the two states a founder does not
              expect. The second is the one worth the block: a run that reserved
              Credits and then failed returned them, and saying so is the
              difference between a hold and a charge.
            */}
            <CostLine cost={{ kind: "settled", credits: creditsToUnits(200) }} />
            <CostLine cost={{ kind: "released" }} />

            <p className="text-fg-muted max-w-[62ch] text-caption leading-relaxed">
              And if Vibe cannot tell whether a paid call went through, it resolves that as a
              failure rather than risking a second charge. Nothing spends on a schedule either —
              Vibe never starts a paid refresh on your behalf; blocked work says what needs
              refreshing and waits for you.
            </p>

            {packs[0] && (
              <p className="text-fg-muted text-caption leading-relaxed">
                A month running short is not a plan change: Credit packs start at{" "}
                {packs[0].credits.toLocaleString("en-GB")} for {euros(packs[0].priceCents)}, and
                bought Credits do not expire with the month.
              </p>
            )}
          </div>
        </div>
      </Reveal>
    </LandingStep>
  );
}

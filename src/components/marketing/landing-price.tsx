import { LandingStep } from "@/components/marketing/landing-step";
import { PlanCards, type PlanCard } from "@/components/marketing/plan-cards";
import { Reveal } from "@/components/marketing/reveal";
import { MonoLabel } from "@/components/ui/typography";
import { ANNUAL_PAID_MONTHS, listPlans, WELCOME_CREDIT_UNITS } from "@/modules/billing/catalog";
import { resolveRetailPrice, type RetailOperationKind } from "@/modules/credits/retail";
import { formatCreditsForDisplay, type CreditUnits } from "@/modules/credits/units";
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
 * So the euros lead, and the per-action Credit prices are not on this page at
 * all — a visitor weighing €19 does not need a second currency to learn first.
 * What a grant is worth still has to be sayable, so one line says it in *work*
 * rather than in Credits: five agent runs, or twenty-eight audits, divided out
 * of the same rate card the reservation uses rather than estimated.
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
 * ## The year
 *
 * `PlanCards` switches between two sets of already-formatted figures, and the
 * annual set is derived rather than typed: ten months charged, twelve granted
 * (ADR 0107). So the "two months free" on the switch is a subtraction on the
 * same constant the catalogue prices with, and the Credits on the annual card
 * are the year's whole allowance — one grant, at the start, with a year to
 * spend it.
 *
 * ## What is deliberately not here
 *
 * The rules around a charge — that a reserved-then-failed run returns its hold,
 * that an ambiguous outcome resolves to a failure rather than to a second
 * charge, that nothing spends on a schedule, that bought Credits outlive the
 * month. All true, all enforced, and all **terms**. The founder, on the
 * paragraph that used to sit under this block: *"sowas gehört in die Terms,
 * nicht in eine Landingpage."*
 *
 * A landing page answers what this costs and what it gives. A page that
 * answers the edge cases of a charge before anybody has one is a page reading
 * its own small print aloud — and the small print has a route of its own.
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
        What a grant is, in work. A division on the rate card rather than a
        claim about it, so the sentence cannot come to disagree with what the
        product actually charges — and it is what makes "1,000 Credits" mean
        something now that the per-action prices are not printed underneath it.

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
            <span className="text-fg">{audits} Business Brain audits</span>, or any mix of the two.
          </p>
        </Reveal>
      )}
    </LandingStep>
  );
}

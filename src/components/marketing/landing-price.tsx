import { LandingStep } from "@/components/marketing/landing-step";
import { Reveal } from "@/components/marketing/reveal";
import { CostDisclosure } from "@/components/system/cost-disclosure";
import { CostLine } from "@/components/system/cost-line";
import { MonoLabel } from "@/components/ui/typography";
import { creditsToUnits } from "@/modules/credits/units";
import type { RetailOperationKind } from "@/modules/credits/retail";
import type { ExecutionPricingClass } from "@/modules/economy/execution-class";

/**
 * What it costs, before it is pressed (UI-34).
 *
 * ## The eighth shape
 *
 * Two tiles, a staircase, a narrowing, a passage, a thread, a ladder, a
 * boundary — and now a **ledger**. It is the one shape on this page that is
 * meant to be scanned down a column rather than read, because that is what a
 * price list is for, and no other block on the page is one.
 *
 * ## Why the numbers are not written here
 *
 * `CostDisclosure` resolves each one through `resolveRetailPrice` — the same
 * function the reservation calls when a founder actually presses the control.
 * There is no second copy of a price in this file to drift out of step with the
 * one charged, and a landing page cannot advertise a number the product has
 * stopped charging.
 *
 * That is also why the Product Scan row shows *Included* rather than a zero. A
 * free operation names itself; printing "0 Credits" beside a control invites
 * the question of when it might stop being zero, and BILLING CORE-2 §56 decided
 * that in the other direction. The page inherits the decision rather than
 * re-taking it.
 *
 * ## The half that comes after
 *
 * A price list answers "what will this cost" and says nothing about what
 * happens when a run fails, or when Vibe cannot tell whether a call went
 * through. Both are money questions and both have answers a founder would not
 * assume: a reserved-then-released run charges nothing, and an ambiguous
 * outcome resolves to a **failure** rather than to a second charge (rule 50).
 * `CostLine` is the product's own component for the first, so those sentences
 * are the ones the founder will read on their own screen.
 *
 * Nothing here spends on a schedule either (rule 60): Vibe never starts a paid
 * refresh on somebody's behalf, and blocked work says what needs refreshing and
 * waits.
 */

/** The rate card in force, read through the product rather than transcribed. */
const ACTIONS: {
  label: string;
  detail: string;
  operation: RetailOperationKind;
  pricingClass?: ExecutionPricingClass;
}[] = [
  {
    label: "Product Scan",
    detail: "What you built, read from your code and your live product.",
    operation: "product_understanding",
  },
  {
    label: "Deep Scan",
    detail: "The same read, behind your sign-in, in a browser Vibe runs itself.",
    operation: "deep_scan",
  },
  {
    label: "Business Brain audit",
    detail: "Nine areas judged against the evidence, with the gaps left unscored.",
    operation: "business_audit",
  },
  {
    label: "The Moves",
    detail: "Everything it found, ranked by what it costs you to leave alone.",
    operation: "opportunity_generation",
  },
  {
    label: "A plan for a Move",
    detail: "The steps, and who does each one.",
    operation: "action_plan",
  },
  {
    label: "An agent run",
    detail: "A change prepared, validated and left on its own branch for you.",
    operation: "agent_execution",
    pricingClass: "standard",
  },
];

export function LandingPrice() {
  return (
    <LandingStep index="08" id="credits" labelledBy="credits-heading" className="py-20 sm:py-28">
      <Reveal from="up">
        <div className="flex flex-col gap-5">
          <MonoLabel className="text-mint">What it costs</MonoLabel>
          <h2
            id="credits-heading"
            className="text-fg max-w-[22ch] text-[clamp(2rem,3.6vw,3rem)] leading-[1.06] font-bold tracking-[-0.045em] text-balance"
          >
            You see the number before you press it.
          </h2>
          <p className="text-fg-prose max-w-[58ch] leading-relaxed">
            Vibe runs on Credits, and every paid action carries its price at the control that starts
            it. The numbers below are the rate card in force — resolved by the same function that
            charges you, not typed onto a marketing page.
          </p>
        </div>
      </Reveal>

      {/*
        The ledger. A price sits at the right of its own row, so the column can
        be scanned; the sentence under each name is what the money buys, in the
        words the rest of this page uses for it.

        Held to a measure rather than to the section's full width. At 1440 the
        row is 1,360px, and `justify-between` put "25 Credits" a thousand
        pixels from "Deep Scan" — a price list nobody can read across is a
        two-column table pretending to be a row.
      */}
      <ul className="mt-14 flex w-full max-w-3xl flex-col sm:mt-16">
        {ACTIONS.map(({ label, detail, operation, pricingClass }, index) => (
          <li key={operation} className="border-line-2 border-b last:border-b-0">
            <Reveal from="up" delay={Math.min(index, 3) * 0.05}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-1 py-5">
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="text-fg text-lead font-semibold">{label}</span>
                  <span className="text-fg-muted max-w-[52ch] text-body leading-relaxed">
                    {detail}
                  </span>
                </span>
                <CostDisclosure
                  operation={operation}
                  pricingClass={pricingClass ?? null}
                  className="shrink-0"
                />
              </div>
            </Reveal>
          </li>
        ))}
      </ul>

      <Reveal from="up" delay={0.1} className="mt-12">
        <div className="border-line-2 bg-surface-1 rounded-card flex w-full max-w-3xl flex-col gap-4 border p-6">
          <MonoLabel className="text-fg-meta">And after you press</MonoLabel>

          {/*
            The product's own component, in the two states a founder does not
            expect. The second is the one worth the block: a run that reserved
            Credits and then failed returned them, and saying so is the
            difference between a hold and a charge.
          */}
          <CostLine cost={{ kind: "settled", credits: creditsToUnits(200) }} />
          <CostLine cost={{ kind: "released" }} />

          <p className="text-fg-muted max-w-[62ch] text-caption leading-relaxed">
            And if Vibe cannot tell whether a paid call went through, it resolves that as a failure
            rather than risking a second charge. Nothing spends on a schedule either — Vibe never
            starts a paid refresh on your behalf; blocked work says what needs refreshing and waits
            for you.
          </p>
        </div>
      </Reveal>
    </LandingStep>
  );
}

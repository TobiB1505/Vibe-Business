"use client";

import Link from "next/link";
import { useState } from "react";
import { buttonClasses } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/list-controls";
import { ArrowRightIcon, CheckIcon } from "@/components/ui/dashboard-icons";
import { cn } from "@/lib/utils/cn";

/**
 * The plan cards, and the one switch on this page (UI-34, ADR 0098).
 *
 * ## Why this is a client component and the rest of the block is not
 *
 * Because a visitor comparing €19 a month against €190 a year is comparing two
 * numbers, and a page that made them scroll to a second table to see the second
 * one is asking them to hold a figure in their head. The switch is the smallest
 * thing that can show both.
 *
 * Every number it renders was resolved on the server — from `listPlans()` and
 * from the derivation in `catalog.ts` — and arrives here already formatted.
 * Nothing about money is computed in the browser, which is the same rule the
 * rest of the billing surface follows for a stronger reason.
 *
 * ## What the switch does not do
 *
 * Move the page. Both intervals produce the same card at the same height —
 * the prices differ in value rather than in shape — and a guard measures the
 * grid across the switch, because a pricing table that jumps under a reader
 * mid-comparison is the one place this page cannot afford it.
 */

/**
 * One interval of one plan, formatted.
 *
 * The notes belong to the interval rather than to the card, and that is not
 * tidiness: *a fresh grant each paid month* is false of a year, and the first
 * render of this component said it under €190. What a plan promises depends on
 * what was bought.
 */
export type PlanTerms = { price: string; grant: string; notes: readonly string[] };

export type PlanCard = {
  key: string;
  name: string;
  featured: boolean;
  href: string;
  monthly: PlanTerms;
  /** Null for a plan with nothing to buy — Free has no year to commit to. */
  annual: PlanTerms | null;
};

export type BillingIntervalChoice = "monthly" | "annual";

export function PlanCards({
  plans,
  /** What the annual column saves, said once above the switch. */
  savingLabel,
}: {
  plans: readonly PlanCard[];
  savingLabel: string;
}) {
  const [interval, setInterval] = useState<BillingIntervalChoice>("monthly");

  return (
    <div className="flex flex-col gap-8">
      {/*
        Vibe's own segmented control, not a switch written here.

        The first version hand-rolled a radio group — and `choice-card.test.ts`
        caught it, which is what that test is for: six hand-written radios is
        how this product ended up with two conventions for picking one thing.
        `SegmentedControl` already answers this exactly, down to the arrow-key
        movement the platform gives a real radio group.

        The saving sits beside the control rather than inside the pill: the
        component is shared with Repositories and Products, and a marketing
        badge does not belong in it.
      */}
      <div className="flex scroll-mt-24 flex-col items-center gap-2">
        <SegmentedControl
          label="Billing interval"
          value={interval}
          options={[
            { value: "monthly", label: "Monthly" },
            { value: "annual", label: "Yearly" },
          ]}
          onChange={setInterval}
        />
        <p className="text-mint text-caption font-semibold">{savingLabel}</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3" data-testid="plan-cards">
        {plans.map((plan) => {
          // A plan with no year to commit to keeps its monthly figures under
          // either setting, rather than emptying out or hiding itself.
          const shown = interval === "annual" && plan.annual ? plan.annual : plan.monthly;

          return (
            <article
              key={plan.key}
              data-plan={plan.key}
              className={cn(
                "rounded-card flex h-full flex-col border p-6 sm:p-7",
                plan.featured
                  ? "border-mint-line bg-mint-tint/35 shadow-mint"
                  : "border-line-2 bg-surface-2",
              )}
            >
              <div className="flex items-center justify-between gap-4">
                <h3 className="text-fg text-title font-semibold">{plan.name}</h3>
                {plan.featured && (
                  <span className="text-mint border-mint-line bg-mint-tint rounded-full border px-3 py-1 text-caption font-semibold">
                    Most products
                  </span>
                )}
              </div>

              <p className="text-fg mt-7 text-display font-bold">
                {shown.price}
                <span className="text-fg-muted ml-2 text-body font-normal tracking-normal">
                  {interval === "annual" && plan.annual ? "/ year" : "/ month"}
                </span>
              </p>

              <p className="text-fg-secondary mt-3 text-body">{shown.grant}</p>

              <ul className="my-7 flex flex-col gap-3">
                {shown.notes.map((note) => (
                  <li key={note} className="text-fg-body flex items-start gap-3 text-body">
                    <CheckIcon className="text-mint mt-0.5 shrink-0" size={15} />
                    {note}
                  </li>
                ))}
              </ul>

              <Link
                /*
                 * The destination does not carry the interval, and that is
                 * deliberate. Adding `interval=annual` to the URL looked
                 * right and nothing downstream reads it: `signup/page.tsx`
                 * sanitizes `next` and ignores everything else, so the
                 * parameter would have been a promise the product does not
                 * keep — the same dead control this page removed from its
                 * source strip.
                 *
                 * What the link does promise is true: a paid plan lands on the
                 * billing screen, and both commitments are offered there, side
                 * by side, on the surface that can actually sell them.
                 */
                href={plan.href}
                className={cn(
                  buttonClasses({ variant: plan.featured ? "primary" : "secondary" }),
                  "mt-auto w-full",
                )}
              >
                Start with {plan.name} <ArrowRightIcon size={15} />
              </Link>
            </article>
          );
        })}
      </div>
    </div>
  );
}

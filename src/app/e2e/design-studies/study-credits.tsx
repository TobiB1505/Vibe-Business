import type { ReactNode } from "react";
import { buttonClasses } from "@/components/ui/button";
import { CreditAmount } from "@/components/ui/credit-amount";
import { CreditCoin } from "@/components/ui/credit-coin";
import { inlineActionClasses } from "@/components/ui/inline-action";
import { creditsToUnits } from "@/modules/credits/units";
import type { Study } from "./studies";

/**
 * The Credit, as a mark and as a sentence.
 *
 * ## What is actually wrong
 *
 * Under a primary control the product writes "35 Credits · of 420 available",
 * and every part of it is body text. Nothing about it says that pressing the
 * button above spends money. A price that looks like a caption is a price
 * somebody reads after the click.
 *
 * ## What is already decided, and is not up for grabs here
 *
 * Four rules constrain every treatment below, and each is recorded rather than
 * assumed:
 *
 *   - **The price is inline with the control.** Never a tooltip, a disclosure
 *     or a confirmation dialog — "Vibe tells me what this costs" is only true
 *     before the click.
 *   - **A free operation says "Included", never "0 Credits"** (ADR 0094). A
 *     zero in a currency invites arithmetic about when it stops being zero.
 *   - **No ranges.** A surface with no step in hand renders nothing, because
 *     "150–350 Credits" is not a price and the cheapest of three is a lie.
 *   - **The balance in the app shell stays restrained.** Its own docblock is
 *     explicit: "Credits are how the product is paid for, not what the product
 *     is about, so this does not get a pill, a colour, an icon or a progress
 *     bar."
 *
 * That last one is why this page asks two questions instead of one. The
 * ambient balance in the chrome and the price at the moment of spending are
 * different jobs: one is state a person glances at all day, the other is a
 * disclosure that money is about to move. A mark that is wrong in the first
 * may be exactly right in the second, and treating them as one surface is how
 * a balance in the header becomes a slot machine.
 *
 * ## Why the mark is drawn here rather than imported
 *
 * No catalogue has a Vibe Credit. Lucide supplies the generic set — a pencil,
 * a chevron, a trash can — precisely because those mean the same thing
 * everywhere; a unit this product invented is one of the marks that stays
 * hand-drawn, beside Nova's aperture and the wordmark.
 */

/* ── Question 1: the mark ───────────────────────────────────────────── */

type Mark = {
  key: string;
  name: string;
  argument: string;
  cost: string;
  render: (size: number) => ReactNode;
};

const MARKS: readonly Mark[] = [
  {
    key: "coin",
    name: "Die Münze",
    argument:
      "A struck gold coin with Vibe's V pressed into it — a pirate's coin out of a hoard, not a token. It is an object, and an object is what a price needed: a reader knows what a coin is before reading the number beside it, which is exactly what “35 Credits” set in the interface face never said.",
    cost: "Gold sits beside amber, and amber is spoken for — DESIGN.md reserves it for incomplete and waiting states. What keeps them apart is not the hue but the material: a status is always a flat fill, metal always has a ramp and a rim. That rule now has to hold everywhere, in both palettes, forever.",
    render: (size) => <CreditCoin size={size} />,
  },
];

function MarkRow({ mark }: { mark: Mark }) {
  return (
    <section className="flex flex-col gap-4 border-t border-line-2 py-8">
      <div>
        <h3 className="text-title font-semibold text-fg">{mark.name}</h3>
        <p className="mt-2 max-w-[66ch] text-caption text-fg-prose">{mark.argument}</p>
        <p className="mt-2 max-w-[66ch] text-caption text-amber">{mark.cost}</p>
      </div>

      {/* At the three sizes it would actually be rendered, plus one large so
          the drawing can be judged at all. */}
      <div className="flex flex-wrap items-end gap-8 rounded-panel border border-line-2 bg-surface-1 px-5 py-5">
        {[
          [12, "12 · Fließtext"],
          [16, "16 · Preis"],
          [19, "19 · Rahmen"],
          [44, "44 · gezeichnet"],
        ].map(([size, label]) => (
          <div key={label} className="flex flex-col items-center gap-2">
            <span className="flex h-11 items-center text-fg-secondary">
              {mark.render(size as number)}
            </span>
            <span className="font-mono text-meta text-fg-meta">{label}</span>
          </div>
        ))}
        <div className="flex flex-col gap-2">
          <span className="inline-flex items-center gap-1.5 text-ui text-fg-secondary tabular-nums">
            {mark.render(14)}35
          </span>
          <span className="font-mono text-meta text-fg-meta">im Satz</span>
        </div>
      </div>
    </section>
  );
}

/* ── Question 2: how the price composes ─────────────────────────────── */

/**
 * Every treatment is drawn three times, because a price has three states and
 * a treatment that only works for the first is not a treatment: it costs
 * something, it costs nothing, or the balance will not cover it.
 */
type Money = "priced" | "included" | "short";

type Composition = {
  key: string;
  name: string;
  argument: string;
  cost: string;
  render: (state: Money) => ReactNode;
};

/** The decided mark, so question 2 compares composition and nothing else. */
const M = (size = 14) => <CreditCoin size={size} />;

const CTA = "Run the audit again";

const COMPOSITIONS: readonly Composition[] = [
  {
    key: "today",
    name: "1 · Wie heute",
    argument:
      "The reference: the price and the balance as one line of body text under the button. It is honest, it is early, and it satisfies every recorded rule.",
    cost: "It is the thing that was objected to. Nothing about it is louder than the sentence beside it, so the one line on the screen that means money reads exactly like the ones that do not.",
    render: (state) => (
      <div className="flex flex-col items-start gap-2">
        <button type="button" className={buttonClasses()}>
          {CTA}
        </button>
        <span className="inline-flex flex-wrap items-baseline gap-x-2 text-ui">
          {state === "included" ? (
            <span className="text-fg-meta">Included</span>
          ) : (
            <>
              <span className="text-fg-secondary tabular-nums">35 Credits</span>
              <span className={state === "short" ? "text-amber" : "text-fg-meta"}>
                {state === "short" ? "You have 12. Not enough for this." : "of 420 available"}
              </span>
            </>
          )}
        </span>
      </div>
    ),
  },
  {
    key: "weighted",
    name: "2 · Nur der Preis, über dem Knopf",
    argument:
      "The coin and the number as one object, above the control. Reading order becomes cost, then action — the order a person needs, and the order a screen reader already gets from the DOM. The balance is gone entirely: Vibe says what a thing costs and never what is left.",
    cost: "A price with no balance beside it is a price you cannot check against anything. Somebody reads “35 Credits”, has no idea whether they hold 35, presses, and finds out. That is the trade being made deliberately — see the third state.",
    render: (state) => (
      <div className="flex flex-col items-start gap-2.5">
        {state === "included" ? (
          <span className="text-ui text-fg-meta">Included</span>
        ) : (
          <CreditAmount credits={creditsToUnits(35)} />
        )}
        <button type="button" className={buttonClasses()}>
          {CTA}
        </button>
        {state === "short" && (
          /*
            The upsell, and it only exists after the press. Nothing before the
            click says the balance is short, so this is the first moment the
            product mentions it — which is why it has to carry the whole
            message and the way out in one block.
          */
          <div className="mt-1 flex flex-col items-start gap-2 rounded-panel border border-amber-line bg-amber-tint-soft px-4 py-3">
            <span className="text-caption text-amber">
              Your monthly Credits are used up. Vibe didn&rsquo;t charge you.
            </span>
            <button type="button" className={inlineActionClasses()}>
              <CreditCoin size={14} />
              Top up
            </button>
          </div>
        )}
      </div>
    ),
  },
  {
    key: "chip",
    name: "3 · Der Preis als Behälter neben dem Knopf",
    argument:
      "The price gets the resting container every other control in the system now has, and sits beside the button rather than under it. It reads as part of the same object as the thing it prices, which is what it is.",
    cost: "It is a container that is not pressable, next to one that is — the first thing in the system to look like a control and refuse to be one. And on a phone the row wraps, at which point it is back under the button with a border around it.",
    render: (state) => (
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={buttonClasses()}>
          {CTA}
        </button>
        {state === "included" ? (
          <span className="inline-flex min-h-7 items-center rounded-full border border-line-3 px-3 text-ui text-fg-meta">
            Included
          </span>
        ) : (
          <span
            className={`inline-flex min-h-7 items-center gap-1.5 rounded-full border px-3 text-ui tabular-nums ${
              state === "short"
                ? "border-amber-line bg-amber-tint-soft text-amber"
                : "border-line-3 bg-surface-2 text-fg-body"
            }`}
          >
            {M(14)}
            {state === "short" ? "35 · you have 12" : "35 · of 420"}
          </span>
        )}
      </div>
    ),
  },
  {
    key: "inbutton",
    name: "4 · Der Preis im Knopf",
    argument:
      "Unmissable, and the shortest possible distance between the price and the press: the amount is on the control that spends it, so there is no reading order in which the button is seen and the cost is not.",
    cost: "Two costs, and the second is serious. A free operation reads “Run the audit again · Included”, which is a button apologising. And when the balance is short the amber sentence has nowhere to go — the state that most needs words is the one this treatment has no room for, so it needs a second line anyway and is treatment 2 with a louder button.",
    render: (state) => (
      <div className="flex flex-col items-start gap-2">
        <button type="button" className={buttonClasses()}>
          <span className="inline-flex items-center gap-2">
            {CTA}
            <span aria-hidden className="opacity-45">
              ·
            </span>
            {state === "included" ? (
              "Included"
            ) : (
              <span className="inline-flex items-center gap-1 tabular-nums">{M(14)}35</span>
            )}
          </span>
        </button>
        {state === "short" && (
          <span className="text-caption text-amber">You have 12. Not enough for this.</span>
        )}
      </div>
    ),
  },
];

const STATES: readonly { key: Money; label: string }[] = [
  { key: "priced", label: "Kostet" },
  { key: "included", label: "Inklusive" },
  { key: "short", label: "Aufgebraucht — nach dem Klick" },
];

function CompositionRow({ composition }: { composition: Composition }) {
  return (
    <section className="flex flex-col gap-4 border-t border-line-2 py-8">
      <div>
        <h3 className="text-title font-semibold text-fg">{composition.name}</h3>
        <p className="mt-2 max-w-[66ch] text-caption text-fg-prose">{composition.argument}</p>
        <p className="mt-2 max-w-[66ch] text-caption text-amber">{composition.cost}</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        {STATES.map((state) => (
          <div key={state.key} className="flex flex-col gap-2">
            <p className="eyebrow text-fg-meta">{state.label}</p>
            <div className="rounded-panel border border-line-2 bg-surface-1 px-5 py-5">
              {composition.render(state.key)}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function StudyCredits({ study }: { study: Study }) {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col px-6 py-12 max-sm:px-4">
      <header className="pb-5">
        <p className="eyebrow text-fg-meta">Credits</p>
        <h1 className="mt-3 text-headline font-semibold text-fg">
          Der Preis muss aussehen wie Geld
        </h1>
        <p className="mt-3 max-w-[66ch] text-lead text-fg-prose">
          Rendered in {study.name}. Under a primary control the product writes{" "}
          <span className="font-mono text-ui text-fg-secondary">35 Credits · of 420 available</span>{" "}
          and every part of it is body text. Nothing says the button above it spends money.
        </p>
        <p className="mt-3 max-w-[66ch] text-caption text-fg-muted">
          Four rules already constrain this and none is in question: the price is inline with the
          control and never behind it; a free operation says{" "}
          <span className="text-fg-secondary">Included</span> and never{" "}
          <span className="text-fg-secondary">0 Credits</span>; no ranges; and the ambient balance
          in the app shell stays restrained — its own docblock says Credits are how the product is
          paid for, <em className="text-fg not-italic">not what the product is about</em>.
        </p>
        <p className="mt-3 max-w-[66ch] text-caption text-fg-muted">
          Which is why this asks two questions. The balance a person glances at all day and the
          disclosure that money is about to move are different jobs, and a mark that is wrong in the
          first may be right in the second. Nothing here changes the shell.
        </p>
      </header>

      <div className="border-t border-line-3 pt-8">
        <p className="eyebrow text-mint">Frage 1 · Die Marke</p>
        <h2 className="mt-3 text-title font-semibold text-fg">Woran man einen Credit erkennt</h2>
        <p className="mt-3 max-w-[66ch] text-caption text-fg-prose">
          Drawn rather than imported: no catalogue has a Vibe Credit. Lucide supplies the generic
          set because a pencil means the same thing everywhere — a unit this product invented is one
          of the marks that stays hand-drawn, beside Nova&rsquo;s aperture and the wordmark. Each is
          shown at the three sizes it would really be rendered at, and once large enough to judge.
        </p>
      </div>

      {MARKS.map((mark) => (
        <MarkRow key={mark.key} mark={mark} />
      ))}

      <div className="mt-12 border-t border-line-3 pt-8">
        <p className="eyebrow text-mint">Frage 2 · Wie der Preis dasteht</p>
        <h2 className="mt-3 text-title font-semibold text-fg">Drei Zustände, nicht einer</h2>
        <p className="mt-3 max-w-[66ch] text-caption text-fg-prose">
          A price has three states and a treatment that only works for the first is not a treatment:
          it costs something, it costs nothing, or the balance will not cover it. All four are drawn
          in all three, with the same mark, so what is being compared is the composition.
        </p>
      </div>

      {COMPOSITIONS.map((composition) => (
        <CompositionRow key={composition.key} composition={composition} />
      ))}

      {/*
        Every size, because a guard measures what a page renders.

        `credit-amount.spec.ts` checks the coin's optical centring on "every
        price on the page" and its docblock claims that covers more than one
        size. It did not: the compositions above all draw the default, so the
        correction was verified at 16px and nowhere else — and it was wrong at
        13px in both palettes, in opposite directions. These three exist so the
        claim is true.
      */}
      <section className="mt-12 flex flex-col gap-4 border-t border-line-3 pt-8">
        <p className="eyebrow text-mint">Die Marke auf der Kapitalhöhe</p>
        <h2 className="text-title font-semibold text-fg">Every size the component has</h2>
        <p className="max-w-[66ch] text-caption text-fg-prose">
          The coin is placed from the loaded face&rsquo;s own cap height, so the same rule holds at
          each of these and in both palettes. Rendered here so the browser guard can measure all
          three rather than one.
        </p>
        <div className="flex flex-wrap items-end gap-8 rounded-panel border border-line-2 bg-surface-1 px-5 py-6">
          {(["sm", "md", "lg"] as const).map((size) => (
            <div key={size} className="flex flex-col gap-2">
              <span className="eyebrow text-fg-meta">{size}</span>
              <CreditAmount credits={creditsToUnits(2480)} size={size} />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

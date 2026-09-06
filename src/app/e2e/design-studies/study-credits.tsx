import type { ReactNode, SVGProps } from "react";
import { buttonClasses } from "@/components/ui/button";
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

type MarkProps = SVGProps<SVGSVGElement> & { size?: number };

/** Vibe's frame: 24 grid, 1.5px rendered at every size. */
function Frame({ size = 16, children, ...props }: MarkProps & { children: ReactNode }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={(1.5 * 24) / size}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {children}
    </svg>
  );
}

/** 1 · A ring holding a core. The shape money has had for three thousand years. */
function RingMark(props: MarkProps) {
  return (
    <Frame {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="3" />
    </Frame>
  );
}

/** 2 · Nova's aperture, reduced to three blades. */
function ApertureMark(props: MarkProps) {
  return (
    <Frame {...props}>
      <path d="M12 3.5 20.4 8v8L12 20.5 3.6 16V8Z" />
      <path d="M12 8.2 15.9 10.4v4.4L12 17l-3.9-2.2v-4.4Z" />
    </Frame>
  );
}

/** 3 · A meter: four segments, the last one short. Capacity that depletes. */
function MeterMark(props: MarkProps) {
  return (
    <Frame {...props}>
      <path d="M4 6.5h16" />
      <path d="M4 11h16" />
      <path d="M4 15.5h10" />
      <path d="M4 20h4" />
    </Frame>
  );
}

type Mark = {
  key: string;
  name: string;
  argument: string;
  cost: string;
  render: (size: number) => ReactNode;
};

const MARKS: readonly Mark[] = [
  {
    key: "ring",
    name: "1 · Ring mit Kern",
    argument:
      "The shape value has had for three thousand years, so it needs no learning: a reader knows this is a unit of something spendable before reading a word. Two concentric circles also survive 12px, which is where most of these are rendered.",
    cost: "It reads as a coin, and a Credit is not money. It does not come back, it cannot be refunded, and it buys one thing. A mark that says “currency” invites exactly the arithmetic ADR 0094 kept the zero out of bounds to avoid.",
    render: (size) => <RingMark size={size} />,
  },
  {
    key: "aperture",
    name: "2 · Die Blende, reduziert",
    argument:
      "What a Credit buys is Vibe doing something, not a token. Reducing Nova's aperture to two rings says which system is about to spend, and ties the price to the thing that will act rather than to a wallet.",
    cost: "Two marks that resemble each other in different jobs is the confusion ADR 0097 exists to prevent — it is the reason the hand-drawn chevron and arrow were replaced. Nova's mark means “Vibe is acting”; this would mean “Vibe acting costs”, at a glance apart.",
    render: (size) => <ApertureMark size={size} />,
  },
  {
    key: "meter",
    name: "3 · Der Zähler",
    argument:
      "Honest about what a Credit actually is: metered capacity that runs down. Four bars, the last one short — the mark itself carries the idea that there is a finite amount and it is being used up.",
    cost: "At 12px four strokes is a smudge, and worse, it looks like it is showing a level. It is not — it is the same mark whether you hold 40 or 4,000. A mark that appears to report state and does not is the false-state line the motion system already forbids.",
    render: (size) => <MeterMark size={size} />,
  },
  {
    key: "none",
    name: "4 · Kein Zeichen, nur Typografie",
    argument:
      "No mark at all: the number takes the mono face the product already owns for identifiers, and the unit sits beside it smaller and quieter. One less thing to learn, and it can never be wrong at any size, on any surface, in any state.",
    cost: "It does not answer the complaint. The objection was that the price reads as body text and does not say money is moving — and setting the same words in a different face is a smaller version of the same silence.",
    render: () => <span className="font-mono text-fg-secondary tabular-nums">CR</span>,
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

/** The mark used for question 2, so the comparison is of composition. */
const M = (size = 14) => <RingMark size={size} />;

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
    name: "2 · Marke und Zahl als ein Objekt, Deckung darunter",
    argument:
      "The price becomes one thing rather than four words: the mark and the number set together and brighter, with the balance demoted to a second, quieter line. The hierarchy says what it is — a charge, and then a reassurance about it.",
    cost: "Two lines where there was one, under every priced control in the product. On a dense screen with three of them that is six lines of billing, which is how a disclosure turns into an accounting page.",
    render: (state) => (
      <div className="flex flex-col items-start gap-2">
        <button type="button" className={buttonClasses()}>
          {CTA}
        </button>
        <div className="flex flex-col gap-0.5">
          {state === "included" ? (
            <span className="text-ui text-fg-meta">Included</span>
          ) : (
            <>
              <span className="inline-flex items-center gap-1.5 text-fg font-medium tabular-nums">
                {M(15)}35 Credits
              </span>
              <span className={`text-caption ${state === "short" ? "text-amber" : "text-fg-meta"}`}>
                {state === "short" ? "You have 12. Not enough for this." : "of 420 available"}
              </span>
            </>
          )}
        </div>
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
  { key: "short", label: "Reicht nicht" },
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
    </div>
  );
}

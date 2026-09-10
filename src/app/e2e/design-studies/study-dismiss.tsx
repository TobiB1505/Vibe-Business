import type { ReactNode } from "react";
import { DismissIcon } from "@/components/ui/icons.generated";
import type { Study } from "./studies";

/**
 * The container, not the mark.
 *
 * ## What the earlier comparison missed
 *
 * The dismiss study fixed the stroke — sub-pixel weight was why the cross read
 * as sketched, and the frame now states its stroke in screen pixels. But every
 * treatment in it kept a **bare** mark at rest, with a fill arriving only on
 * hover. That is the thing being objected to: a control reads as a control
 * because it has a container, and this one has none until a pointer is already
 * on it.
 *
 * A touch device makes that obvious — there is no hover, so a bare mark is a
 * bare mark forever. Every overlay dismiss on a phone is a filled circle for
 * exactly that reason, and the objection came from a phone.
 *
 * ## The question this actually asks
 *
 * Not whether to have a container — whether it is a circle.
 *
 * A circle is the convention, and it is also a different vocabulary from the
 * one this direction chose: "Precision & Light" runs 8px corners everywhere and
 * spends its contrast on edges. A pill in the middle of that is a borrowed
 * shape. Treatment 2 asks whether the same idea in Vibe's own corner is enough,
 * and 3 whether the fill can be held back to a hairline without losing the
 * "this is pressable" the container is there to say.
 */

const MARK = 16;

function Frame({
  children,
  size = 32,
  className,
}: {
  children: ReactNode;
  size?: number;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label="Close"
      style={{ width: size, height: size }}
      className={`inline-flex shrink-0 items-center justify-center transition-interactive ${className ?? ""}`}
    >
      {children}
    </button>
  );
}

type Treatment = {
  key: string;
  name: string;
  argument: string;
  cost: string;
  render: (size?: number) => ReactNode;
};

const TREATMENTS: readonly Treatment[] = [
  {
    key: "circle",
    name: "1 · Kreis, dauerhaft gefüllt",
    argument:
      "The pattern the objection pointed at. The fill is there at rest, so the control is a control before anything is hovered — on a phone, where nothing ever is. Hover lifts the fill rather than introducing it.",
    cost: "A circle in a system that runs 8px corners everywhere. It is the convention, and it is borrowed: nothing else on the screen is round.",
    render: (size) => (
      <Frame
        size={size}
        className="rounded-full bg-surface-3 text-fg-secondary hover:bg-surface-hover hover:text-fg"
      >
        <DismissIcon size={MARK} />
      </Frame>
    ),
  },
  {
    key: "square",
    name: "2 · Abgerundetes Quadrat, dauerhaft gefüllt",
    argument:
      "The same idea in this direction's own corner. Everything a container does — say pressable, hold a target, exist without a pointer — with none of the vocabulary borrowed from somewhere else.",
    cost: "Less conventional. A rounded square in a drawer header reads slightly more like a button and slightly less like a dismissal, which is a real difference on the one control people press without reading.",
    render: (size) => (
      <Frame
        size={size}
        className="rounded-nav bg-surface-3 text-fg-secondary hover:bg-surface-hover hover:text-fg"
      >
        <DismissIcon size={MARK} />
      </Frame>
    ),
  },
  {
    key: "hairline",
    name: "3 · Behälter als Hairline, Füllung bei Hover",
    argument:
      "The container is a one-pixel edge at rest and fills under the pointer. Quieter than a filled shape while still existing without one — which is the whole objection — and the edge is the material this direction already spends its contrast on.",
    cost: "A hairline on a dark surface is close to invisible at small sizes, and it is the treatment most likely to disappear against a card that already has a border of its own.",
    render: (size) => (
      <Frame
        size={size}
        className="rounded-nav border border-line-4 text-fg-muted hover:border-line-strong hover:bg-surface-hover hover:text-fg"
      >
        <DismissIcon size={MARK} />
      </Frame>
    ),
  },
  {
    key: "bare",
    name: "4 · Ohne Behälter (heute)",
    argument:
      "What ships, with the stroke fix applied. Kept in the comparison because it is the only one that costs no ink at rest, and because the difference is the whole argument.",
    cost: "On a touch device there is no state in which this looks like a control. It is a mark next to a heading.",
    render: (size) => (
      <Frame
        size={size}
        className="rounded-nav text-fg-muted hover:bg-surface-hover hover:text-fg-body"
      >
        <DismissIcon size={MARK} />
      </Frame>
    ),
  },
];

function Row({ treatment }: { treatment: Treatment }) {
  return (
    <section className="flex flex-col gap-5 border-t border-line-2 py-8">
      <div>
        <h2 className="text-title font-semibold text-fg">{treatment.name}</h2>
        <p className="mt-2 max-w-[66ch] text-caption text-fg-prose">{treatment.argument}</p>
        <p className="mt-2 max-w-[66ch] text-caption text-amber">{treatment.cost}</p>
      </div>

      {/* Three target sizes. 32 is the current one; 28 is the tightest a finger
          can be asked to find; 36 is what an overlay on a phone usually gets. */}
      <div className="flex flex-wrap items-end gap-6">
        {[28, 32, 36].map((size) => (
          <div key={size} className="flex flex-col items-center gap-2">
            {treatment.render(size)}
            <span className="font-mono text-meta text-fg-disabled">{size}px</span>
          </div>
        ))}
      </div>

      {/* On a card, which is where the drawer header puts it. */}
      <div className="rounded-card border border-line-3 bg-surface-2 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="eyebrow text-fg-meta">Evidence</p>
            <p className="mt-2 text-card-title font-semibold text-fg">
              Your code takes payments and your site offers no way to pay
            </p>
          </div>
          {treatment.render()}
        </div>
      </div>

      {/* Over content, which is where a phone puts it — and where a container
          has to survive whatever happens to be behind it. */}
      <div className="relative overflow-hidden rounded-card border border-line-2 bg-well p-5">
        <p className="max-w-[52ch] text-caption text-fg-muted">
          Vibe found a payments integration in the repository and no pricing or checkout page on the
          live site. Someone who wants to buy has nowhere to do it, so the integration earns
          nothing.
        </p>
        <div className="absolute top-3 right-3">{treatment.render()}</div>
      </div>
    </section>
  );
}

export function StudyDismiss({ study }: { study: Study }) {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col px-6 py-12 max-sm:px-4">
      <header className="pb-5">
        <p className="eyebrow text-fg-meta">Dismiss container</p>
        <h1 className="mt-3 text-headline font-semibold text-fg">
          A control looks like one because it has a container
        </h1>
        <p className="mt-3 max-w-[66ch] text-lead text-fg-prose">
          Rendered in {study.name}, with the stroke fix in place — every mark here is 1.5px on
          screen at every size. What changes down the page is only what is around it.
        </p>
        <p className="mt-3 max-w-[66ch] text-caption text-fg-muted">
          Each treatment is shown at three target sizes, on a card, and over content — the last one
          because a container that works on a panel can vanish on a dark well.
        </p>
      </header>

      {TREATMENTS.map((treatment) => (
        <Row key={treatment.key} treatment={treatment} />
      ))}
    </div>
  );
}

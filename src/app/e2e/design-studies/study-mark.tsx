import type { ReactNode, SVGProps } from "react";
import { DismissIcon } from "@/components/ui/icons.generated";
import type { Study } from "./studies";

/**
 * Why the dismiss mark looks drawn rather than drawn *by an icon set*.
 *
 * ## The measurement
 *
 * `IconFrame` sets `stroke-width: 1.8` in **viewBox units**, and the viewBox is
 * 24. So the stroke on screen is `1.8 × size / 24`:
 *
 *   size 13 → 0.98px      size 16 → 1.20px      size 24 → 1.80px
 *   size 15 → 1.13px      size 18 → 1.35px
 *
 * The product uses 13 to 22, and 15/16/17 for almost everything. Every icon in
 * it is therefore drawn with a sub-pixel stroke, which a display resolves by
 * spreading it across two rows of pixels at partial opacity. That is the soft,
 * sketched quality — it is not the shape, it is the weight, and it is on all
 * thirty-nine marks rather than on this one.
 *
 * The cross has a second problem of its own. Lucide's `x` spans 6→18 of a
 * 24 grid: half the box, corner to corner. At 16px that is an 8px cross made of
 * 1.2px lines, which reads as two long strokes rather than as a compact glyph.
 * Every current product draws its dismiss inset and slightly heavier.
 *
 * ## What is being compared
 *
 * Treatment 1 is what ships. 2 fixes the weight for the whole set. 3 fixes the
 * weight and the cut of this one mark. 4 keeps the mark small and gives it the
 * hit area instead. Each is shown at the four sizes the product actually uses,
 * because a fix that only works at 24px fixes nothing here.
 */

/* ── The frames under test ─────────────────────────────────────────── */

type MarkProps = SVGProps<SVGSVGElement> & { size?: number };

/**
 * The optical fix: keep the *rendered* stroke constant.
 *
 * `strokeWidth` is expressed in viewBox units, so it has to be divided by the
 * scale the frame is being rendered at. 1.5px on screen at every size, rather
 * than 1.8 viewBox units that become whatever they become.
 */
function OpticalFrame({
  size = 16,
  strokePx = 1.5,
  children,
  ...props
}: MarkProps & { strokePx?: number; children: ReactNode }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={(strokePx * 24) / size}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {children}
    </svg>
  );
}

/** Lucide's cross, unchanged: 6→18, half the box. */
const LUCIDE_CROSS = (
  <>
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </>
);

/** Inset to 7.5→16.5 — nine units instead of twelve. A glyph, not a diagonal. */
const COMPACT_CROSS = (
  <>
    <path d="M16.5 7.5 7.5 16.5" />
    <path d="m7.5 7.5 9 9" />
  </>
);

const SIZES = [13, 15, 16, 18] as const;

type Treatment = {
  key: string;
  name: string;
  argument: string;
  cost: string;
  mark: (size: number) => ReactNode;
  /** The mark inside its real target, which is where it is actually judged. */
  hit?: string;
};

const TREATMENTS: readonly Treatment[] = [
  {
    key: "today",
    name: "1 · Wie es heute rendert",
    argument:
      "Lucide's cross through the current frame. The shape is right and the weight is not: 1.8 viewBox units become 1.2px at 16, so the display spreads the line across two pixel rows at partial opacity.",
    cost: "This is the reference, and it is what every one of the thirty-nine icons does.",
    mark: (size) => <DismissIcon size={size} />,
  },
  {
    key: "optical",
    name: "2 · Strichstärke optisch kompensiert",
    argument:
      "Same path, same set, one change in the frame: the stroke is expressed so that it lands on 1.5px on screen whatever the icon is scaled to. This is the fix that applies to all thirty-nine at once.",
    cost: "Nothing about the cross's proportions changes — it is still half the box, still corner to corner. Sharper, but still a large thin cross.",
    mark: (size) => <OpticalFrame size={size}>{LUCIDE_CROSS}</OpticalFrame>,
  },
  {
    key: "compact",
    name: "3 · Kompensiert und kompakter geschnitten",
    argument:
      "The weight fix plus a shorter cross — nine units instead of twelve, inset from the edges. This is the proportion a dismiss actually has in current products: a small dense mark, not a diagonal across the whole box.",
    cost: "A deliberate departure from Lucide for this one mark, which means it is drawn here and has to stay in step if the set is ever regenerated.",
    mark: (size) => <OpticalFrame size={size}>{COMPACT_CROSS}</OpticalFrame>,
  },
  {
    key: "area",
    name: "4 · Kleines Zeichen, große Fläche",
    argument:
      "The compact cross held at 14px regardless, inside the same 32px target with the hover fill doing the work. The mark stops competing with the text beside it and the control stays as easy to hit.",
    cost: "At 13 and 15 there is nothing left to compare — the mark is the same in every column, which is the point and also the reason this row looks repetitive.",
    mark: () => <OpticalFrame size={14}>{COMPACT_CROSS}</OpticalFrame>,
    hit: "min-h-8 min-w-8",
  },
];

function Row({ treatment }: { treatment: Treatment }) {
  return (
    <section className="flex flex-col gap-4 border-t border-line-2 py-8">
      <div>
        <h2 className="text-title font-semibold text-fg">{treatment.name}</h2>
        <p className="mt-2 max-w-[66ch] text-caption text-fg-prose">{treatment.argument}</p>
        <p className="mt-2 max-w-[66ch] text-caption text-amber">{treatment.cost}</p>
      </div>

      {/* Bare, at the four sizes the product uses. */}
      <div className="flex flex-wrap items-end gap-7">
        {SIZES.map((size) => (
          <div key={size} className="flex flex-col items-center gap-2">
            <span className="text-fg-body">{treatment.mark(size)}</span>
            <span className="font-mono text-meta text-fg-disabled">{size}px</span>
          </div>
        ))}
      </div>

      {/* In place: the drawer header, at the size that header actually uses. */}
      <div className="rounded-card border border-line-3 bg-surface-2 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="eyebrow text-fg-meta">Evidence</p>
            <p className="mt-2 text-card-title font-semibold text-fg">
              Your code takes payments and your site offers no way to pay
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            className={`inline-flex items-center justify-center rounded-nav px-1.5 text-fg-muted transition-interactive hover:bg-surface-hover hover:text-fg-body ${
              treatment.hit ?? "min-h-8 min-w-8"
            }`}
          >
            {treatment.mark(16)}
          </button>
        </div>
      </div>
    </section>
  );
}

export function StudyMark({ study }: { study: Study }) {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col px-6 py-12 max-sm:px-4">
      <header className="pb-5">
        <p className="eyebrow text-fg-meta">Dismiss mark</p>
        <h1 className="mt-3 text-headline font-semibold text-fg">
          Why it reads as drawn rather than as an icon
        </h1>
        <p className="mt-3 max-w-[66ch] text-lead text-fg-prose">
          Rendered in {study.name}. The frame sets its stroke in viewBox units, so a 16px icon draws
          at 1.2px and a 13px icon at 0.98px — sub-pixel, spread across two rows by the display.
          That softness is on all thirty-nine marks, not on this one.
        </p>
        <p className="mt-3 max-w-[66ch] text-caption text-fg-muted">
          Zoom in. The difference between rows 1 and 2 is entirely weight; between 2 and 3 it is the
          cut of the cross.
        </p>
      </header>

      {TREATMENTS.map((treatment) => (
        <Row key={treatment.key} treatment={treatment} />
      ))}
    </div>
  );
}

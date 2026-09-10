import { formatCreditsForDisplay, type CreditUnits } from "@/modules/credits/units";
import { cn } from "@/lib/utils/cn";
import { CreditCoin } from "./credit-coin";

/**
 * A price: the coin and the number, as one object.
 *
 * ## Why this is a component and not two elements
 *
 * Because the coin has to be optically centred against the digits, and that is
 * not what `items-center` does. Flex centres the coin against the text's *line
 * box*, which reserves room for descenders — and "35" has none. Measured at
 * 16px against a 12px cap height, the coin sat a pixel low, which is enough to
 * look like a mistake and not enough to see why.
 *
 * ## Why the correction is `cap` and not `em`
 *
 * It was `-0.06em`, described as "half a typical descender depth". A typical
 * descender is a guess about a *face*, and this product loads two: measured on
 * the account rail at 13px, the same constant put the coin 0.47px **low** in
 * the first palette and 0.53px **high** in the second, because Inter and Geist
 * do not agree about where a capital ends. One em constant cannot serve both,
 * and the second palette failed the half-pixel bar the guard already set.
 *
 * So the coin is placed from the font's own metric. The row aligns on the
 * baseline; the wrapper's bottom edge sits on it; and the coin is pushed back
 * down by `half its own height minus half a cap`, which lands its centre
 * exactly at the middle of a capital. `cap` is the real cap height of the
 * loaded face, so this is right for Inter, right for Geist, and right at every
 * size in `SIZES` without a table.
 *
 * If a browser does not know `cap` the `calc()` is invalid and the transform
 * drops, which leaves the coin where flex put it — the pre-correction position,
 * about a pixel out. That is the same degradation the `em` version had and it
 * is not a blank or a jump.
 *
 * ## Why the coin is sized from the cap height
 *
 * A mark set to the em is bigger than the letters beside it, because the em
 * includes space the digits never use. Sizing from the cap height is what makes
 * the coin read as the same weight as the number rather than as a bullet in
 * front of it.
 *
 * ## What it deliberately does not show
 *
 * The balance. Vibe states what a thing costs and never what is left, so the
 * price is the whole of this component — see `CostDisclosure` for why.
 */

const SIZES = {
  /** Inline, in a row or a sentence. */
  sm: { text: "text-ui", coin: 15 },
  /** The price under or above a control: the default. */
  md: { text: "text-base font-medium", coin: 18 },
  /** A billing surface, where the amount is the subject rather than a note. */
  lg: { text: "text-title font-semibold", coin: 26 },
} as const;

/**
 * A tone is a prop rather than a `className`, and it has to be.
 *
 * `cn` is a filtered join, not `tailwind-merge`: a caller appending
 * `text-amber` would land it *beside* the `text-fg` in the base list and let
 * stylesheet order decide, which is how a tint gets written, generated,
 * shipped and never seen. The same trap the surface tones fell into once.
 */
export type CreditTone = "default" | "low";

const TONE_CLASSES: Record<CreditTone, string> = {
  default: "text-fg",
  /* A balance worth noticing. Amber is this product's word for waiting or
     short — never coral, which means something failed. */
  low: "text-amber",
};

export function CreditAmount({
  credits,
  size = "md",
  tone = "default",
  className,
}: {
  credits: CreditUnits;
  size?: keyof typeof SIZES;
  tone?: CreditTone;
  className?: string;
}) {
  const { text, coin } = SIZES[size];
  return (
    <span
      /* A hook for the browser test that measures the optical centring. The
         correction is in `em` and depends on the loaded face's cap height, so
         only a browser can check it — and only if it can find this reliably. */
      data-credit-amount
      className={cn(
        // Baseline, not centre: the correction below is measured from the
        // text's own baseline, so the row has to align on it.
        "inline-flex items-baseline gap-2 tabular-nums",
        TONE_CLASSES[tone],
        text,
        className,
      )}
    >
      {/*
        The optical correction, on a wrapper rather than on the svg: the coin
        keeps its own box for layout, and only the paint moves.

        An inline-flex with no baseline-aligned child takes its baseline from
        its own bottom edge, so this box hangs *above* the text baseline. The
        translate pushes it back down until the coin's centre sits half a cap
        above that baseline — the middle of a capital, which is where a mark
        beside a word belongs.
      */}
      <span
        aria-hidden
        className="inline-flex"
        style={{ transform: `translateY(calc(${coin / 2}px - 0.5cap))` }}
      >
        <CreditCoin size={coin} />
      </span>
      {formatCreditsForDisplay(credits)} Credits
    </span>
  );
}

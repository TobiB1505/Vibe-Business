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
 * The correction is `-0.06em`: half a typical descender depth, expressed in em
 * so it scales with the text rather than being a magic pixel that is right at
 * one size and wrong at the other five. A call site that composed this by hand
 * would get it wrong, and each one would get it wrong differently.
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
        "inline-flex items-center gap-2 tabular-nums",
        TONE_CLASSES[tone],
        text,
        className,
      )}
    >
      {/*
        The optical correction, on a wrapper rather than on the svg: the coin
        keeps its own box for layout, and only the paint moves. `-0.06em`
        resolves against this span's inherited font size, so it stays right at
        every size in SIZES and at any the caller sets.
      */}
      <span aria-hidden className="inline-flex translate-y-[-0.06em]">
        <CreditCoin size={coin} />
      </span>
      {formatCreditsForDisplay(credits)} Credits
    </span>
  );
}

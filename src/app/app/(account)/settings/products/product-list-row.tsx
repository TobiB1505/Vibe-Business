import Link from "next/link";
import { ProductLogo } from "@/components/brand/product-logo";
import { ArrowRightIcon } from "@/components/ui/dashboard-icons";
import { scoreDisplay, type ScoreTone } from "@/components/ui/score-display";
import { statusForScoreTone } from "@/components/system/status-vocabulary";
import { StatusPill, statusToneText } from "@/components/ui/status-pill";
import { figureClasses } from "@/components/ui/figure";
import { cn } from "@/lib/utils/cn";
import { initialsFrom } from "@/modules/auth/initials";
import { productDisplayName } from "@/modules/projects/display-name";
import type { ProductOverviewItem } from "@/modules/projects/product-summary";
import { productListStatus } from "./product-list-state";

/**
 * One product, as a row (UI-33).
 *
 * ## What this replaced, and why
 *
 * A card, and it carried four zones at four rhythms: an identity block, a
 * three-column grid of profile facts, a list of repository metadata, and a
 * score with a sparkline. Measured in v2, three products rendered at 252, 194
 * and 231 pixels, because the facts grid collapses when Vibe has not read a
 * product yet — so nothing lined up down a page whose whole job is to be
 * scanned.
 *
 * Worse, the collapse was verbose about itself. One card printed the same
 * absence **seven times in five wordings**: `NOT ANALYSED`, "No product
 * summary is available yet", "Not established yet" three times, "Product
 * profile pending", "No data yet" and "Analysed not yet" — which is not
 * English, and which disagreed with the pill two lines above it.
 *
 * ## What a row carries
 *
 * The mark, the name, the state as a word, the signal, and where pressing
 * goes. That is the question this page answers — *which of my products wants
 * something from me* — and every other fact on the old card answers a
 * question a founder asks **inside** the product, where there is room for it.
 *
 * The row is one height whatever Vibe knows, and an unread product says so
 * once: its state pill. No second sentence, no third.
 *
 * ## The mark keeps its tone, and its fallback is not Vibe's
 *
 * The tile still rings the mark in the score's tone, so a founder scanning the
 * column sees the same signal twice without reading a number. The fallback is
 * the product's initials rather than `ProductLogo`'s default Vibe mark: on a
 * list of the customer's own products, Vibe's mark would read as a claim about
 * whose product this is.
 */

const TILE_TONE: Record<ScoreTone, string> = {
  strong: "from-mint/35 via-mint/15 to-surface-hover border-mint-line text-mint",
  partial: "from-amber/35 via-amber/15 to-surface-hover border-amber-line text-amber",
  weak: "from-coral/35 via-coral/15 to-surface-hover border-coral-line text-coral",
  unscored: "from-white/10 via-white/[0.04] to-surface-hover border-line-strong text-fg-body",
};

export function ProductListRow({
  product,
  /** Every row but the first carries the hairline above it. */
  divided,
}: {
  product: ProductOverviewItem;
  divided: boolean;
}) {
  /*
   * The name the product goes by, falling back to the label the founder typed.
   *
   * `product.name` is the *project* name — usually a repository slug chosen at
   * connection time. `productName` is what Vibe read the product calling
   * itself. The row leads with the latter and keeps the former visible below
   * when they differ, because a founder who typed "invoicing-app" still has to
   * recognise their own row.
   */
  const displayName = productDisplayName(product);
  const projectLabelDiffers = displayName !== product.name;

  const display = scoreDisplay(product.score);
  const status = productListStatus(product);
  const scored = product.scoreState === "scored" && product.score !== null;

  return (
    /*
      The hairline belongs to the list item, not to the link.

      On the link it made the first row one pixel shorter than its neighbours —
      which is the height problem this rebuild removed, reintroduced by a
      border. It also put the hover fill *under* the divider, so hovering a row
      dimmed the line above it.
    */
    <li data-testid="product-list-row" className={cn(divided && "border-line-2 border-t")}>
      <Link
        href={`/app/projects/${product.id}`}
        aria-label={`Open ${displayName}`}
        className={cn(
          "group hover:bg-surface-hover flex items-center gap-4 px-5 py-4 transition-interactive",
          "max-sm:flex-wrap max-sm:gap-y-3 max-sm:px-4",
        )}
      >
        {/*
          The mark and the name are one item, so the row wraps in the right
          place on a phone: they take the first line together and the state and
          signal go under them. Wrapping the *name* alone put the mark on a
          line of its own; not wrapping at all fitted everything by truncating
          "Payflow" to "Payflo…" beside a pill that never shrinks — which is
          the one thing on the row a founder is actually reading.
        */}
        <span className="flex min-w-0 flex-1 items-center gap-4 max-sm:basis-full">
          <span
            aria-hidden
            className={cn(
              "flex size-11 shrink-0 items-center justify-center rounded-nav border bg-gradient-to-br",
              "text-caption font-bold tracking-[-0.02em]",
              TILE_TONE[display.tone],
            )}
          >
            {product.logoUrl ? (
              <ProductLogo
                src={product.logoUrl}
                alt=""
                className="size-7 object-contain"
                fallback={initialsFrom(displayName)}
              />
            ) : (
              initialsFrom(displayName)
            )}
          </span>

          {/*
            No reserved height here, and that is measured rather than assumed.

            A `min-h-9` sat on this column to hold two lines' worth for the rows
            that carry a project label. Removing it changed nothing: the mark
            beside it is 44px and the tallest this column reaches is 36, so the
            mark sets the row height either way. The guard that should have
            caught the removal passed — which is how a class that claims to do
            something and does not gets found.
          */}
          <span className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
            <h2 className="text-fg truncate text-ui font-semibold" title={displayName}>
              {displayName}
            </h2>
            {/*
              Only when it differs. A row whose product name already is the
              label the founder typed needs no second line saying so again.
            */}
            {projectLabelDiffers && (
              <span className="text-fg-meta truncate text-caption">Project: {product.name}</span>
            )}
          </span>
        </span>

        <StatusPill tone={status.tone} className="shrink-0 normal-case tracking-normal">
          {status.label}
        </StatusPill>

        {/*
          The signal, as a number and nothing else.

          The card drew a sparkline beside it, which on a list of three
          products is a decoration: a trend is a thing to read once you have
          decided which product you are looking at, and the page it belongs to
          has room to draw it properly.

          An unread product says so here rather than adding a fourth sentence
          about it — the pill beside it has already named the state.
        */}
        <span className="w-24 shrink-0 text-right max-sm:w-auto">
          {scored ? (
            <span className="flex items-baseline justify-end gap-1">
              <span
                className={figureClasses("sm", statusToneText(statusForScoreTone(display.tone)))}
              >
                {product.score}
              </span>
              <span className="text-fg-meta text-caption">/100</span>
            </span>
          ) : (
            <span className="text-fg-meta text-caption">
              {product.scoreState === "insufficient_coverage" ? "Not enough evidence" : "—"}
            </span>
          )}
        </span>

        <ArrowRightIcon
          size={16}
          className="text-fg-meta shrink-0 transition-transform duration-200 group-hover:translate-x-1 group-hover:text-fg-body max-sm:hidden"
        />
      </Link>
    </li>
  );
}

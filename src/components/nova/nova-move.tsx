import { CostDisclosure } from "@/components/system/cost-disclosure";
import { priceDisplayFor } from "@/components/ui/credit-price";
import type { CostBalance } from "@/components/system/cost-disclosure";
import type { RetailOperationKind } from "@/modules/credits/retail";

/**
 * The Move: the one control shape Nova's thread uses.
 *
 * Written in the design lab and moved here when the product began rendering
 * it. The lab still draws it — by importing this file, because two copies of
 * one control is how a lab stops being an answer to anything.
 */

/**
 * The one action a moment offers, with its cost inside it.
 *
 * ## Which design this is, and why
 *
 * Variant **B** from `study-move`, chosen at review: a dark surface with one
 * lit edge, mint as line and label only. The three were compared in all four
 * states, and B is the one whose resting state carries no area of accent —
 * emphasis comes from luminance, which is the chosen direction's own sentence
 * rather than a preference. The filled mint block every earlier study used
 * belongs to a direction that was not chosen.
 *
 * ## The cost is inside, not beside
 *
 * A price rendered next to a control is two objects for one commitment, and
 * the blocked study proved the failure mode: its separate chip printed "Trying
 * again costs" with nothing after it, because `agent_execution` resolves to a
 * silent display. Here the cost is a child, so it cannot come apart from the
 * thing it prices, and an absent cost simply leaves the row's right side
 * empty rather than leaving a label stranded.
 *
 * ## Geometry does not depend on state
 *
 * The row is full measure in every state. A Move that shrank when its price
 * disappeared would change size as a project changed, which is the reflow the
 * motion obligations exist to prevent — and it would make the priced and free
 * versions of the same decision look like different kinds of thing.
 *
 * ## Two layouts, and why the second one exists
 *
 * `row` puts the cost beside the label and is right for a single control at
 * reading width. `tile` stacks them, which is what lets three of them stand
 * side by side without any of them wrapping — and wrapping was the whole
 * failure of the first side-by-side attempt: a priced control broke onto two
 * lines beside a free one and the row stopped being a row.
 *
 * A tile is taller and narrower on purpose. Three tiles fill the block they
 * sit under rather than stacking a column that grows with every option.
 */
export function NovaMove({
  label,
  operation = null,
  balance,
  /** Where it goes, when pressing leaves the product. Said before the click. */
  leavesTo,
  /** `tile` stacks the cost under the label, so three can stand side by side. */
  layout = "row",
  className,
}: {
  label: string;
  /** The retail kind this charges under. Null when free or unpriced. */
  operation?: RetailOperationKind | null;
  balance?: CostBalance | null;
  leavesTo?: string;
  layout?: "row" | "tile";
  className?: string;
}) {
  const tile = layout === "tile";

  return (
    <span
      className={`move-lit relative flex w-full overflow-hidden rounded-nav border border-line-3 bg-surface-2 ${
        tile
          ? // A tile on a wide screen and a row on a phone. Three tiles in one
            // column is three short controls with an empty line under each,
            // which is the shape the stacking was meant to avoid.
            "min-h-[5.25rem] flex-col justify-between gap-2 px-4 py-3.5 max-sm:min-h-0 max-sm:flex-row max-sm:items-center max-sm:gap-4 max-sm:px-4 max-sm:py-3"
          : "items-center justify-between gap-4 px-4 py-3"
      } ${className ?? ""}`}
    >
      {/*
        The control's only light. A hairline at partial width at rest, reaching
        the full edge on hover — nothing moves position, so there is no reflow
        and nothing to reserve.
      */}
      <span
        aria-hidden
        className="move-lit-band pointer-events-none absolute inset-x-0 top-0 h-px"
      />
      <span className={`text-ui font-semibold text-mint ${tile ? "text-balance" : ""}`}>
        {label}
      </span>
      {/*
        A tile always reserves the second line, priced or not. Three tiles whose
        heights depended on whether each one cost something would be three
        different sizes of decision on one row, which is the thing a row of
        equals is for saying they are not.
      */}
      <span className={tile ? "min-h-[1.25rem] max-sm:min-h-0" : "contents"}>
        {leavesTo ? (
          <span className="shrink-0 text-caption text-fg-meta">{leavesTo}</span>
        ) : (
          <CostDisclosure operation={operation} balance={balance} />
        )}
      </span>
    </span>
  );
}

/**
 * The moves a moment offers, side by side.
 *
 * ## Three, and never four
 *
 * A cap rather than a scroll or a wrap. Past three the row stops being
 * scannable and starts being a menu, and a founder reading a thread is not
 * shopping. The ranking is `deriveNovaFocus`'s, so the three shown are the
 * three it put first — this renders a decision that was already made rather
 * than making one.
 *
 * Nothing is hidden by the cap: the rail lists everything open, with the same
 * words, which is the surface built for the full set. A thread shows what to
 * do next; a list shows what there is.
 *
 * ## Why they are tiles, and why one is not
 *
 * So none of them wraps. The first side-by-side attempt used rows and a priced
 * control broke onto two lines beside a free one, which made a spend and a
 * navigation read as two different sizes of thing. Stacked, they are one shape
 * at one height, and three of them fill the width of the block above.
 *
 * A lone move is a row instead. The tile shape exists so that several controls
 * can stand beside each other at one height; one has nothing to stand beside,
 * and rendering it as a tile leaves a third of the width taken by a control
 * with an empty line under it. Most of the twenty-one moments offer exactly
 * one move, which is where that showed.
 */
export function NovaMoves({
  moves,
  balance,
}: {
  moves: readonly {
    label: string;
    operation?: RetailOperationKind | null;
    leavesTo?: string;
  }[];
  balance?: CostBalance | null;
}) {
  const shown = moves.slice(0, 3);
  const [only] = shown;
  if (!only) return null;

  if (shown.length === 1) {
    return (
      <div className="max-w-[24rem]">
        <NovaMove
          label={only.label}
          operation={only.operation ?? null}
          leavesTo={only.leavesTo}
          balance={balance}
        />
      </div>
    );
  }

  return (
    <div
      className={`grid gap-2.5 max-sm:grid-cols-1 ${
        shown.length === 2 ? "sm:grid-cols-2" : "sm:grid-cols-3"
      }`}
    >
      {shown.map((move) => (
        <NovaMove
          key={move.label}
          label={move.label}
          operation={move.operation ?? null}
          leavesTo={move.leavesTo}
          balance={balance}
          layout="tile"
        />
      ))}
    </div>
  );
}

/**
 * Whether a Move will actually show a cost, asked the way the component asks
 * it.
 *
 * Exported because callers sometimes need to know *before* laying out — a
 * heading that says "this costs" is a dangling label when the answer is no.
 * `priceDisplayFor` is the same function `CostDisclosure` consults, so the two
 * can never disagree.
 */
export function novaMoveShowsCost(operation: RetailOperationKind | null): boolean {
  if (operation === null) return false;
  return priceDisplayFor(operation).kind !== "silent";
}

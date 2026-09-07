import Link from "next/link";
import { ArrowRightIcon } from "@/components/ui/dashboard-icons";
import { ProductMark } from "@/components/brand/product-mark";
import { scoreDisplay } from "@/components/ui/score-display";
import { statusForScoreTone } from "@/components/system/status-vocabulary";
import { statusToneText } from "@/components/ui/status-pill";
import { Reveal } from "@/components/ui/motion";
import { cn } from "@/lib/utils/cn";
import { productDisplayName } from "@/modules/projects/display-name";
import type { AttentionTier } from "@/modules/projects/attention";
import type { DeskEntry } from "./desk";

/**
 * One entry on the desk, closed.
 *
 * ## Why a row and not a card
 *
 * Because the screen is a ranking, and a ranking is read down. Three equal
 * cards in a grid make three things look equally urgent, which is the exact
 * claim the tier order exists to deny — and a grid re-flows into two columns
 * at some width, at which point the reading order stops being the ranking.
 *
 * A row also scales. One product and twenty produce the same screen.
 *
 * ## What a row carries, and what it deliberately does not
 *
 * The tier, the product, the one sentence naming what is waiting, the score,
 * and where it goes. Not the detail sentence, not the dates, not the ratings:
 * those belong to the entry when it is the head, and printing them on every
 * row is how a list becomes the grid it replaced.
 *
 * The score is the *product's* reading, not the item's — one product raising
 * two items shows the same number twice, correctly, because it is one product.
 *
 * A micro-sparkline was drawn here and removed. At 80px with the two or three
 * readings a real account has, it was a dot, a dashed break and a stub — a
 * shape carrying no trend, next to the number that already is the reading.
 * Removing it is the finding.
 */

const TIER_DOT: Record<AttentionTier, string> = {
  blocked: "bg-coral",
  decision: "bg-amber",
  ready: "bg-mint",
  setup: "bg-fg-meta",
};

const TIER_LABEL: Record<AttentionTier, string> = {
  blocked: "Blocked",
  decision: "Needs you",
  ready: "Ready",
  setup: "Setup",
};

function Score({ project }: { project: DeskEntry["project"] }) {
  if (project.scoreState !== "scored" || project.score === null) {
    return (
      <span className="text-fg-meta shrink-0 text-caption">
        {project.scoreState === "insufficient_coverage" ? "No evidence" : "Not analysed"}
      </span>
    );
  }

  const { tone } = scoreDisplay(project.score);
  return (
    /* The number at every width. `/100` is the denominator a wide row has room
       to state; on a phone the score is the only figure in the row, so there
       is nothing for it to be confused with. */
    <span className="flex shrink-0 items-baseline gap-1 font-semibold tabular-nums">
      <span className={statusToneText(statusForScoreTone(tone))}>{project.score}</span>
      <span className="text-fg-meta hidden text-caption sm:inline">/100</span>
    </span>
  );
}

export function DeskRow({ entry, index }: { entry: DeskEntry; index: number }) {
  const { project } = entry;
  const name = productDisplayName(project);
  const href = entry.kind === "item" ? entry.item.action.href : `/app/projects/${project.id}`;
  const title = entry.kind === "item" ? entry.item.title : "Nothing waiting";
  const detail = entry.kind === "item" ? entry.item.detail : null;
  const tierLabel = entry.kind === "item" ? TIER_LABEL[entry.item.tier] : "Settled";
  const dot = entry.kind === "item" ? TIER_DOT[entry.item.tier] : "bg-line-strong";

  return (
    <Reveal as="li" index={index}>
      <Link
        href={href}
        className={cn(
          "group border-line-2 bg-surface-2 vibe-surface vibe-surface-panel rounded-panel",
          "flex items-center gap-4 border px-4 py-3.5 sm:px-5",
          // Craft, not choreography: the row lifts its edge and its ground a
          // step. No transform, so nothing under a reader's eye moves.
          "transition-interactive hover:border-line-strong hover:bg-surface-3",
          "focus-visible:ring-mint focus-visible:ring-2 focus-visible:outline-none",
        )}
      >
        <span
          aria-hidden
          className={cn("size-1.5 shrink-0 rounded-full", dot)}
          /* The tier is written in words beside it; the dot is the scan. */
        />

        <ProductMark logoUrl={project.logoUrl} name={name} size="sm" />

        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-fg-meta text-caption truncate">
            {name} · {tierLabel}
          </span>
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="text-fg shrink-0 text-ui font-semibold">{title}</span>
            {/*
              The sentence, inline and only where there is room for it.
              Not a second line: a row that stacks a title over a paragraph is
              the card this list replaced. Here it reads as the sentence
              continuing, and below `lg` it is simply not there — which is also
              where the row has no width to spare.
            */}
            {detail && (
              <span className="text-fg-muted hidden min-w-0 truncate text-caption lg:inline">
                {detail}
              </span>
            )}
          </span>
        </span>

        <Score project={project} />

        <ArrowRightIcon
          size={16}
          className="text-fg-meta shrink-0 transition-transform duration-200 group-hover:translate-x-0.5"
        />
      </Link>
    </Reveal>
  );
}

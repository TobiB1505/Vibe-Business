import Link from "next/link";
import { ArrowRightIcon } from "@/components/ui/dashboard-icons";
import { EmptyState } from "@/components/ui/states";
import { Surface } from "@/components/ui/surface";
import { MonoLabel } from "@/components/ui/typography";
import { cn } from "@/lib/utils/cn";
import {
  ATTENTION_DISPLAY_LIMIT,
  type AttentionItem,
  type AttentionTier,
} from "@/modules/projects/attention";

/**
 * Everything else that is waiting, in the order the product ranks it.
 *
 * ## Why this exists again
 *
 * CORE-6 removed the attention list, and the reason it gave was that "the
 * information was per-product and already encoded in each card's action". Two
 * things in `attention.ts` say that is lossy, and one of them says so in its
 * own words:
 *
 * - **A project raises more than one item.** `itemsForProject` is explicit:
 *   "a project with a failed validation and waiting moves genuinely needs
 *   attention twice, and hiding one behind the other would mean the user never
 *   sees it." A card has one action, so today the second item is hidden behind
 *   the first — exactly the outcome that comment refuses.
 * - **The tier is not on a card at all.** `blocked`, `decision`, `ready` and
 *   `setup` are four different urgencies, and a product grid renders a blocked
 *   validation and a never-run audit as the same rectangle with a different
 *   verb.
 *
 * So the model comes back, and it comes back *beside* the hero rather than
 * above the grid — which is also what fills the dashboard's dead right-hand
 * half. What CORE-6 was right about is preserved: this is a level-2 panel next
 * to a level-3 card, so the screen still has exactly one primary object.
 *
 * ## What it deliberately does not show
 *
 * The hero's own first item. That is the one the card beside it already
 * answers with its control, and a screen that asks for the same click twice is
 * the "equally weighted doors" the hero was merged to remove. Any *further*
 * item the hero product raises does appear — that is the whole point.
 */

/**
 * A tier is an urgency, and it is drawn as one.
 *
 * Deliberately not `StatusPill`: a pill is a state something is *in*, and
 * these rows already carry their state in words. This is a rank, so it is the
 * quietest mark that can carry four levels — a dot, in the tone the rest of
 * the product already uses for blocked, waiting and ready.
 */
const TIER_DOT: Record<AttentionTier, string> = {
  blocked: "bg-coral",
  decision: "bg-amber",
  ready: "bg-mint",
  setup: "bg-fg-meta",
};

/** Said in words, because a colour is not a label. */
const TIER_LABEL: Record<AttentionTier, string> = {
  blocked: "Blocked",
  decision: "Needs a decision",
  ready: "Ready",
  setup: "Setup",
};

function AttentionRow({ item }: { item: AttentionItem }) {
  return (
    <li>
      <Link
        href={item.action.href}
        className={cn(
          "group rounded-inset -mx-2 flex flex-col gap-1 px-2 py-3",
          "transition-interactive hover:bg-surface-hover",
          "focus-visible:ring-2 focus-visible:ring-mint focus-visible:outline-none",
        )}
      >
        <div className="flex items-center gap-2">
          <span
            className={cn("size-1.5 shrink-0 rounded-full", TIER_DOT[item.tier])}
            /* The dot repeats what the row already says in words below; a
               screen reader reading "Blocked" twice is noise, and reading a
               colour is nothing. */
            aria-hidden
          />
          <span className="text-fg-meta text-caption truncate">
            {item.projectName} · {TIER_LABEL[item.tier]}
          </span>
        </div>

        <p className="text-fg text-ui font-semibold text-balance">{item.title}</p>
        <p className="text-fg-muted text-caption leading-relaxed">{item.detail}</p>

        <span className="text-fg-secondary group-hover:text-mint mt-1 inline-flex items-center gap-1.5 text-caption font-medium transition-interactive">
          {item.action.label}
          <ArrowRightIcon
            size={14}
            className="transition-transform duration-200 group-hover:translate-x-0.5"
          />
        </span>
      </Link>
    </li>
  );
}

export function AttentionStack({
  items,
  className,
}: {
  /** Already filtered and ordered by the caller — this renders, it does not rank. */
  items: AttentionItem[];
  className?: string;
}) {
  const shown = items.slice(0, ATTENTION_DISPLAY_LIMIT);
  const hidden = items.length - shown.length;

  return (
    <Surface
      as="section"
      aria-labelledby="attention-heading"
      level="panel"
      padding="md"
      className={cn("flex flex-col gap-3", className)}
    >
      <MonoLabel as="h2" id="attention-heading">
        Also waiting
      </MonoLabel>

      {shown.length === 0 ? (
        /*
          A designed state, not a blank panel. "Nothing else" is a real and
          good answer on this screen, and it is different from "we did not
          look" — which is why it names the hero as the reason there is
          nothing left rather than claiming the account is idle.
        */
        <EmptyState
          title="Nothing else is waiting"
          description="Everything Vibe is tracking is either done or in the card beside this one."
          className="py-4"
        />
      ) : (
        <>
          <ul className="divide-line-1 -my-1 flex flex-col divide-y">
            {shown.map((item) => (
              <AttentionRow key={item.id} item={item} />
            ))}
          </ul>
          {hidden > 0 && (
            /* A count, not a link: every one of these is reachable from the
               grid below, and a second route to the same rows is a second
               place to keep correct. */
            <p className="text-fg-meta text-caption">
              {hidden} more {hidden === 1 ? "item" : "items"} across your products.
            </p>
          )}
        </>
      )}
    </Surface>
  );
}

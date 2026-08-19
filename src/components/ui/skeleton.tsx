import { cn } from "@/lib/utils/cn";

/**
 * Placeholders for content a route is still fetching (UI-4 §1).
 *
 * ## Why these exist
 *
 * Every workspace route resolves its own reads, and until this sprint there
 * was no `loading.tsx` anywhere in the application: a click changed nothing on
 * screen until the destination had finished fetching. The measured render
 * floor is a few milliseconds, so what the user experienced was not a slow
 * framework but an unsignalled wait.
 *
 * ## What a skeleton may and may not claim
 *
 * A skeleton says "something of roughly this shape is coming". It must never
 * imply progress — there is no percentage here and no moving bar, for the same
 * reason the operation stages carry no percentage: nothing knows how far along
 * a database read is, and a number that pretends to would be invented.
 *
 * The pulse is `motion-safe:` only. The global reduced-motion rule already
 * neutralises the animation, and stating it here as well keeps the intent
 * visible at the call site rather than depending on a stylesheet three files
 * away.
 */

/** A single filled block: a card, a chart area, a button-sized control. */
export function SkeletonBlock({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "bg-line-track rounded-panel motion-safe:animate-pulse",
        className,
      )}
    />
  );
}

/**
 * Stacked lines standing in for a paragraph.
 *
 * The last line is short, because a full-width final line reads as a table row
 * rather than as prose.
 */
export function SkeletonText({
  lines = 3,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div aria-hidden className={cn("flex flex-col gap-2", className)}>
      {Array.from({ length: lines }, (_, index) => (
        <div
          key={index}
          className={cn(
            "bg-line-track h-3 rounded-full motion-safe:animate-pulse",
            index === lines - 1 ? "w-1/3" : "w-full",
          )}
        />
      ))}
    </div>
  );
}

/**
 * The body of a workspace section while its route resolves.
 *
 * Deliberately one shape for every section rather than a per-route imitation
 * of the real content. A skeleton that mimics a specific layout has to be
 * maintained in step with that layout, and when it drifts it announces a
 * structure the page then contradicts — which is worse than announcing
 * nothing. This announces only "a panel and some prose are coming".
 */
export function SkeletonSection({ className }: { className?: string }) {
  return (
    <div
      /*
       * Named for assistive technology, which would otherwise meet an
       * unlabelled group of empty boxes. `role="status"` and not `aria-live`:
       * this is a state to be found on arrival, not an update to interrupt
       * with, and the browser suite asserts on literal `aria-live` attributes.
       */
      role="status"
      aria-label="Loading"
      className={cn("flex flex-col gap-4", className)}
    >
      <SkeletonBlock className="h-28 w-full" />
      <SkeletonText lines={3} className="max-w-[62ch]" />
      <SkeletonBlock className="h-40 w-full" />
    </div>
  );
}

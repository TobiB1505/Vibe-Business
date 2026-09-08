"use client";

import { useMotionAllowed } from "./nova-motion";

/**
 * The lines a block writes while it runs, and then forgets.
 *
 * ## What these are, exactly
 *
 * The **stages** of the operation in flight — `OPERATION_STAGE_LABELS[stage]`,
 * the value the executor wrote to the row. The current one is bright; the ones
 * before it fade out behind it and are gone.
 *
 * That they may vanish is not a liberty taken with the record. It is what the
 * record already says: the event log stores that a run started and that it
 * finished, and the stages in between were true for a moment and were never
 * written down. A surface that kept them would be inventing a history the
 * product does not have, and one that shows them going is telling the truth
 * about what they were — snapshots.
 *
 * ## Where the history comes from, since nothing stores it
 *
 * The watcher's own observation. `stage` is a column that is overwritten, so
 * the only way to have seen the previous one is to have been looking — which
 * is what makes this element honest and also what bounds it: it can only ever
 * show what happened while this tab was open. Nothing reconstructs a history
 * on load, because there is none to reconstruct.
 *
 * ## Three rules, and the first is the one that makes it usable
 *
 * - **Nothing carrying a decision or a price is ever in here.** A control that
 *   goes away under a cursor is the worst thing an interface can do, so the
 *   dissolving surface holds no controls at all — not by convention, by
 *   construction: this element renders text.
 * - **A line goes because it stopped being true, never on a timer.** A timer
 *   is a claim about how fast somebody reads. The stage changing is a fact.
 * - **Under `prefers-reduced-motion` the faded lines are not rendered.** They
 *   do not appear and then vanish without animating, which would be a flicker
 *   with no meaning; the current stage stands alone, which is the whole of the
 *   information anyway.
 *
 * ## Both of the last two rules were stated and not implemented
 *
 * **Reduced motion.** The stylesheet's reduced-motion block set
 * `.nova-dissolve` to `opacity: 1` and stopped its animation — which removes
 * the *fading* and leaves the past stages standing there at the inline opacity
 * of the elements themselves. A reader on reduced motion got a static list of
 * stale stages under the current one: the opposite of the rule, and the exact
 * history the paragraph above says the product does not keep. CSS could not
 * fix it, because the rule is about which elements exist rather than how they
 * move — so the preference is read here, through `useMotionAllowed`, whose
 * server snapshot is "no motion". That is also why this left
 * `nova-thread.tsx`: making that whole module a client component to hold one
 * hook would have shipped the render block, the log rows and the header to the
 * browser with it.
 *
 * **The timer.** `.nova-dissolve` animated the *container* from opacity 1 to 0
 * over 420ms with `both`, from mount. So every past stage faded out 420ms
 * after the component rendered, whatever the run was doing, and the emptied
 * box kept its height for the rest of the run — a permanent gap under the
 * current stage where two invisible lines were still laid out. A timer, and
 * the rule says never.
 *
 * What replaced it is the thing that was already true: a line's opacity is its
 * *position*. Current is bright, one back is 0.55, two back is 0.28, three
 * back is not rendered. Nothing moves unless the stage changes, because
 * nothing but the stage changing can move a line to another position — the
 * rule is now the mechanism rather than a caption on one. The transition makes
 * the step readable; it cannot start on its own.
 */
export function NovaDissolving({
  /** Newest first. Only the first is current; the rest are on their way out. */
  stages,
}: {
  stages: readonly string[];
}) {
  const motion = useMotionAllowed();
  const [current, ...fading] = stages;
  if (!current) return null;

  return (
    <div className="flex flex-col gap-1">
      <p className="nova-thinking text-ui font-medium" role="status">
        {current}
      </p>
      {/*
        `aria-hidden`, and not only because they are decorative: a screen
        reader announcing three past stages every time one changes would be
        reading out a history the product deliberately does not keep.
      */}
      {motion && fading.length > 0 && (
        <div aria-hidden className="flex flex-col gap-1">
          {fading.slice(0, 2).map((stage, index) => (
            <p
              key={stage}
              className="text-caption text-fg-meta transition-opacity duration-[420ms] ease-[var(--ease-vibe)]"
              style={{ opacity: index === 0 ? 0.55 : 0.28 }}
            >
              {stage}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

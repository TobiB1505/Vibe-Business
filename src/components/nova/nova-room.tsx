import type { ReactNode } from "react";

/**
 * The room: a status row, the work column, and the conversation.
 *
 * ## Why this is a component and not three copies of a grid
 *
 * Because there were four, and they had already drifted. The opening built
 * its own rail out of a `div`, a padding and a copy of the *Earlier* list;
 * Home's grid was `[300px_1fr]` while onboarding's was
 * `[300px_minmax(0,1fr)]`; and the opening finished inside a bordered panel
 * that the screen replacing it does not have. A founder pressing *Continue*
 * at the end of the choreography watched the room she had just assembled be
 * replaced by a slightly different one.
 *
 * That is the specific failure this exists to make impossible. The opening's
 * whole claim is that Nova assembles the environment the rest of setup happens
 * in — and the claim is only true if the room it builds is, to the pixel, the
 * room that is still there on the next render. One definition, four callers.
 *
 * ## What it deliberately does not decide
 *
 * Anything about state. The header, the rail and the thread all arrive as
 * nodes, so a caller running a choreography can wrap each of them in its own
 * entrance without this component knowing a sequence exists — and a caller
 * that has no sequence passes the same three things plainly.
 *
 * ## The thread's floor
 *
 * A surface with no border, so the conversation column has a ground to sit on
 * without becoming a second bordered container arguing with the rail.
 *
 * It was not there at first, and the room read as one panel, one panel, and
 * then bubbles floating in open space with nothing under them. The reason it
 * had been removed is worth keeping: the opening used to *end* inside a
 * bordered panel that the screen replacing it did not have, so the fix was to
 * take the frame off the opening. Taking it off the thread everywhere was the
 * overcorrection.
 *
 * Fill and no line is the answer to the objection that put it there: a bubble
 * already carries its own edge, and a bordered box around bordered bubbles is
 * a line inside a line. The bubble sits at seven per cent white over the app
 * background and the floor at two — enough separation to read as depth rather
 * than as two competing panels.
 *
 * ## Why the rail is second on a phone
 *
 * A founder who opens this on a phone came for what Nova has to say, and
 * putting the whole plan and the whole log above it means scrolling past
 * everything to reach the one thing that speaks.
 */
/**
 * The thread's ground, written once.
 *
 * Exported because the opening needs the same class on a *different* element:
 * its column arrives on the `panel` beat and the floor has to arrive with it.
 * Applied by this component to a wrapper that is already on screen, the floor
 * would paint an empty surface and sit there for the beat and a half before
 * the first sentence lands — a panel about nothing, which is exactly what the
 * choreography is built to avoid.
 */
export const NOVA_THREAD_SURFACE = "bg-surface-1 rounded-panel p-5 max-sm:p-4";

export function NovaRoom({
  /**
   * The status row. Never wrapped here.
   *
   * `NovaThreadHeader` is `sticky top-0`, and a sticky element can only stick
   * within its own containing block — a wrapper that hugs it is a wrapper with
   * no room to stick in, and the header scrolls away with the thread. A caller
   * that wants an entrance on it owns that wrapper and accepts the trade.
   */
  header,
  /** The work column. `NovaRail`, or a caller's entrance around one. */
  rail,
  /** The conversation. The thread, and nothing beside it. */
  children,
  /**
   * Whether this component paints the thread's floor.
   *
   * False only for the opening, which puts `NOVA_THREAD_SURFACE` on its own
   * animated column instead so the ground rises with the thread rather than
   * appearing under an empty space first.
   */
  surface = true,
}: {
  header: ReactNode;
  rail: ReactNode;
  children: ReactNode;
  surface?: boolean;
}) {
  return (
    <div className="flex flex-col gap-6">
      {header}

      <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)] lg:items-start">
        <div className="max-lg:order-2">{rail}</div>
        {/*
          `min-w-0` and `minmax(0,1fr)` are the same guard twice, and both are
          needed: a grid track's default minimum is its content, so one wide
          render block — a diff, a table, a long unbroken path — pushes the
          column past the viewport and takes the page sideways with it.
        */}
        <div className={`min-w-0 max-lg:order-1 ${surface ? NOVA_THREAD_SURFACE : ""}`}>
          {children}
        </div>
      </div>
    </div>
  );
}

/**
 * The ground the product stands on.
 *
 * ## Why this component exists at all
 *
 * Because the CSS on its own did not. `theme-v2.css` carried a
 * `.vibe-atmosphere` rule for weeks and no component in the repository wore
 * the class, so the palette drew its glass over the same flat field the old
 * one does. That is not a thing a stylesheet can notice, which is why
 * `atmosphere.test.ts` asserts the classes are rendered by a component rather
 * than merely defined.
 *
 * ## What it is doing
 *
 * `backdrop-filter` returns what is behind it, so behind a flat field it
 * returns the same flat field. A pane only reads as a pane where the light
 * under it changes. Everything here exists to give it that.
 *
 * ## The split, and its cost
 *
 * {@link Atmosphere} is the ground everywhere: a luminance ramp and grain,
 * quiet enough to sit behind a diff, a settings table or an agent log.
 * {@link AtmosphereField} is opt-in, for the screen a founder arrives on.
 *
 * The cost is a decision at the call site — a route renders the field or it
 * does not, and glass at the top of a page then refracts more than glass
 * below it. Both were stated when the treatment was chosen rather than
 * discovered afterwards. A route that forgets gets the ramp, which is a
 * quieter screen and never a broken one.
 *
 * ## Inert by construction
 *
 * `aria-hidden`, no pointer events, `z-index: -1`, and no text. All of that
 * lives in the palette; these render nothing but the hooks. In v1 the classes
 * match no rule at all, so this is two empty divs until `data-vibe="v2"` is
 * set — the same way every other `vibe-*` hook waits.
 */
export function Atmosphere() {
  return (
    <>
      {/*
        Two elements rather than one background: the grain has to sit above
        the gradient and below everything else, and a single background cannot
        express that.
      */}
      <div className="vibe-atmosphere" aria-hidden />
      <div className="vibe-grain" aria-hidden />
    </>
  );
}

/**
 * The contained field, for a screen that has earned it.
 *
 * Rendered by the route, not by the shell, because the shell is shared with
 * every screen that should not have it. Fixed rather than anchored to a card:
 * a primary card sits in the upper region on every route that has one, and
 * anchoring would tie the ground to a layout that changes.
 */
export function AtmosphereField() {
  return <div className="vibe-atmosphere-field" aria-hidden />;
}

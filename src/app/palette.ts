/**
 * Which design system this deployment renders.
 *
 * ## Why there is a switch at all
 *
 * Because the second palette is finished and the first one is what customers
 * have. `theme-v2.css` redefines the whole vocabulary under `[data-vibe="v2"]`
 * and, measured, the entire product survives the switch: 8787 unit tests and
 * 587 of 588 browser tests pass with it on, and the one failure is the test
 * asserting it is off. So the remaining question is not whether it works. It
 * is who sees it, and when.
 *
 * ## Why global rather than route by route
 *
 * [ADR 0096](../../docs/decisions/0096-the-second-design-system-arrives-scoped.md)
 * planned for a route to opt in "by carrying the attribute on a layout
 * wrapper". That does not survive contact with the ground: `.vibe-atmosphere`
 * is `position: fixed`, so it is one luminance ramp behind the whole app. Half
 * the routes on v2 means the *background* changes as a founder navigates —
 * the light comes on and goes off between screens, and the corners jump. That
 * reads worse than either end state, and it is not a thing the user would ever
 * have chosen if the plan had said it out loud.
 *
 * Making it scopeable is real work — the ground would stop being a ground and
 * become a container — and it buys a gradual rollout nobody wants once the
 * flicker is named. See [ADR 0098](../../docs/decisions/0098-the-palette-ships-behind-one-switch.md).
 *
 * ## Why an environment variable, given rule 78
 *
 * CLAUDE.md rule 78 says never to gate a customer capability on an environment
 * variable nothing documents. Both halves matter here. This gates no
 * capability — every operation, price and control is identical in both
 * palettes; only the paint differs. And it is documented, in
 * [docs/deployment/environment.md](../../docs/deployment/environment.md),
 * which rule 83 makes a current-state document that has to stay true.
 *
 * Server-only rather than `NEXT_PUBLIC_`, matching the repository's other
 * `VIBE_*` configuration: the root layout is a server component and nothing on
 * the client needs to know.
 *
 * ## Why an unknown value is not an error
 *
 * A typo in a cosmetic flag should not fail a deployment. But falling back
 * silently is how "why is it still the old design" becomes an afternoon, so
 * the resolved palette is always written to the DOM — `data-vibe="v1"` styles
 * nothing and answers the question by being there.
 */

import { getAppEnvironment } from "@/lib/env/app-url";

export type Palette = "v1" | "v2";

/** The variable, named once so a test and a doc can both point at it. */
export const PALETTE_ENV = "VIBE_PALETTE";

/**
 * Where a local override lives, named once for the same reason.
 *
 * The environment variable answers "what does this deployment show". This
 * answers "what am I looking at", per browser, and only outside production —
 * see `palette-switch.tsx`. The blocking script in `layout.tsx` reads this key
 * before first paint, so it appears in three places and must be one string.
 */
export const PALETTE_STORAGE_KEY = "vibe-palette";

/**
 * The script that applies a stored override before the first paint.
 *
 * Inlined into `<head>` and deliberately blocking. Without it the document
 * paints the deployment's palette and swaps a frame later, which on a switch
 * that changes the ground, the corners and the type is the whole product
 * flashing on every navigation.
 *
 * Written as a string because it has to run before React does, and kept to one
 * expression with its own try/catch: a private window throws on
 * `localStorage`, and an exception in a blocking head script stops the parse.
 */
export const PALETTE_BOOT_SCRIPT =
  `try{var p=localStorage.getItem(${JSON.stringify(PALETTE_STORAGE_KEY)});` +
  `if(p==="v1"||p==="v2")document.documentElement.dataset.vibe=p}catch(e){}`;

/**
 * The palette this deployment renders, from configuration.
 *
 * `v1` unless the variable says exactly `v2`. Anything else — unset, a typo,
 * an empty string — is the palette customers have today.
 */
export function activePalette(source: Record<string, string | undefined> = process.env): Palette {
  return source[PALETTE_ENV]?.trim() === "v2" ? "v2" : "v1";
}

/**
 * Whether this deployment offers the local switch.
 *
 * Everywhere but production. It is a tool for the person doing the redesign,
 * not a preference — a customer offered a choice between a finished design and
 * an unfinished one has been handed a decision that is not theirs.
 *
 * `getAppEnvironment()` already answers "which tier is this", primarily from
 * Vercel's own `VERCEL_ENV`, so this gate costs no new configuration. It, the
 * switch and the boot script all disappear together when v2 is simply what
 * everybody has.
 */
export function paletteSwitchable(
  source: Record<string, string | undefined> = process.env,
): boolean {
  return getAppEnvironment(source as Parameters<typeof getAppEnvironment>[0]) !== "production";
}

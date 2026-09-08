import localFont from "next/font/local";

/**
 * The three study typefaces, self-hosted from bytes committed to this repo.
 *
 * ## Why local files, in a lab
 *
 * The same reason `src/app/fonts.ts` gives for the product: `next/font/google`
 * fetches from `fonts.gstatic.com` *during* `next build`, and a CI run in this
 * repository has already failed that way. A study that only renders when a
 * third party is up is not a study anybody can review twice.
 *
 * ## Why latin only, here
 *
 * These faces exist to be looked at, on English fixture copy, at two
 * viewports. Shipping one would mean reproducing what JetBrains Mono already
 * does — one `localFont` call per writing system, with `unicode-range` split
 * the way the foundry ships it — because collapsing to latin silently drops
 * Polish, Czech, Turkish, Greek, Cyrillic and Vietnamese onto a system font.
 * That work belongs to S1, for the one face that wins, and doing it three
 * times for two faces that will be deleted is the wrong order.
 *
 * ## Licences
 *
 * Geist and Instrument Sans / Serif are SIL OFL 1.1. Switzer is under the ITF
 * Free Font License, which permits self-hosting but is not OFL — worth
 * confirming against the licence text before Switzer ships in a product build,
 * rather than at the point where it is already in `main`.
 */

/** Study A. Variable weight axis, so the whole ramp is one file. */
export const studyGeist = localFont({
  src: "../../fonts/geist-latin.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  variable: "--font-study-geist",
  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],
});

/** Study B. */
export const studySwitzer = localFont({
  src: "../../fonts/switzer-latin.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  variable: "--font-study-switzer",
  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],
});

/** Study C, text face. */
export const studyInstrumentSans = localFont({
  src: "../../fonts/instrument-sans-latin.woff2",
  weight: "400 700",
  style: "normal",
  display: "swap",
  variable: "--font-study-instrument-sans",
  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],
});

/** Study C, display face. The reason study C exists. */
export const studyInstrumentSerif = localFont({
  src: "../../fonts/instrument-serif-latin.woff2",
  weight: "400",
  style: "normal",
  display: "swap",
  variable: "--font-study-instrument-serif",
  fallback: ["ui-serif", "Georgia", "serif"],
});

/**
 * Every study face is declared on the shell, not just the active one.
 *
 * The alternative — one variable class per study — means a font that is
 * missing in exactly the study being screenshotted, discovered after the
 * screenshot. Four latin subsets is 124 kB in a fixture route that production
 * cannot serve.
 */
export const STUDY_FONT_CLASSES = [
  studyGeist.variable,
  studySwitzer.variable,
  studyInstrumentSans.variable,
  studyInstrumentSerif.variable,
].join(" ");

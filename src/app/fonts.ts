import localFont from "next/font/local";

/**
 * The technical product typeface, self-hosted from files committed to this
 * repository. The interface face itself is the platform-native stack declared
 * in `globals.css`.
 *
 * ## Why local files rather than `next/font/google`
 *
 * `next/font/google` downloads the fonts from `fonts.gstatic.com` *during
 * `next build`*, which makes every build depend on a third party being
 * reachable at that moment. That is not hypothetical: a CI run failed with
 * `Failed to fetch JetBrains Mono from Google Fonts` while the same commit
 * built fine on a parallel runner seconds later. A build that fails for
 * reasons unrelated to the code is a build people stop trusting.
 *
 * ## These are the bytes that were already shipping
 *
 * Every JetBrains Mono file was taken verbatim from the `next/font/google`
 * output of the commit this change is based on — same typeface, same
 * variable-axis instancing, same subsetting. See `fonts/README.md`.
 *
 * ## Why one call per writing system
 *
 * Google ships these fonts split by script, and a browser fetches only the
 * parts a page actually needs. `next/font/local` cannot express several
 * `unicode-range` blocks in one call, so reproducing that behaviour means one
 * call per part. Collapsing to latin-only would have been a third of the code
 * and would have silently dropped Polish, Czech, Turkish, Greek, Cyrillic and
 * Vietnamese text to a system font.
 *
 * Each call therefore produces its own font family, and `globals.css` lists
 * all of a typeface's families in one stack. Sharing a single family name
 * across the calls via a `font-family` declaration was tried and reverted: it
 * is honoured by the webpack loader but not by Turbopack, which left the CSS
 * variable pointing at a family no `@font-face` declared — the webfont then
 * silently stopped loading and every weight collapsed onto a system fallback.
 *
 * Only the latin parts are preloaded and only they carry a metric-adjusted
 * fallback; the others never lead the stack. That is what `subsets:
 * ["latin"]` did before.
 *
 * The constants are named after the typeface rather than its role, because
 * `next/font` derives the CSS family name from the identifier and that name
 * is what a browser's dev tools show. `jetBrainsMonoLatin` is legible there;
 * `monoLatin` is not.
 *
 * `weight: "400 700"` is written out in every call because `next/font` is a
 * compile-time transform that rejects anything which is not an explicit
 * literal. These are variable fonts, so that span is interpolated and there
 * is no file per weight.
 */

/* JetBrains Mono ---------------------------------------------------- */
const jetBrainsMonoLatin = localFont({
  src: "./fonts/jetbrains-mono-latin.woff2",
  weight: "400 700",
  style: "normal",
  display: "swap",
  variable: "--font-jetbrains-mono",
  preload: true,
  // Metrics are read from the file itself, so text shown before the
  // webfont arrives occupies the same space and nothing jumps.
  adjustFontFallback: "Arial",
  declarations: [{ prop: "unicode-range", value: "U+0000-00FF,U+131,U+152-153,U+2BB-2BC,U+2C6,U+2DA,U+2DC,U+304,U+308,U+329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD" }],
});
const jetBrainsMonoLatinExt = localFont({
  src: "./fonts/jetbrains-mono-latin-ext.woff2",
  weight: "400 700",
  style: "normal",
  display: "swap",
  variable: "--font-jetbrains-mono-latin-ext",
  preload: false,
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+100-2BA,U+2BD-2C5,U+2C7-2CC,U+2CE-2D7,U+2DD-2FF,U+304,U+308,U+329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF" }],
});
const jetBrainsMonoCyrillic = localFont({
  src: "./fonts/jetbrains-mono-cyrillic.woff2",
  weight: "400 700",
  style: "normal",
  display: "swap",
  variable: "--font-jetbrains-mono-cyrillic",
  preload: false,
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+301,U+400-45F,U+490-491,U+4B0-4B1,U+2116" }],
});
const jetBrainsMonoCyrillicExt = localFont({
  src: "./fonts/jetbrains-mono-cyrillic-ext.woff2",
  weight: "400 700",
  style: "normal",
  display: "swap",
  variable: "--font-jetbrains-mono-cyrillic-ext",
  preload: false,
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+460-52F,U+1C80-1C8A,U+20B4,U+2DE0-2DFF,U+A640-A69F,U+FE2E-FE2F" }],
});
const jetBrainsMonoGreek = localFont({
  src: "./fonts/jetbrains-mono-greek.woff2",
  weight: "400 700",
  style: "normal",
  display: "swap",
  variable: "--font-jetbrains-mono-greek",
  preload: false,
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+370-377,U+37A-37F,U+384-38A,U+38C,U+38E-3A1,U+3A3-3FF" }],
});
const jetBrainsMonoVietnamese = localFont({
  src: "./fonts/jetbrains-mono-vietnamese.woff2",
  weight: "400 700",
  style: "normal",
  display: "swap",
  variable: "--font-jetbrains-mono-vietnamese",
  preload: false,
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+102-103,U+110-111,U+128-129,U+168-169,U+1A0-1A1,U+1AF-1B0,U+300-301,U+303-304,U+308-309,U+323,U+329,U+1EA0-1EF9,U+20AB" }],
});

/**
 * Every face's class, for `<html>`.
 *
 * All of them belong here: each class both emits its `@font-face` and defines
 * the variable `globals.css` names. A character outside every declared
 * `unicode-range` falls through to the system stack.
 */
export const fontVariables = [
  jetBrainsMonoLatin.variable,
  jetBrainsMonoLatinExt.variable,
  jetBrainsMonoCyrillic.variable,
  jetBrainsMonoCyrillicExt.variable,
  jetBrainsMonoGreek.variable,
  jetBrainsMonoVietnamese.variable,
].join(" ");

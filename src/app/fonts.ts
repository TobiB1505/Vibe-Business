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
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF,U+131,U+152-153,U+2BB-2BC,U+2C6,U+2DA,U+2DC,U+304,U+308,U+329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD",
    },
  ],
});
const jetBrainsMonoLatinExt = localFont({
  src: "./fonts/jetbrains-mono-latin-ext.woff2",
  weight: "400 700",
  style: "normal",
  display: "swap",
  variable: "--font-jetbrains-mono-latin-ext",
  preload: false,
  adjustFontFallback: false,
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+100-2BA,U+2BD-2C5,U+2C7-2CC,U+2CE-2D7,U+2DD-2FF,U+304,U+308,U+329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF",
    },
  ],
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
  declarations: [
    {
      prop: "unicode-range",
      value: "U+460-52F,U+1C80-1C8A,U+20B4,U+2DE0-2DFF,U+A640-A69F,U+FE2E-FE2F",
    },
  ],
});
const jetBrainsMonoGreek = localFont({
  src: "./fonts/jetbrains-mono-greek.woff2",
  weight: "400 700",
  style: "normal",
  display: "swap",
  variable: "--font-jetbrains-mono-greek",
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: "unicode-range", value: "U+370-377,U+37A-37F,U+384-38A,U+38C,U+38E-3A1,U+3A3-3FF" },
  ],
});
const jetBrainsMonoVietnamese = localFont({
  src: "./fonts/jetbrains-mono-vietnamese.woff2",
  weight: "400 700",
  style: "normal",
  display: "swap",
  variable: "--font-jetbrains-mono-vietnamese",
  preload: false,
  adjustFontFallback: false,
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+102-103,U+110-111,U+128-129,U+168-169,U+1A0-1A1,U+1AF-1B0,U+300-301,U+303-304,U+308-309,U+323,U+329,U+1EA0-1EF9,U+20AB",
    },
  ],
});

/* Geist ------------------------------------------------------------- */
/**
 * The v2 interface face (S1, ADR 0096).
 *
 * Split by writing system for the reason the mono above is split: the foundry
 * ships it that way and a browser then fetches only the parts a page needs.
 * Collapsing to latin would silently drop Polish, Czech, Turkish, Russian and
 * Vietnamese text onto a system font.
 *
 * **Geist ships no Greek.** JetBrains Mono does, and the platform-native stack
 * v1 uses covers it too, so this is the one script the interface face gives up
 * by moving off the system stack. Greek falls through to `ui-sans-serif` and
 * renders correctly in the system face — a graceful fallback, not broken text,
 * but a real difference and not one to discover later.
 *
 * `weight: "100 900"` is the variable axis Geist actually publishes, written
 * as a literal because `next/font` is a compile-time transform.
 */
const geistLatin = localFont({
  src: "./fonts/geist-latin.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  variable: "--font-geist",
  preload: true,
  adjustFontFallback: "Arial",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD",
    },
  ],
});
const geistLatinExt = localFont({
  src: "./fonts/geist-latin-ext.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  variable: "--font-geist-latin-ext",
  preload: false,
  adjustFontFallback: false,
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF",
    },
  ],
});
const geistCyrillic = localFont({
  src: "./fonts/geist-cyrillic.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  variable: "--font-geist-cyrillic",
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: "unicode-range", value: "U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116" },
  ],
});
const geistCyrillicExt = localFont({
  src: "./fonts/geist-cyrillic-ext.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  variable: "--font-geist-cyrillic-ext",
  preload: false,
  adjustFontFallback: false,
  declarations: [
    {
      prop: "unicode-range",
      value: "U+0460-052F,U+1C80-1C8A,U+20B4,U+2DE0-2DFF,U+A640-A69F,U+FE2E-FE2F",
    },
  ],
});
const geistVietnamese = localFont({
  src: "./fonts/geist-vietnamese.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  variable: "--font-geist-vietnamese",
  preload: false,
  adjustFontFallback: false,
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+0300-0301,U+0303-0304,U+0308-0309,U+0323,U+0329,U+1EA0-1EF9,U+20AB",
    },
  ],
});

/* DM Mono ----------------------------------------------------------- */
/**
 * The v2 identifier face (S1 follow-up, ADR 0096).
 *
 * Chosen at review from four candidates on the strings mono is actually kept
 * for — repository names, branches and SHAs — rather than on a pangram, which
 * flatters every monospace equally.
 *
 * ## Two static weights rather than a variable axis
 *
 * DM Mono ships 300/400/500 as separate files and no variable axis. 400 and
 * 500 are enough: three places in the product set mono at `font-semibold`, and
 * CSS font matching resolves a requested 600 to the nearest available face
 * above-then-below — 500 — rather than synthesising a faux bold, which is what
 * shipping 400 alone would have produced.
 *
 * ## Why JetBrains Mono stays in the stack behind it
 *
 * DM Mono ships **latin and latin-ext only**. JetBrains Mono covers six
 * writing systems including Greek, Cyrillic and Vietnamese, and Geist — the v2
 * interface face — has no Greek either. Dropping JetBrains Mono outright would
 * have left v2 with no Greek coverage in *either* family, so every Greek
 * character in the product fell to a system font.
 *
 * Instead `--font-mono` in `theme-v2.css` lists DM Mono first and the
 * JetBrains subsets behind it. Each face declares its own `unicode-range`, so
 * a browser takes DM Mono for every identifier that is Latin — which is
 * effectively all of them — and falls through per character for the scripts DM
 * Mono does not ship. The bytes are already in the repository.
 */
const dmMonoLatin = localFont({
  src: [
    { path: "./fonts/dm-mono-latin-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/dm-mono-latin-500.woff2", weight: "500", style: "normal" },
  ],
  display: "swap",
  variable: "--font-dm-mono",
  preload: true,
  adjustFontFallback: "Arial",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD",
    },
  ],
});
const dmMonoLatinExt = localFont({
  src: [
    { path: "./fonts/dm-mono-latin-ext-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/dm-mono-latin-ext-500.woff2", weight: "500", style: "normal" },
  ],
  display: "swap",
  variable: "--font-dm-mono-latin-ext",
  preload: false,
  adjustFontFallback: false,
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF",
    },
  ],
});

/**
 * Every face's class, for `<html>`.
 *
 * All of them belong here: each class both emits its `@font-face` and defines
 * the variable `globals.css` names. A character outside every declared
 * `unicode-range` falls through to the system stack.
 */
export const fontVariables = [
  dmMonoLatin.variable,
  dmMonoLatinExt.variable,
  geistLatin.variable,
  geistLatinExt.variable,
  geistCyrillic.variable,
  geistCyrillicExt.variable,
  geistVietnamese.variable,
  jetBrainsMonoLatin.variable,
  jetBrainsMonoLatinExt.variable,
  jetBrainsMonoCyrillic.variable,
  jetBrainsMonoCyrillicExt.variable,
  jetBrainsMonoGreek.variable,
  jetBrainsMonoVietnamese.variable,
].join(" ");

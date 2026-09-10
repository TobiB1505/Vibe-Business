import type { SourceCoverage } from "@/modules/provenance/source-coverage";

/**
 * The four sources a landing page shows, as the product's own type (UI-34).
 *
 * ## Why they live here rather than in a block
 *
 * Three blocks read them when this file was made — the Scan block, the trust
 * bento, and the flow section — and they were exported from whichever block
 * happened to define them first, so the trust page imported its evidence from
 * `landing-flow`. Both of those blocks have since been deleted (UI-34), which
 * is the point: had the constant still lived in one of them, the deletion
 * would have taken the Scan block's evidence with it. One reader today, and
 * the file stays here.
 *
 * ## What makes them safe to show
 *
 * They are typed as `SourceCoverage`, which is the shape the product renders
 * from a real scan. So a state, a reason or a remedy that the product cannot
 * produce is a type error here, and the marketing page cannot show a coverage
 * story the application has no way of reaching.
 *
 * Three of the four are deliberately not `ready`. A page that showed four
 * greens would be promising a first scan that does not happen.
 *
 * ## Why every remedy is null
 *
 * In the product a partial source carries its own way out — *Scan again*, *Deep
 * Scan*, and the price beside it. On a landing page those render as buttons a
 * visitor can press, and pressing them does nothing they mean: there is no
 * project to rescan and nothing to charge. A control that cannot do what it
 * says is worse than no control, so the remedies come off and the block's own
 * prose says what the states mean instead.
 */
export const EXAMPLE_SOURCES: SourceCoverage[] = [
  {
    source: "repository",
    label: "Your code",
    state: "ready",
    detail: "Vibe has read what your repository builds.",
    reasons: [],
    measured: { files: 128 },
    at: "2026-08-14T08:22:59.917Z",
    remedy: null,
  },
  {
    source: "live",
    label: "Your public product",
    state: "partial",
    detail: "Vibe visited your product, but couldn't read all of it.",
    reasons: [
      "Two pages on your site build themselves in your visitor's browser, so Vibe saw an empty shell for those.",
    ],
    measured: { pages: 6 },
    at: "2026-08-14T08:24:11.000Z",
    remedy: null,
  },
  {
    source: "deep_scan",
    label: "Your signed-in product",
    state: "none",
    detail: "Vibe hasn't seen past your sign-in yet.",
    reasons: [],
    measured: {},
    at: null,
    remedy: null,
  },
  {
    source: "founder",
    label: "What you told Vibe",
    state: "ready",
    detail: "Your own words about the business, which outrank anything derived.",
    reasons: [],
    measured: {},
    at: null,
    remedy: null,
  },
];

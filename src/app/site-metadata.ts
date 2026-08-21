/**
 * The product's own name and one-line description.
 *
 * The single source both `RootLayout`'s `<head>` metadata and the landing
 * page's structured data (`product-jsonld.ts`) read from, so a search engine
 * is told the same thing in both places by construction — never a second,
 * independently-typed literal that could drift from the first.
 */
export const SITE_NAME = "Vibe Business";
export const SITE_DESCRIPTION = "The business layer for AI-built products.";

import { getAppUrl } from "@/lib/env/app-url";
import { SITE_DESCRIPTION, SITE_NAME } from "./site-metadata";

/**
 * Structured data (schema.org `WebApplication`) for the public landing page
 * (`/`).
 *
 * Search engines read this to describe the product in results, instead of
 * whatever text happens to be scraped from the rendered page. Every value
 * comes from metadata the application already holds — `SITE_NAME` /
 * `SITE_DESCRIPTION` (the same constants `RootLayout` gives the `<head>`
 * `<title>` and `<meta name="description">`) and `getAppUrl()` (Production
 * Domain & Environment Migration v1, the same origin `sitemap.ts` and
 * `robots.ts` already resolve their URLs from) — rather than a second,
 * independently-typed literal that could quietly drift from the first.
 *
 * Prepared by Vibe Business. Review before merging.
 */
export interface ProductJsonLd {
  "@context": "https://schema.org";
  "@type": "WebApplication";
  name: string;
  description: string;
  url: string;
}

export default function productJsonLd(): ProductJsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: SITE_NAME,
    description: SITE_DESCRIPTION,
    url: getAppUrl(),
  };
}

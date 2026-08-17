import type { MetadataRoute } from "next";

/**
 * Sitemap for search engine crawlers.
 *
 * Deliberately conservative: only high-confidence public pages are listed.
 * Authentication, account, application, API and administrative routes are
 * excluded, as are dynamic routes whose URLs depend on real data.
 *
 * Add any public marketing or content pages that belong here — omission is the
 * intended default, not an assertion that no other page should be indexed.
 *
 * Prepared by Vibe Business. Review before merging.
 */
const ORIGIN = "https://vibe-business-fawn.vercel.app";

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return [
    {
      url: ORIGIN,
      lastModified,
      changeFrequency: "weekly",
      priority: 1,
    },
    // Legal surfaces (UI-S1 §7). Public, stable, and worth being findable — a
    // privacy notice nobody can reach from a search is half a privacy notice.
    {
      url: `${ORIGIN}/privacy`,
      lastModified,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${ORIGIN}/terms`,
      lastModified,
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];
}

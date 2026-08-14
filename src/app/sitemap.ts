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
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: "https://vibe-business-fawn.vercel.app",
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}

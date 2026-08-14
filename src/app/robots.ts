import type { MetadataRoute } from "next";

/**
 * robots.txt for search engine crawlers.
 *
 * Prepared by Vibe Business. Review before merging.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
      "/app/",
      "/api/",
      ],
    },
    sitemap: "https://vibe-business-fawn.vercel.app/sitemap.xml",
  };
}

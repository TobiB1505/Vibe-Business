import type { MetadataRoute } from "next";
import { getAppUrl } from "@/lib/env/app-url";

/**
 * robots.txt for search engine crawlers.
 *
 * Prepared by Vibe Business. Review before merging.
 *
 * The sitemap URL is this deployment's own resolved origin (Production
 * Domain & Environment Migration v1), not a fixed value — see `sitemap.ts`.
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
    sitemap: `${getAppUrl()}/sitemap.xml`,
  };
}

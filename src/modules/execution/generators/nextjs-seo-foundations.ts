import { createHash } from "node:crypto";
import { NEXTJS_SEO_FOUNDATIONS_VERSION, type PreparedFile } from "../schema";

/**
 * The deterministic SEO-foundations generator (Sprint 9 §10, §11).
 *
 * **No model is called here.** That is the point of the sprint: it proves the
 * path from opportunity → preflight → GitHub write → review, without also
 * proving that an AI can write code. Those are two different risks and mixing
 * them would make a failure impossible to attribute.
 *
 * The output is a pure function of `(origin, appRoot)`. Same inputs, same
 * bytes, same hashes — which is what makes post-write verification meaningful
 * (§25) and re-running safe (§20).
 *
 * The emitted code follows the Next.js App Router metadata-route conventions
 * as documented for 16.3.0 (`MetadataRoute.Robots`, `MetadataRoute.Sitemap`).
 * Checked against the current documentation at implementation time rather than
 * recalled.
 */

/** Paths under the app root that must never be advertised to crawlers. */
const PRIVATE_PATH_PREFIXES = ["/app/", "/api/"] as const;

export type SeoFoundationsInput = {
  /** Verified production origin, no trailing slash. Never model-supplied (§12). */
  origin: string;
  /** Resolved app root with trailing slash, e.g. `src/app/`. Never model-supplied. */
  appRoot: string;
};

function robotsSource(origin: string): string {
  // Disallow rules are deliberately conservative and derived from the two
  // prefixes above, not from anything the model said about the product.
  const disallow = PRIVATE_PATH_PREFIXES.map((prefix) => `      '${prefix}',`).join("\n");

  return `import type { MetadataRoute } from "next";

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
${disallow.replace(/'/g, '"')}
      ],
    },
    sitemap: "${origin}/sitemap.xml",
  };
}
`;
}

function sitemapSource(origin: string): string {
  // Only the marketing surfaces a signed-out visitor can reach. Nothing behind
  // authentication, nothing internal — a sitemap is a public invitation, and
  // listing a protected route is both useless and a disclosure (§11).
  return `import type { MetadataRoute } from "next";

/**
 * Sitemap for search engine crawlers.
 *
 * Deliberately limited to publicly reachable pages. Authenticated and internal
 * routes are excluded.
 *
 * Prepared by Vibe Business. Review before merging.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: "${origin}",
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: "${origin}/login",
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: "${origin}/signup",
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.8,
    },
  ];
}
`;
}

export function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export type GeneratedFile = PreparedFile & { content: string };

/**
 * Produces the files this capability writes.
 *
 * Paths are composed here from the resolved app root and fixed basenames. No
 * caller can influence them, which is what makes the path allowlist in
 * `paths.ts` enforceable rather than aspirational (§13, §32).
 */
export function generateSeoFoundations(input: SeoFoundationsInput): GeneratedFile[] {
  const origin = input.origin.replace(/\/+$/, "");
  const appRoot = input.appRoot.endsWith("/") ? input.appRoot : `${input.appRoot}/`;

  return [
    { path: `${appRoot}robots.ts`, content: robotsSource(origin) },
    { path: `${appRoot}sitemap.ts`, content: sitemapSource(origin) },
  ].map((file) => ({
    path: file.path,
    content: file.content,
    contentHash: sha256(file.content),
    bytes: Buffer.byteLength(file.content, "utf8"),
  }));
}

export const SEO_FOUNDATIONS_VERSION = NEXTJS_SEO_FOUNDATIONS_VERSION;

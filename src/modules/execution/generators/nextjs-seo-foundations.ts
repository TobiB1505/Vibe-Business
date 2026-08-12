import { createHash } from "node:crypto";
import type { RouteSummary } from "@/modules/repository-intelligence/schema";
import { NEXTJS_SEO_FOUNDATIONS_V2_VERSION, type PreparedFile } from "../schema";
import { selectSitemapRoutes } from "./route-classification";

/**
 * The deterministic SEO-foundations generator (Sprint 9 §10, §11).
 *
 * **No model is called here.** That is the point of the sprint: it proves the
 * path from opportunity → preflight → GitHub write → review, without also
 * proving that an AI can write code. Those are two different risks and mixing
 * them would make a failure impossible to attribute.
 *
 * The output is a pure function of `(origin, appRoot, routes)`. Same inputs,
 * same bytes, same hashes — which is what makes post-write verification
 * meaningful (§25) and re-running safe (§20).
 *
 * The emitted code follows the Next.js App Router metadata-route conventions
 * as documented for 16.3.0 (`MetadataRoute.Robots`, `MetadataRoute.Sitemap`).
 * Checked against the current documentation at implementation time rather than
 * recalled.
 *
 * ## v2 — sitemap selection
 *
 * v1 emitted a fixed route list and put `/login` and `/signup` in the sitemap
 * of the first real execution. v2 derives the list from structured route
 * intelligence and omits every known authentication, account, application, API
 * and administrative surface — see `route-classification.ts`.
 *
 * The capability identifier and version were bumped rather than edited in
 * place. `nextjs_seo_foundations_v1` still describes exactly what the first
 * dogfood commit contains, and rewriting that meaning retroactively would make
 * the stored `PreparedChange` rows lie about their own output.
 */

/**
 * Paths robots.txt discourages crawling, independent of sitemap selection.
 *
 * Kept deliberately narrow. Omitting a route from the sitemap says "we are not
 * asking you to index this"; a robots `disallow` says "do not fetch this at
 * all". Those are different claims and conflating them causes real damage —
 * blanket-disallowing `/login` can suppress legitimate pages behind shared
 * prefixes and, on some sites, break link previews and verification flows.
 *
 * So only surfaces that are useless to a crawler under *any* SEO strategy
 * appear here: the signed-in application and the API. Authentication routes are
 * excluded from the sitemap but intentionally left crawlable (§10).
 */
const PRIVATE_PATH_PREFIXES = ["/app/", "/api/"] as const;

export type SeoFoundationsInput = {
  /** Verified production origin, no trailing slash. Never model-supplied (§12). */
  origin: string;
  /** Resolved app root with trailing slash, e.g. `src/app/`. Never model-supplied. */
  appRoot: string;
  /**
   * Structured route intelligence for the analyzed commit.
   *
   * Derived from repository paths by the Sprint 2 detector — never from file
   * contents and never from model output. An empty list is valid and means the
   * sitemap contains only the site root, which is the conservative outcome
   * rather than an error (§4).
   */
  routes: readonly RouteSummary[];
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

/**
 * One sitemap entry.
 *
 * `changeFrequency` and `priority` are fixed by position — root, then
 * everything else — rather than reasoned about. Vibe has no basis for an
 * opinion on how often a customer's pricing page changes, and inventing one
 * would be strategy dressed up as determinism.
 */
function sitemapEntry(url: string, root: boolean): string {
  return `    {
      url: "${url}",
      lastModified: new Date(),
      changeFrequency: "${root ? "weekly" : "monthly"}",
      priority: ${root ? "1" : "0.7"},
    },`;
}

function sitemapSource(origin: string, routes: readonly RouteSummary[]): string {
  // The site root is the verified production origin itself, so it is listed
  // whether or not route detection found anything. Every other entry must earn
  // its place through classification (§3, §4).
  const entries = [
    sitemapEntry(origin, true),
    ...selectSitemapRoutes(routes).map((path) => sitemapEntry(`${origin}${path}`, false)),
  ].join("\n");

  return `import type { MetadataRoute } from "next";

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
${entries}
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
    { path: `${appRoot}sitemap.ts`, content: sitemapSource(origin, input.routes) },
  ].map((file) => ({
    path: file.path,
    content: file.content,
    contentHash: sha256(file.content),
    bytes: Buffer.byteLength(file.content, "utf8"),
  }));
}

export const SEO_FOUNDATIONS_VERSION = NEXTJS_SEO_FOUNDATIONS_V2_VERSION;

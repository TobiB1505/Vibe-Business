/**
 * Sitemap parsing (Sprint 3 §11).
 *
 * Sitemap URLs are treated purely as *discovery hints*. They still pass
 * through the same URL resolution, same-origin filter, robots policy and
 * crawl budgets as any link found in a page — a sitemap cannot widen the
 * crawl, only suggest where to point it.
 *
 * Sitemap *indexes* are read one level deep at most. Following them
 * recursively is how a crawler ends up consuming a giant sitemap network,
 * which this sprint explicitly refuses to do.
 */

export type SitemapDocument = {
  kind: "urlset" | "sitemapindex" | "unknown";
  /** Page URLs (`urlset`) or child sitemap URLs (`sitemapindex`). */
  urls: string[];
  truncated: boolean;
};

/**
 * Extracts `<loc>` values with a bounded scanner rather than an XML
 * parser: no external entities, no DTDs, no XXE surface — a sitemap is
 * untrusted input like any other fetched document.
 */
export function parseSitemap(xml: string, maxUrls: number): SitemapDocument {
  const kind: SitemapDocument["kind"] = /<sitemapindex\b/i.test(xml)
    ? "sitemapindex"
    : /<urlset\b/i.test(xml)
      ? "urlset"
      : "unknown";

  const urls: string[] = [];
  let truncated = false;

  const pattern = /<loc\b[^>]{0,200}>([\s\S]{0,2000}?)<\/loc>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml)) !== null) {
    if (urls.length >= maxUrls) {
      truncated = true;
      break;
    }
    const value = match[1].trim().replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "").trim();
    if (value !== "") urls.push(value);
  }

  return { kind, urls, truncated };
}

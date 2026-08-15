import type { FetchedPage } from "./crawler";
import type { ParsedHtml } from "./html";
import type {
  Confidence,
  LiveBrandAsset,
  LiveBrandColor,
  LiveBrandSignals,
  LiveEvidence,
} from "./schema";

/**
 * Brand signals from a served page (CORE-1 §11–§13).
 *
 * The live counterpart to the repository brand detector, and it answers a
 * different question. The repository knows what a design system *declares*;
 * this knows what a visitor is actually *served*. A logo sitting unreferenced
 * in `/public` and a logo the homepage renders in its header are not the same
 * claim, and only the second one is what a customer sees.
 *
 * Two constraints shape everything here:
 *
 *  - **Nothing is downloaded.** No icon, image, or stylesheet is fetched.
 *    Every asset below is a URL the page published, recorded as a reference.
 *    Whether it resolves is not a question static HTML inspection can answer,
 *    so nothing here claims it does.
 *  - **Nothing raw is kept.** Paths lose their query strings (Sprint 3 §22),
 *    alt text is a short label, and colour is a value plus the property it
 *    was declared under. No HTML, no CSS text, no body copy.
 *
 * All of it is UNTRUSTED third-party data (CLAUDE.md rule 36).
 */

const MAX_ASSETS = 10;
const MAX_COLORS = 8;
const MAX_TYPEFACES = 4;

/**
 * Reduces a published URL to a stored reference.
 *
 * Same-origin URLs become origin-relative paths; off-origin ones keep their
 * origin, because "the logo is served from a CDN" is a real fact about the
 * product. The query string is dropped either way — a signed asset URL is
 * exactly the kind of thing that carries a token.
 */
export function toAssetPath(href: string, effectiveOrigin: string): string | null {
  const value = href.trim();
  if (value === "") return null;
  if (/^(javascript|data|mailto|tel|blob):/i.test(value)) return null;

  try {
    const resolved = new URL(value, effectiveOrigin);
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") return null;
    const origin = new URL(effectiveOrigin).origin;
    const path = resolved.pathname.slice(0, 300);
    return resolved.origin === origin ? path : `${resolved.origin}${path}`;
  } catch {
    return null;
  }
}

const HEX_COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Normalizes a hex colour, or refuses. Functional colour syntaxes are left alone. */
export function normalizeLiveColor(value: string): string | null {
  const trimmed = value.trim();
  if (!HEX_COLOR.test(trimmed)) return null;
  const hex = trimmed.slice(1).toLowerCase();
  const expanded =
    hex.length === 3
      ? hex
          .split("")
          .map((character) => character + character)
          .join("")
      : hex;
  return `#${expanded}`;
}

/**
 * Token names that mean "the brand", as opposed to the several hundred other
 * custom properties a framework inlines. Conservative on purpose: a page's
 * critical CSS is mostly layout, and reporting all of it as brand colour would
 * bury the one value that matters.
 */
const BRAND_TOKEN = /^--(color-)?(primary|brand|accent|theme|main)(-|$)/i;

const FONT_TOKEN = /^--font(-|$)/i;

/** Generic families a stack falls back to — never the product's typeface. */
const GENERIC_FAMILIES = new Set([
  "serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-sans-serif",
  "ui-serif", "ui-monospace", "ui-rounded", "inherit", "-apple-system", "blinkmacsystemfont",
  "segoe ui", "roboto", "helvetica", "helvetica neue", "arial", "sfmono-regular", "menlo",
  "monaco", "consolas", "courier", "courier new", "sans", "mono", "emoji",
]);

/** `--font-space-grotesk` → "Space Grotesk". The `next/font` convention. */
function familyFromToken(name: string): string | null {
  const stripped = name.replace(/^--font-/i, "");
  if (stripped === name) return null;
  if (["sans", "serif", "mono", "monospace", "display", "body", "heading"].includes(stripped)) {
    return null;
  }
  const humanized = stripped
    .split("-")
    .filter((word) => word !== "")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
  return humanized.length > 0 && humanized.length <= 60 ? humanized : null;
}

function firstConcreteFamily(stack: string): string | null {
  for (const raw of stack.split(",").slice(0, 12)) {
    const family = raw.trim().replace(/^["']|["']$/g, "").trim();
    if (family === "" || family.startsWith("var(")) continue;
    if (GENERIC_FAMILIES.has(family.toLowerCase())) continue;
    if (family.length > 60) continue;
    return family;
  }
  return null;
}

function evidence(kind: LiveEvidence["kind"], path: string, detail?: string): LiveEvidence[] {
  return [{ kind, path, detail }];
}

function buildAssets(html: ParsedHtml, path: string, origin: string): LiveBrandAsset[] {
  const assets: LiveBrandAsset[] = [];

  for (const icon of html.icons) {
    const assetPath = toAssetPath(icon.href, origin);
    if (assetPath === null) continue;

    // `rel` is a declaration by the page author, so the role is not inferred.
    const role: LiveBrandAsset["role"] =
      icon.rel === "manifest"
        ? "web_manifest"
        : icon.rel === "icon" || icon.rel === "shortcut icon"
          ? "favicon"
          : "app_icon";

    assets.push({
      role,
      path: assetPath,
      label: null,
      // A `rel` attribute naming the icon is the strongest statement a static
      // document can make about its own identity.
      confidence: "high",
      evidence: evidence("url_path", path, icon.rel),
    });
  }

  const ogImage = html.openGraph["og:image"];
  if (typeof ogImage === "string") {
    const assetPath = toAssetPath(ogImage, origin);
    if (assetPath !== null) {
      assets.push({
        role: "open_graph_image",
        path: assetPath,
        label: null,
        confidence: "high",
        evidence: evidence("url_path", path, "og:image"),
      });
    }
  }

  for (const image of html.brandImages) {
    const assetPath = toAssetPath(image.src, origin);
    if (assetPath === null) continue;
    assets.push({
      role: "logo",
      path: assetPath,
      label: image.alt,
      // In the header, described as a logo: as close to certain as markup
      // gets. Elsewhere on the page it is a good guess and nothing more.
      confidence: image.inNav ? "high" : "medium",
      evidence: evidence(image.inNav ? "nav_label" : "url_path", path, image.alt ?? "logo"),
    });
  }

  return assets.slice(0, MAX_ASSETS);
}

function buildColors(html: ParsedHtml, path: string): LiveBrandColor[] {
  const colors: LiveBrandColor[] = [];
  const seen = new Set<string>();

  const themeColor = html.themeColor === null ? null : normalizeLiveColor(html.themeColor);
  if (themeColor !== null) {
    seen.add(themeColor);
    colors.push({
      source: "theme_color_meta",
      value: themeColor,
      token: null,
      // A `theme-color` meta tag exists for one purpose: to tell a browser
      // what colour this product is. Nothing else on a page is that explicit.
      confidence: "high",
      evidence: evidence("http_header", path, "theme-color"),
    });
  }

  for (const token of html.styleTokens) {
    if (colors.length >= MAX_COLORS) break;
    if (!BRAND_TOKEN.test(token.name)) continue;
    const value = normalizeLiveColor(token.value);
    if (value === null || seen.has(value)) continue;
    seen.add(value);
    colors.push({
      source: "style_token",
      value,
      token: token.name,
      // The token *name* says it is the brand colour, which is a declaration
      // — but it is one made in CSS the page inlined, not one a browser acts
      // on, so it sits a step below `theme-color`.
      confidence: "medium",
      evidence: evidence("http_header", path, token.name),
    });
  }

  return colors;
}

function buildTypefaces(html: ParsedHtml): string[] {
  const families: string[] = [];

  for (const token of html.styleTokens) {
    if (families.length >= MAX_TYPEFACES) break;
    if (!FONT_TOKEN.test(token.name)) continue;
    const family = familyFromToken(token.name) ?? firstConcreteFamily(token.value);
    if (family === null || families.includes(family)) continue;
    families.push(family);
  }

  return families;
}

/**
 * Site name, in order of how deliberate the statement is.
 *
 * `og:site_name` and `application-name` both exist solely to name the product.
 * The `<title>` does not — it names the *page* — so it is never used here;
 * deriving a product name from a title is the Product Understanding layer's
 * job, where it can be weighed against the repository and marked uncertain.
 */
function buildSiteName(html: ParsedHtml): string | null {
  const declared = html.openGraph["og:site_name"];
  if (typeof declared === "string" && declared.trim() !== "") return declared.trim().slice(0, 120);
  return html.applicationName;
}

export function buildBrandSignals(input: {
  homepage: FetchedPage | undefined;
  effectiveOrigin: string;
}): LiveBrandSignals {
  const { homepage, effectiveOrigin } = input;

  if (!homepage) {
    return { siteName: null, assets: [], colors: [], typefaces: [] };
  }

  const path = homepage.finalPath;
  const rank: Record<Confidence, number> = { high: 0, medium: 1, low: 2 };
  const assets = buildAssets(homepage.html, path, effectiveOrigin).sort(
    (a, b) => rank[a.confidence] - rank[b.confidence],
  );

  return {
    siteName: buildSiteName(homepage.html),
    assets,
    colors: buildColors(homepage.html, path),
    typefaces: buildTypefaces(homepage.html),
  };
}

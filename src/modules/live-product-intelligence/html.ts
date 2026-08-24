import { observePrices, type ObservedPrice } from "./pricing-text";
/**
 * HTML extraction (Sprint 3 §12).
 *
 * HTML is treated strictly as DATA. Nothing here executes, evaluates, or
 * interprets page content: `<script>` and `<style>` bodies are cut out
 * before any text is read, inline handlers are never looked at, and no
 * DOM or browser engine is involved (Sprint 3 §37).
 *
 * The parser is a bounded tag scanner rather than a full HTML5 parser.
 * That is a deliberate trade: we need a dozen well-known fields, not a
 * spec-accurate tree, and every regex here uses a bounded quantifier so a
 * hostile page cannot trigger catastrophic backtracking. Malformed markup
 * degrades to "field not found", never to a crash.
 *
 * Extracted strings are short labels only — titles, headings, link text.
 * The full body is never returned, so it can never be persisted
 * (Sprint 3 §13).
 */

const MAX_TITLE_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 400;
const MAX_LABEL_LENGTH = 120;
const MAX_HEADINGS = 40;
const MAX_LINKS = 400;
const MAX_BUTTONS = 60;
const MAX_FORMS = 20;

export type ParsedLink = {
  href: string;
  text: string;
  rel: string | null;
  /** Inside a <nav> or <header> region. */
  inNav: boolean;
  inFooter: boolean;
};

export type ParsedForm = {
  /** Structural only — input *types*, never names or values (Sprint 3 §18). */
  fieldTypes: string[];
  fieldCount: number;
  hasPassword: boolean;
  passwordCount: number;
  hasEmailField: boolean;
  hasTextarea: boolean;
  submitLabel: string | null;
  /** Lowercased action path, query stripped; null when absent or off-origin. */
  actionPath: string | null;
};

export type ParsedHeading = { level: 1 | 2 | 3; text: string };

/**
 * A price the page **declares about itself** in JSON-LD (schema.org `Offer`).
 *
 * Not a number scraped off the rendered page. This is the operator's own
 * machine-readable statement of what something costs, which is why it is kept
 * separately from anything read out of visible text: one is a fact the site
 * published, the other is an observation that could be a discount, a
 * struck-through price or an "from" figure.
 *
 * Derived fields only (Rule 37) — an amount, a currency code, a period and a
 * short plan label. No page source, no body text.
 */
export type ParsedOffer = {
  /** As declared, e.g. `29` or `9.99`. Finite and non-negative. */
  price: number;
  /** ISO 4217, upper-cased. Three letters or the offer is discarded. */
  currency: string;
  /** The billing period, when the page states one. Null is "did not say". */
  period: OfferPeriod | null;
  /** The plan or product name this offer belongs to, when it has one. */
  name: string | null;
};

export type OfferPeriod = "day" | "week" | "month" | "year" | "one_time";

/** A declared icon: `rel` says what it is for, `href` where it lives. */
export type ParsedIcon = { rel: string; href: string; sizes: string | null };

/**
 * An image the page presents as its mark.
 *
 * Only images whose own attributes say so — an `alt`, `class`, `id` or `src`
 * naming a logo. A page's first `<img>` is not a logo, and treating it as one
 * is how a product ends up revealed under a stock hero photo (CORE-1 §11).
 */
export type ParsedBrandImage = { src: string; alt: string | null; inNav: boolean };

/** A CSS custom property declared in an inline `<style>` block. */
export type ParsedStyleToken = { name: string; value: string };

export type ParsedHtml = {
  title: string | null;
  metaDescription: string | null;
  canonical: string | null;
  language: string | null;
  robotsMeta: string | null;
  hasViewportMeta: boolean;
  openGraph: Record<string, string>;
  structuredDataTypes: string[];
  hasStructuredData: boolean;
  /** Prices the page declares in JSON-LD. Empty when it declares none. */
  offers: ParsedOffer[];
  /**
   * Prices read off the visible text — the weaker source, kept apart.
   *
   * See `pricing-text.ts` for why these carry a token rather than a currency
   * code, and why they are never merged with `offers`.
   */
  observedPrices: ObservedPrice[];
  headings: ParsedHeading[];
  links: ParsedLink[];
  buttons: string[];
  forms: ParsedForm[];
  /** Brand signals (CORE-1 §11–§13). Derived facts only, never page source. */
  icons: ParsedIcon[];
  themeColor: string | null;
  applicationName: string | null;
  brandImages: ParsedBrandImage[];
  styleTokens: ParsedStyleToken[];
};

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  "#39": "'",
  "#x27": "'",
  "#34": '"',
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
    const key = entity.toLowerCase();
    if (key in ENTITIES) return ENTITIES[key];
    if (key.startsWith("#x")) {
      const code = Number.parseInt(key.slice(2), 16);
      return Number.isFinite(code) && code < 0x10000 ? String.fromCodePoint(code) : match;
    }
    if (key.startsWith("#")) {
      const code = Number.parseInt(key.slice(1), 10);
      return Number.isFinite(code) && code < 0x10000 ? String.fromCodePoint(code) : match;
    }
    return match;
  });
}

/** Strips nested tags, decodes entities, collapses whitespace and truncates. */
function toText(html: string, maxLength: number): string {
  const withoutTags = html.replace(/<[^>]{0,2000}>/g, " ");
  const decoded = decodeEntities(withoutTags);
  const collapsed = decoded.replace(/\s+/g, " ").trim();
  return collapsed.length > maxLength ? collapsed.slice(0, maxLength) : collapsed;
}

const ATTRIBUTE_PATTERN =
  /([a-zA-Z_:][-a-zA-Z0-9_:.]{0,60})(?:\s*=\s*(?:"([^"]{0,2000})"|'([^']{0,2000})'|([^\s"'>]{0,500})))?/g;

/** Parses a tag's attribute string into a lowercased-name map. */
export function parseAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  ATTRIBUTE_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ATTRIBUTE_PATTERN.exec(source)) !== null) {
    if (match[0].trim() === "") {
      ATTRIBUTE_PATTERN.lastIndex += 1;
      continue;
    }
    const name = match[1].toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    if (!(name in attributes)) attributes[name] = decodeEntities(value);
  }
  return attributes;
}

type Region = { start: number; end: number };

function findRegions(html: string, tag: string): Region[] {
  const regions: Region[] = [];
  const pattern = new RegExp(`<${tag}\\b[^>]{0,1000}>([\\s\\S]{0,60000}?)</${tag}>`, "gi");
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null && regions.length < 20) {
    regions.push({ start: match.index, end: match.index + match[0].length });
  }
  return regions;
}

function inAnyRegion(index: number, regions: Region[]): boolean {
  return regions.some((region) => index >= region.start && index < region.end);
}

/**
 * Extracts JSON-LD `@type` values. `JSON.parse` is data-only — it cannot
 * execute the script block, which is exactly why structured data is read
 * this way and not by evaluating the tag.
 */
/**
 * ISO 4217 is three letters. Anything else is not a currency we will repeat
 * back to a founder as one.
 */
const CURRENCY = /^[A-Za-z]{3}$/;

/** The most an offer's plan label may carry. A name, never a paragraph. */
const MAX_OFFER_NAME = 80;

/** schema.org UN/CEFACT unit codes that state a billing period. */
const UNIT_CODE_PERIODS: Record<string, OfferPeriod> = {
  DAY: "day",
  WEE: "week",
  MON: "month",
  ANN: "year",
  // Both appear in the wild for a year.
  YER: "year",
};

/** ISO 8601 durations schema.org uses for a billing period. */
function periodFromDuration(value: string): OfferPeriod | null {
  const match = /^P(?:(\d+)Y|(\d+)M|(\d+)W|(\d+)D)$/i.exec(value.trim());
  if (!match) return null;
  // Only a period of exactly one is a billing period we can name. "P3M" is a
  // quarterly plan, and calling it monthly would be a quiet third of a lie.
  const [, years, months, weeks, days] = match;
  if (years === "1") return "year";
  if (months === "1") return "month";
  if (weeks === "1") return "week";
  if (days === "1") return "day";
  return null;
}

function offerPeriodOf(record: Record<string, unknown>): OfferPeriod | null {
  const unit = record["unitCode"];
  if (typeof unit === "string") {
    const period = UNIT_CODE_PERIODS[unit.trim().toUpperCase()];
    if (period) return period;
  }

  for (const key of ["billingDuration", "billingPeriod", "duration"]) {
    const value = record[key];
    if (typeof value === "string") {
      const period = periodFromDuration(value);
      if (period) return period;
    }
  }

  const reference = record["referenceQuantity"];
  if (reference !== null && typeof reference === "object" && !Array.isArray(reference)) {
    return offerPeriodOf(reference as Record<string, unknown>);
  }

  return null;
}

/**
 * A declared amount, or null.
 *
 * schema.org allows both a number and a string, and sites publish `"29.00"`,
 * `"29"` and `29` interchangeably. A value carrying anything else — a currency
 * symbol, a range, a comma-grouped thousand — is refused rather than guessed
 * at, because a misparsed price is worse than a missing one.
 */
function declaredPrice(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value !== "string") return null;
  if (!/^\d+(?:\.\d+)?$/.test(value.trim())) return null;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function extractStructuredData(html: string): { types: string[]; offers: ParsedOffer[] } {
  const types = new Set<string>();
  const offers: ParsedOffer[] = [];
  const pattern =
    /<script\b[^>]{0,500}type\s*=\s*["']application\/ld\+json["'][^>]{0,500}>([\s\S]{0,100000}?)<\/script>/gi;

  let match: RegExpExecArray | null;
  let blocks = 0;
  while ((match = pattern.exec(html)) !== null && blocks < 10) {
    blocks += 1;
    try {
      const parsed: unknown = JSON.parse(match[1].trim());
      const visit = (node: unknown, depth: number, inheritedName: string | null) => {
        // Depth is bounded for types *and* offers together: a document deep
        // enough to hide an offer below this is a document we decline to trust.
        if (depth > 4 || (types.size >= 12 && offers.length >= MAX_OFFERS)) return;
        if (Array.isArray(node)) {
          for (const item of node.slice(0, 20)) visit(item, depth + 1, inheritedName);
          return;
        }
        if (node === null || typeof node !== "object") return;
        const record = node as Record<string, unknown>;
        const type = record["@type"];
        if (typeof type === "string") types.add(type.slice(0, 60));
        if (Array.isArray(type)) {
          for (const item of type) if (typeof item === "string") types.add(item.slice(0, 60));
        }

        /*
         * The name an offer belongs to is carried *down*, not looked up.
         *
         * `{"@type":"Product","name":"Pro","offers":{...}}` is the common
         * shape, and the offer itself usually has no name of its own. Passing
         * the enclosing product's name down the walk is what turns a bare
         * amount into "Pro — 29 USD / month".
         */
        const own = record["name"];
        const name =
          typeof own === "string" && own.trim().length > 0
            ? own.trim().slice(0, MAX_OFFER_NAME)
            : inheritedName;

        collectOffer(record, name, offers);

        for (const key of ["@graph", "offers", "priceSpecification", "hasVariant", "itemOffered"]) {
          const child = record[key];
          if (child !== undefined) visit(child, depth + 1, name);
        }
      };
      visit(parsed, 0, null);
    } catch {
      // Invalid JSON-LD is a fact about the page, not an error worth
      // failing an otherwise useful analysis over.
    }
  }
  return { types: [...types], offers };
}

/** At most this many declared prices per page. A price list, not a catalogue. */
const MAX_OFFERS = 12;

/**
 * Records one offer, if this node actually is one.
 *
 * Deliberately strict about what counts. A node needs a parseable amount *and*
 * a three-letter currency; an offer missing either is dropped rather than
 * half-recorded, because "29" with no currency is not a price a founder can be
 * shown and a defaulted one would be an invention.
 */
function collectOffer(
  record: Record<string, unknown>,
  name: string | null,
  offers: ParsedOffer[],
): void {
  if (offers.length >= MAX_OFFERS) return;

  const price = declaredPrice(record["price"]);
  if (price === null) return;

  const currency = record["priceCurrency"];
  if (typeof currency !== "string" || !CURRENCY.test(currency.trim())) return;

  offers.push({
    price,
    currency: currency.trim().toUpperCase(),
    period: offerPeriodOf(record),
    name,
  });
}

/** `rel` values worth recording. Anything else is not an icon we can use. */
const ICON_RELS = new Set([
  "icon",
  "shortcut icon",
  "apple-touch-icon",
  "apple-touch-icon-precomposed",
  "mask-icon",
  "manifest",
]);

const MAX_ICONS = 8;
const MAX_BRAND_IMAGES = 4;
const MAX_STYLE_TOKENS = 200;

/** Attribute shapes that make an image the page's own mark rather than content. */
const LOGO_ATTRIBUTE = /(^|[\s\-_/])logo|wordmark|brandmark|site-?(mark|icon)/i;

/**
 * Custom-property declarations from inline `<style>` blocks.
 *
 * A page's linked stylesheets are deliberately **not** fetched: CORE-1 keeps
 * live inspection to the static HTML the crawler already downloads, so brand
 * colour on the live side is whatever the document itself declares. Frameworks
 * that inline critical CSS (Next.js among them) put the token block right
 * here; ones that do not simply contribute no colour evidence, and the
 * repository side answers instead.
 */
function extractStyleTokens(html: string): ParsedStyleToken[] {
  const tokens: ParsedStyleToken[] = [];
  const blockPattern = /<style\b[^>]{0,1000}>([\s\S]{0,200000}?)<\/style>/gi;
  const declarationPattern = /--([a-zA-Z0-9_-]{1,60})\s*:\s*([^;{}]{1,200})[;}]/g;

  let block: RegExpExecArray | null;
  let blocks = 0;
  while ((block = blockPattern.exec(html)) !== null && blocks < 12) {
    blocks += 1;
    declarationPattern.lastIndex = 0;
    let declaration: RegExpExecArray | null;
    while (
      (declaration = declarationPattern.exec(block[1])) !== null &&
      tokens.length < MAX_STYLE_TOKENS
    ) {
      const value = declaration[2].trim();
      if (value === "") continue;
      tokens.push({ name: `--${declaration[1]}`, value });
    }
  }
  return tokens;
}

function normalizeActionPath(action: string): string | null {
  const value = action.trim();
  if (value === "") return null;
  if (/^(?:javascript|data|mailto|tel):/i.test(value)) return null;
  try {
    // A relative action resolves against a placeholder; only the path is kept.
    const url = new URL(value, "https://placeholder.invalid/");
    return url.pathname.toLowerCase();
  } catch {
    return null;
  }
}

function parseForm(attributesSource: string, inner: string): ParsedForm {
  const fieldTypes: string[] = [];
  let passwordCount = 0;
  let hasEmailField = false;
  let submitLabel: string | null = null;

  const inputPattern = /<input\b([^>]{0,1500})>/gi;
  let match: RegExpExecArray | null;
  let fields = 0;
  while ((match = inputPattern.exec(inner)) !== null && fields < 60) {
    fields += 1;
    const attributes = parseAttributes(match[1]);
    const type = (attributes["type"] ?? "text").toLowerCase();

    // Hidden fields are structural noise and the most likely place for
    // tokens; counted nowhere, read never.
    if (type === "hidden") continue;

    fieldTypes.push(type);
    if (type === "password") passwordCount += 1;
    if (type === "email") hasEmailField = true;

    // A field's *purpose* is inferred from type and autocomplete only —
    // never from any value or placeholder the page supplies.
    const autocomplete = (attributes["autocomplete"] ?? "").toLowerCase();
    if (autocomplete.includes("email")) hasEmailField = true;

    if ((type === "submit" || type === "button") && attributes["value"] !== undefined) {
      submitLabel ??= attributes["value"].slice(0, MAX_LABEL_LENGTH);
    }
  }

  const hasTextarea = /<textarea\b/i.test(inner);
  if (hasTextarea) fieldTypes.push("textarea");

  const selectCount = (inner.match(/<select\b/gi) ?? []).length;
  for (let index = 0; index < Math.min(selectCount, 10); index += 1) fieldTypes.push("select");

  if (submitLabel === null) {
    const buttonMatch = /<button\b[^>]{0,500}>([\s\S]{0,200}?)<\/button>/i.exec(inner);
    if (buttonMatch) {
      const text = toText(buttonMatch[1], MAX_LABEL_LENGTH);
      if (text !== "") submitLabel = text;
    }
  }

  const attributes = parseAttributes(attributesSource);

  return {
    fieldTypes,
    fieldCount: fieldTypes.length,
    hasPassword: passwordCount > 0,
    passwordCount,
    hasEmailField,
    hasTextarea,
    submitLabel,
    actionPath: normalizeActionPath(attributes["action"] ?? ""),
  };
}

export function parseHtml(html: string): ParsedHtml {
  // Comments first: they can contain markup that would otherwise be read
  // as real tags.
  const withoutComments = html.replace(/<!--[\s\S]{0,50000}?-->/g, " ");

  const { types: structuredDataTypes, offers } = extractStructuredData(withoutComments);
  // Read before `<style>` bodies are stripped below. Only custom-property
  // *declarations* are taken — never the stylesheet text itself.
  const styleTokens = extractStyleTokens(withoutComments);
  // Present counts as: parseable JSON-LD, an unparseable JSON-LD block
  // (the page still declares structured data), or Microdata markup.
  const hasStructuredData =
    structuredDataTypes.length > 0 ||
    /<script\b[^>]{0,500}type\s*=\s*["']application\/ld\+json["']/i.test(withoutComments) ||
    /\bitemscope\b/i.test(withoutComments);

  // Script and style bodies are removed before any text extraction, so no
  // JavaScript source can be mistaken for page copy.
  const content = withoutComments
    .replace(/<script\b[^>]{0,1000}>[\s\S]{0,200000}?<\/script>/gi, " ")
    .replace(/<style\b[^>]{0,1000}>[\s\S]{0,200000}?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]{0,1000}>[\s\S]{0,50000}?<\/noscript>/gi, " ");

  const titleMatch = /<title\b[^>]{0,500}>([\s\S]{0,500}?)<\/title>/i.exec(content);
  const title = titleMatch ? toText(titleMatch[1], MAX_TITLE_LENGTH) || null : null;

  const htmlTagMatch = /<html\b([^>]{0,1000})>/i.exec(content);
  const language = htmlTagMatch
    ? (parseAttributes(htmlTagMatch[1])["lang"] ?? "").trim().slice(0, 20) || null
    : null;

  let metaDescription: string | null = null;
  let robotsMeta: string | null = null;
  let hasViewportMeta = false;
  let themeColor: string | null = null;
  let applicationName: string | null = null;
  const openGraph: Record<string, string> = {};

  const metaPattern = /<meta\b([^>]{0,2000})>/gi;
  let metaMatch: RegExpExecArray | null;
  let metaCount = 0;
  while ((metaMatch = metaPattern.exec(content)) !== null && metaCount < 200) {
    metaCount += 1;
    const attributes = parseAttributes(metaMatch[1]);
    const name = (attributes["name"] ?? "").toLowerCase();
    const property = (attributes["property"] ?? "").toLowerCase();
    const contentValue = attributes["content"] ?? "";

    if (name === "description" && metaDescription === null) {
      metaDescription = toText(contentValue, MAX_DESCRIPTION_LENGTH) || null;
    }
    if (name === "robots" && robotsMeta === null) {
      robotsMeta = contentValue.trim().slice(0, 120) || null;
    }
    if (name === "viewport") hasViewportMeta = true;
    if (name === "theme-color" && themeColor === null) {
      themeColor = contentValue.trim().slice(0, 40) || null;
    }
    if ((name === "application-name" || name === "apple-mobile-web-app-title") && applicationName === null) {
      applicationName = toText(contentValue, MAX_LABEL_LENGTH) || null;
    }
    if (property.startsWith("og:") && Object.keys(openGraph).length < 12) {
      openGraph[property] = toText(contentValue, MAX_DESCRIPTION_LENGTH);
    }
  }

  let canonical: string | null = null;
  const icons: ParsedIcon[] = [];
  const linkTagPattern = /<link\b([^>]{0,2000})>/gi;
  let linkTagMatch: RegExpExecArray | null;
  let linkTagCount = 0;
  while ((linkTagMatch = linkTagPattern.exec(content)) !== null && linkTagCount < 200) {
    linkTagCount += 1;
    const attributes = parseAttributes(linkTagMatch[1]);
    const rel = (attributes["rel"] ?? "").trim().toLowerCase();
    if (rel === "canonical" && canonical === null) {
      canonical = (attributes["href"] ?? "").trim().slice(0, 500) || null;
    }
    if (ICON_RELS.has(rel) && icons.length < MAX_ICONS) {
      const href = (attributes["href"] ?? "").trim();
      if (href !== "" && !/^(javascript|data):/i.test(href)) {
        icons.push({
          rel,
          href: href.slice(0, 500),
          sizes: (attributes["sizes"] ?? "").trim().slice(0, 40) || null,
        });
      }
    }
  }

  const navRegions = [...findRegions(content, "nav"), ...findRegions(content, "header")];
  const footerRegions = findRegions(content, "footer");

  const headings: ParsedHeading[] = [];
  const headingPattern = /<h([1-3])\b[^>]{0,500}>([\s\S]{0,400}?)<\/h\1>/gi;
  let headingMatch: RegExpExecArray | null;
  while ((headingMatch = headingPattern.exec(content)) !== null && headings.length < MAX_HEADINGS) {
    const text = toText(headingMatch[2], MAX_LABEL_LENGTH);
    if (text === "") continue;
    headings.push({ level: Number(headingMatch[1]) as 1 | 2 | 3, text });
  }

  const links: ParsedLink[] = [];
  const anchorPattern = /<a\b([^>]{0,2000})>([\s\S]{0,600}?)<\/a>/gi;
  let anchorMatch: RegExpExecArray | null;
  while ((anchorMatch = anchorPattern.exec(content)) !== null && links.length < MAX_LINKS) {
    const attributes = parseAttributes(anchorMatch[1]);
    const href = attributes["href"];
    if (href === undefined || href.trim() === "") continue;
    links.push({
      href: href.trim().slice(0, 1000),
      text: toText(anchorMatch[2], MAX_LABEL_LENGTH),
      rel: (attributes["rel"] ?? "").trim().toLowerCase() || null,
      inNav: inAnyRegion(anchorMatch.index, navRegions),
      inFooter: inAnyRegion(anchorMatch.index, footerRegions),
    });
  }

  const buttons: string[] = [];
  const buttonPattern = /<button\b[^>]{0,1000}>([\s\S]{0,300}?)<\/button>/gi;
  let buttonMatch: RegExpExecArray | null;
  while ((buttonMatch = buttonPattern.exec(content)) !== null && buttons.length < MAX_BUTTONS) {
    const text = toText(buttonMatch[1], MAX_LABEL_LENGTH);
    if (text !== "") buttons.push(text);
  }

  // Images the page itself labels as its mark. `alt` first, because that is
  // the one attribute a human wrote on purpose; class/id/src are corroborating.
  const brandImages: ParsedBrandImage[] = [];
  const imagePattern = /<img\b([^>]{0,2000})>/gi;
  let imageMatch: RegExpExecArray | null;
  let imagesSeen = 0;
  while ((imageMatch = imagePattern.exec(content)) !== null && imagesSeen < 200) {
    imagesSeen += 1;
    if (brandImages.length >= MAX_BRAND_IMAGES) break;

    const attributes = parseAttributes(imageMatch[1]);
    const src = (attributes["src"] ?? attributes["data-src"] ?? "").trim();
    if (src === "" || /^(javascript|data):/i.test(src)) continue;

    const alt = attributes["alt"] ?? "";
    const descriptor = `${alt} ${attributes["class"] ?? ""} ${attributes["id"] ?? ""} ${src}`;
    if (!LOGO_ATTRIBUTE.test(descriptor)) continue;

    brandImages.push({
      src: src.slice(0, 500),
      alt: toText(alt, MAX_LABEL_LENGTH) || null,
      inNav: inAnyRegion(imageMatch.index, navRegions),
    });
  }

  const forms: ParsedForm[] = [];
  const formPattern = /<form\b([^>]{0,2000})>([\s\S]{0,40000}?)<\/form>/gi;
  let formMatch: RegExpExecArray | null;
  while ((formMatch = formPattern.exec(content)) !== null && forms.length < MAX_FORMS) {
    forms.push(parseForm(formMatch[1], formMatch[2]));
  }

  return {
    title,
    metaDescription,
    canonical,
    language,
    robotsMeta,
    hasViewportMeta,
    openGraph,
    structuredDataTypes,
    offers,
    observedPrices: observePrices(content),
    hasStructuredData,
    headings,
    links,
    buttons,
    forms,
    icons,
    themeColor,
    applicationName,
    brandImages,
    styleTokens,
  };
}

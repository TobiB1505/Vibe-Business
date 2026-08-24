import type { OfferPeriod } from "./html";

/**
 * Prices read off a page's visible text.
 *
 * The weaker of the two sources, and kept structurally apart from the stronger
 * one for that reason. A schema.org `Offer` is what the operator published
 * about their own business; this is a glyph and a number that happened to sit
 * next to each other, and it could as easily be a discount, a struck-through
 * figure, an "from" amount, or the price of something that is not the product.
 *
 * It exists because most sites publish no `Offer` at all. Without it the
 * declared path is honest and almost always silent.
 *
 * ## Why there is no currency code here
 *
 * `$` is not USD. It is also CAD, AUD, NZD, HKD, MXN and more, and a page that
 * writes `$29` has not said which. Mapping the glyph to a code would invent the
 * half of the fact the page withheld — the same mistake `repo.surface.payments`
 * made about presence, one namespace over.
 *
 * So the token is recorded **as written**. A declared offer carries
 * `currency: "USD"` because the site published that code; an observed price
 * carries `currencyToken: "$"` because a glyph is all there was.
 *
 * ## Rule 37
 *
 * Nothing here retains page text. The scan reads the stripped content, derives
 * numbers and a period, and discards everything it walked over.
 */

export type ObservedPrice = {
  amount: number;
  /** Exactly as written — a symbol or an ISO code. Never inferred, never mapped. */
  currencyToken: string;
  /** The billing period stated within a short window after the amount. */
  period: OfferPeriod | null;
};

/** Symbols common enough to be worth recognising, and unambiguous *as glyphs*. */
const SYMBOLS = ["$", "€", "£", "¥", "₹", "₽", "R$", "CHF", "kr"];

/** Codes a page may write out. Recognised, and kept exactly as written. */
const CODES = ["USD", "EUR", "GBP", "CHF", "CAD", "AUD", "NZD", "SEK", "NOK", "DKK", "PLN", "JPY"];

/** At most this many observations per page. A price list, not a catalogue. */
const MAX_OBSERVED = 12;

/** How far after an amount a period word still counts as attached to it. */
const PERIOD_WINDOW = 24;

const PERIOD_PATTERNS: ReadonlyArray<[RegExp, OfferPeriod]> = [
  [/^\s*(?:\/|per\s+|a\s+|pro\s+|je\s+)?(?:mo\b|month|monat|mtl\.?|monthly|monatlich)/i, "month"],
  [/^\s*(?:\/|per\s+|a\s+|pro\s+|je\s+)?(?:yr\b|year|jahr|jährlich|annually|annual|p\.?a\.?)/i, "year"],
  [/^\s*(?:\/|per\s+|a\s+|pro\s+|je\s+)?(?:wk\b|week|woche|wöchentlich|weekly)/i, "week"],
  [/^\s*(?:\/|per\s+|a\s+|pro\s+|je\s+)?(?:day|tag|täglich|daily)/i, "day"],
  [/^\s*(?:one[-\s]?time|einmalig|once)/i, "one_time"],
];

/**
 * Turns a written amount into a number, or null when it is ambiguous.
 *
 * Refusing is the common and correct outcome. `29,9` could be twenty-nine
 * point nine in one locale and something else in another; a price shown to a
 * founder as a fact about their business has to be one reading, not the more
 * likely of two.
 *
 * What is accepted: plain integers, a two-digit decimal after either separator,
 * and three-digit grouping by either separator. Everything else is dropped.
 */
export function parseWrittenAmount(raw: string): number | null {
  const value = raw.trim();
  if (!/^\d[\d.,]*$/.test(value)) return null;

  // Every separator must divide two runs of digits. `29..99` and `29,,99` are
  // malformed, and without this they normalise silently to 29.99 — the parser
  // inventing a price out of a typo, which is the one outcome this module is
  // built to avoid.
  if (value.split(/[.,]/).some((group) => group.length === 0)) return null;

  const lastDot = value.lastIndexOf(".");
  const lastComma = value.lastIndexOf(",");
  const lastSeparator = Math.max(lastDot, lastComma);

  if (lastSeparator === -1) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  const tail = value.slice(lastSeparator + 1);

  // Three digits after the final separator is grouping, not a decimal —
  // "1,299" and "1.299" are both one thousand two hundred and ninety-nine.
  if (/^\d{3}$/.test(tail)) {
    const digits = value.replace(/[.,]/g, "");
    if (!/^\d+$/.test(digits)) return null;
    const parsed = Number(digits);
    return Number.isFinite(parsed) ? parsed : null;
  }

  // Two digits is a decimal in every locale that writes money this way.
  if (/^\d{2}$/.test(tail)) {
    const whole = value.slice(0, lastSeparator).replace(/[.,]/g, "");
    if (!/^\d+$/.test(whole)) return null;
    const parsed = Number(`${whole}.${tail}`);
    return Number.isFinite(parsed) ? parsed : null;
  }

  // One digit, or four and more. Not a form this refuses to guess at.
  return null;
}

function periodAfter(content: string, index: number): OfferPeriod | null {
  const window = content.slice(index, index + PERIOD_WINDOW);
  for (const [pattern, period] of PERIOD_PATTERNS) {
    if (pattern.test(window)) return period;
  }
  return null;
}

function escape(token: string): string {
  return token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Observes prices in already-stripped page content.
 *
 * `content` must be the script-, style- and noscript-free text `parseHtml`
 * produces. Handing it raw HTML would let a minified bundle's constants be read
 * as a founder's prices.
 */
export function observePrices(content: string): ObservedPrice[] {
  const observed: ObservedPrice[] = [];
  const seen = new Set<string>();

  // Tags are replaced with a space rather than removed, so that `<span>29</span>
  // <span>€</span>` does not silently become the number "29€" of an element
  // boundary that was never there.
  const text = content.replace(/<[^>]{0,2000}>/g, " ");

  const tokens = [...SYMBOLS, ...CODES];
  const before = new RegExp(`(${tokens.map(escape).join("|")})\\s{0,2}(\\d[\\d.,]{0,12})`, "gi");
  const after = new RegExp(`(\\d[\\d.,]{0,12})\\s{0,2}(${tokens.map(escape).join("|")})`, "gi");

  for (const pattern of [before, after]) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null && observed.length < MAX_OBSERVED) {
      const symbolFirst = pattern === before;
      const token = (symbolFirst ? match[1] : match[2]).trim();
      const amount = parseWrittenAmount(symbolFirst ? match[2] : match[1]);
      if (amount === null) continue;

      const key = `${token}|${amount}`;
      if (seen.has(key)) continue;
      seen.add(key);

      observed.push({
        amount,
        currencyToken: token,
        period: periodAfter(text, match.index + match[0].length),
      });
    }
  }

  return observed;
}

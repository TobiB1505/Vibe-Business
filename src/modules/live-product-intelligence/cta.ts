import type { CtaCategory, CtaSignal, Confidence } from "./schema";

/**
 * Deterministic CTA classification (Sprint 3 §17).
 *
 * The rule model is a table of `{ category, patterns }` rather than
 * hard-coded English string comparisons, so adding a language means
 * adding patterns — not restructuring the detector. German is included
 * from the start to prove the model actually extends; the architecture is
 * what matters here, not exhaustive language coverage.
 *
 * Precision over recall, deliberately. A label must match a known action
 * phrase to count, so a page full of ordinary navigation links does not
 * report a dozen CTAs (Sprint 3 §17). Everything else is simply not a
 * CTA, which is a fact — not a judgement about the page.
 */

/** Longer text is prose or a card, not a button label. */
const MAX_CTA_LABEL_LENGTH = 40;

type CtaRule = {
  category: CtaCategory;
  /** Matched against the normalized (lowercased, whitespace-collapsed) label. */
  patterns: RegExp[];
};

const CTA_RULES: CtaRule[] = [
  {
    category: "trial",
    patterns: [
      /\b(?:start|try)\b[^a-z]{0,3}\b(?:free|for free)\b/,
      /\bfree trial\b/,
      /\btry (?:it )?(?:free|now)\b/,
      /\bkostenlos (?:testen|starten|ausprobieren)\b/,
      /\bgratis testen\b/,
    ],
  },
  {
    category: "signup",
    patterns: [
      /\bsign ?up\b/,
      /\bcreate (?:an )?account\b/,
      /\bget an account\b/,
      /\bregistrieren\b/,
      /\bkonto erstellen\b/,
      /\bjetzt registrieren\b/,
    ],
  },
  {
    category: "get_started",
    patterns: [
      /\bget started\b/,
      /\bstart (?:now|building|here)\b/,
      /\bstart your\b/,
      /\bjetzt starten\b/,
      /\blos ?geht'?s\b/,
      /\bloslegen\b/,
    ],
  },
  {
    category: "purchase",
    patterns: [
      /\bbuy\b/,
      /\bpurchase\b/,
      /\border now\b/,
      /\badd to (?:cart|basket)\b/,
      /\bcheckout\b/,
      /\bkaufen\b/,
      /\bin den warenkorb\b/,
      /\bjetzt bestellen\b/,
    ],
  },
  {
    category: "subscribe",
    patterns: [
      /\bsubscribe\b/,
      /\bupgrade\b/,
      /\bchoose (?:a )?plan\b/,
      /\bget (?:pro|premium|plus)\b/,
      /\babonnieren\b/,
      /\bplan wählen\b/,
    ],
  },
  {
    category: "demo",
    patterns: [
      /\bbook a demo\b/,
      /\brequest a demo\b/,
      /\bget a demo\b/,
      /\bsee it in action\b/,
      /\bdemo (?:buchen|anfordern)\b/,
      /\btermin buchen\b/,
    ],
  },
  {
    category: "contact",
    patterns: [
      /\bcontact (?:us|sales)\b/,
      /\btalk to (?:us|sales)\b/,
      /\bget in touch\b/,
      /\bkontakt aufnehmen\b/,
      /\bkontaktiere uns\b/,
    ],
  },
  {
    category: "login",
    patterns: [
      /\b(?:log ?in|sign ?in)\b/,
      /\banmelden\b/,
      /\beinloggen\b/,
    ],
  },
];

/**
 * How strongly each category indicates a *primary* conversion action.
 * Higher wins when choosing the page's primary CTA — "Start free" is a
 * stronger primary action than "Log in", which most products show in the
 * nav on every page.
 */
const CATEGORY_PRIORITY: Record<CtaCategory, number> = {
  trial: 6,
  signup: 6,
  get_started: 5,
  purchase: 5,
  subscribe: 4,
  demo: 3,
  contact: 2,
  login: 1,
};

/** Login/contact in a nav bar is site furniture, not the page's call to action. */
const NAV_ONLY_CATEGORIES = new Set<CtaCategory>(["login", "contact"]);

export function normalizeLabel(label: string): string {
  return label.toLowerCase().replace(/\s+/g, " ").trim();
}

export function classifyCtaLabel(label: string): { category: CtaCategory; confidence: Confidence } | null {
  const normalized = normalizeLabel(label);
  if (normalized === "" || normalized.length > MAX_CTA_LABEL_LENGTH) return null;

  for (const rule of CTA_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(normalized))) {
      // A short, standalone label is a button; the same phrase inside a
      // longer sentence is weaker evidence.
      const confidence: Confidence = normalized.length <= 24 ? "high" : "medium";
      return { category: rule.category, confidence };
    }
  }

  return null;
}

export type CtaCandidate = { label: string; path: string; inNav: boolean };

export function detectCtas(candidates: CtaCandidate[]): CtaSignal[] {
  const signals: CtaSignal[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    const classification = classifyCtaLabel(candidate.label);
    if (!classification) continue;

    const key = `${classification.category}:${normalizeLabel(candidate.label)}:${candidate.path}`;
    if (seen.has(key)) continue;
    seen.add(key);

    signals.push({
      category: classification.category,
      label: candidate.label.slice(0, MAX_CTA_LABEL_LENGTH),
      confidence: classification.confidence,
      path: candidate.path,
      inNav: candidate.inNav,
    });
  }

  return signals;
}

/**
 * Picks the single most likely primary action across the site.
 *
 * Body CTAs beat navigation CTAs, then category priority decides, then
 * homepage placement. Returns null rather than guessing when nothing
 * matched — "no primary CTA detected" is a legitimate, useful result.
 */
export function selectPrimaryCta(signals: CtaSignal[]): CtaSignal | null {
  const ranked = [...signals].sort((a, b) => {
    const navPenalty = (signal: CtaSignal) =>
      signal.inNav && NAV_ONLY_CATEGORIES.has(signal.category) ? 2 : signal.inNav ? 1 : 0;

    const byNav = navPenalty(a) - navPenalty(b);
    if (byNav !== 0) return byNav;

    const byPriority = CATEGORY_PRIORITY[b.category] - CATEGORY_PRIORITY[a.category];
    if (byPriority !== 0) return byPriority;

    const homepageRank = (signal: CtaSignal) => (signal.path === "/" ? 0 : 1);
    return homepageRank(a) - homepageRank(b);
  });

  return ranked[0] ?? null;
}

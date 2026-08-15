import { capabilityLabel } from "./assemble";
import {
  JOURNEY_STAGE_LABELS,
  type BrandAsset,
  type BrandColor,
  type BrandTypeface,
  type EvidenceSource,
  type ProductProfile,
  type ProfileConfidence,
} from "./schema";

/**
 * The Product Understanding view model (CORE-1 §26–§35, §42, §45).
 *
 * ## Why this file exists at all
 *
 * Everything a component renders is decided here, in plain data, and tested
 * here. The sprint's hardest requirements are all *language* requirements —
 * never say "detected 14 routes", never say "you make money through
 * subscriptions" because Stripe is installed, never show a confidence as a
 * percentage — and language rules enforced inside JSX are language rules
 * nobody can test.
 *
 * ## The rule every string below follows
 *
 * A sentence may only claim what its confidence supports.
 *
 *   confirmed  → say it plainly.        "You can sign in."
 *   likely     → say it hedged.         "Signing in appears to be possible."
 *   unclear    → say what is missing.   "Vibe could not tell."
 *   not_found  → say Vibe looked.       "Vibe found no sign of this."
 *
 * `not_found` never becomes "your product is missing X". Vibe read two
 * sources under a budget; that is not an audit, and the difference matters to
 * a founder reading it (CORE-1 §17, §42).
 */

export type ConfidenceTone = "confirmed" | "likely" | "unknown";

/**
 * Three tones for four confidences: `unclear` and `not_found` look identical
 * to a reader, because "we could not tell" and "we saw nothing" are the same
 * message on screen. They stay distinct in the data, where the difference
 * still matters.
 */
export function toneFor(confidence: ProfileConfidence): ConfidenceTone {
  if (confidence === "confirmed") return "confirmed";
  if (confidence === "likely") return "likely";
  return "unknown";
}

/** How Vibe knows, in the words a person would use (CORE-1 §34, §45). */
export const SOURCE_LABELS: Record<EvidenceSource, string> = {
  user_confirmed: "You told Vibe",
  repository: "Your code",
  live_product: "Your public product",
  deep_scan: "Your signed-in product",
  ai_inferred: "Vibe's reading of the evidence",
};

/**
 * The short qualifier beside a claim.
 *
 * Deliberately not a percentage and not a number. A founder cannot act on
 * "87% confident", and the underlying signal is a four-step ladder — rendering
 * it as a figure would invent precision the data does not have (CORE-1 §28).
 */
export function confidenceNote(confidence: ProfileConfidence, sources: EvidenceSource[]): string {
  if (sources.includes("user_confirmed")) return "You confirmed this";
  if (confidence === "confirmed") {
    return sources.includes("live_product") ? "Seen on your live product" : "Found in your code";
  }
  if (confidence === "likely") return "Likely, based on several signals";
  return "Vibe could not establish this";
}

// ---------------------------------------------------------------------
// Headline
// ---------------------------------------------------------------------

export type UnderstandingHeadline = {
  /** The line above the fold. Never "analysis complete". */
  title: string;
  productName: string | null;
  /** The paragraph the whole screen is built around. Null when none survived. */
  understanding: string | null;
  /** Shown under the paragraph when the model never ran. */
  synthesisNote: string | null;
};

export function buildHeadline(profile: ProductProfile, synthesized: boolean): UnderstandingHeadline {
  const name = profile.identity.name.value;
  const understanding =
    profile.identity.understanding.value ?? profile.identity.shortDescription.value;

  return {
    // The one sentence CORE-1 §31 asks for, and it is a claim about Vibe, not
    // about the product — so it is honest even when the profile is thin.
    title: understanding ? "I understand what you built." : "Here's what Vibe found.",
    productName: name,
    understanding,
    synthesisNote: synthesized
      ? null
      : "Vibe described your product from what it found in your code and on your site. The part that reads it back to you in a sentence didn't run this time.",
  };
}

// ---------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------

export type UnderstandingFact = {
  label: string;
  value: string;
  tone: ConfidenceTone;
  note: string;
  sources: EvidenceSource[];
};

/** "Who it's for" — omitted entirely when nothing survived (CORE-1 §31). */
export function buildAudienceFacts(profile: ProductProfile): UnderstandingFact[] {
  const rows: { label: string; field: keyof ProductProfile["audience"] }[] = [
    { label: "Who it's for", field: "primaryAudience" },
    { label: "The problem it solves", field: "problemSolved" },
    { label: "What people use it for", field: "useCase" },
  ];

  return rows.flatMap(({ label, field }) => {
    const attributed = profile.audience[field];
    if (attributed.value === null) return [];
    return [
      {
        label,
        value: attributed.value,
        tone: toneFor(attributed.confidence),
        note: confidenceNote(attributed.confidence, attributed.sources),
        sources: attributed.sources,
      },
    ];
  });
}

export type CapabilityLine = {
  id: string;
  label: string;
  tone: ConfidenceTone;
  note: string;
};

/**
 * "What people can do" (CORE-1 §31).
 *
 * Only capabilities with support are listed, most certain first. A capability
 * Vibe merely suspects is still shown — hedged — because a founder recognising
 * "you can book a time" is the moment this screen exists for, and hiding an
 * uncertain one costs more than qualifying it.
 */
export function buildCapabilityLines(profile: ProductProfile): CapabilityLine[] {
  return profile.capabilities.map((capability) => ({
    id: capability.id,
    label: capabilityLabel(capability),
    tone: toneFor(capability.confidence),
    note: confidenceNote(capability.confidence, capability.sources),
  }));
}

export type JourneyLine = {
  id: string;
  label: string;
  /** What happens here, or what Vibe could not find. Always a sentence. */
  detail: string;
  tone: ConfidenceTone;
};

/**
 * "How the product appears to work".
 *
 * Every stage appears, including the empty ones, and this is the one list
 * where that is the point: "Vibe found no way to see what it costs" is the
 * single most useful line on the screen for a product with no pricing page —
 * stated as an observation about Vibe's search, never as a verdict.
 */
export function buildJourneyLines(profile: ProductProfile): JourneyLine[] {
  return profile.journey.map((stage) => {
    const label = JOURNEY_STAGE_LABELS[stage.id];

    if (stage.confidence === "not_found" || stage.confidence === "unclear") {
      return { id: stage.id, label, detail: "Vibe didn't find this.", tone: "unknown" as const };
    }

    const detail =
      stage.detail ??
      (stage.confidence === "confirmed"
        ? "Vibe saw this on your live product."
        : "Your code has this, but Vibe hasn't seen it live.");

    return { id: stage.id, label, detail, tone: toneFor(stage.confidence) };
  });
}

export type BusinessSignalLine = {
  id: string;
  statement: string;
  tone: ConfidenceTone;
};

/**
 * Observations, never verdicts (CORE-1 §10, §42).
 *
 * The statements come straight from the domain, which phrases them with their
 * own uncertainty. Nothing here re-words them into a judgement, and there is
 * deliberately no score, grade, or count of "gaps" — that is the Business
 * Audit's screen, one step later in the product.
 */
export function buildBusinessSignalLines(profile: ProductProfile): BusinessSignalLine[] {
  return profile.businessSignals.map((signal) => ({
    id: signal.id,
    statement: signal.statement,
    tone: toneFor(signal.confidence),
  }));
}

// ---------------------------------------------------------------------
// Brand
// ---------------------------------------------------------------------

export type BrandView = {
  /** The asset to reveal, or null for a neutral mark (CORE-1 §29). */
  logo: { url: string; alt: string } | null;
  /** Why no logo is shown, when none is. */
  logoNote: string | null;
  colors: { value: string; role: string; tone: ConfidenceTone }[];
  typefaces: { family: string; role: string; tone: ConfidenceTone }[];
  tone: string | null;
  phrases: string[];
  /** True when there is nothing at all to show. */
  empty: boolean;
};

const COLOR_ROLE_LABELS: Record<BrandColor["role"], string> = {
  primary: "Primary",
  secondary: "Secondary",
  accent: "Accent",
  background: "Background",
  foreground: "Text",
};

const TYPEFACE_ROLE_LABELS: Record<BrandTypeface["role"], string> = {
  display: "Headlines",
  body: "Body",
  mono: "Code",
};

/**
 * Picks the asset worth revealing.
 *
 * A logo beats an alternate beats an app icon beats a favicon, and only a
 * `displayUrl` qualifies at all — a reference Vibe cannot render is not a
 * reveal, it is a broken image (CORE-1 §29).
 */
export function selectLogo(assets: BrandAsset[]): BrandAsset | null {
  const order: BrandAsset["role"][] = ["logo", "logo_alternate", "app_icon", "favicon"];
  for (const role of order) {
    const match = assets.find(
      (asset) => asset.role === role && asset.displayUrl !== null && asset.confidence !== "unclear",
    );
    if (match) return match;
  }
  return null;
}

export function buildBrandView(profile: ProductProfile): BrandView {
  const { brand } = profile;
  const logoAsset = selectLogo(brand.assets);
  const productName = profile.identity.name.value;

  const colors = brand.colors.map((color) => ({
    value: color.value,
    role: COLOR_ROLE_LABELS[color.role],
    tone: toneFor(color.confidence),
  }));

  const typefaces = brand.typefaces.map((typeface) => ({
    family: typeface.family,
    role: TYPEFACE_ROLE_LABELS[typeface.role],
    tone: toneFor(typeface.confidence),
  }));

  const hasUnrenderableAsset = brand.assets.length > 0 && logoAsset === null;

  return {
    logo: logoAsset
      ? {
          url: logoAsset.displayUrl!,
          // Never "logo": the alt text stands in for the image, so it says
          // what the image is of.
          alt: productName ? `${productName} logo` : "Product logo",
        }
      : null,
    logoNote: logoAsset
      ? null
      : hasUnrenderableAsset
        ? "Vibe found a logo in your project but can't show it from here yet."
        : "Vibe didn't find a logo it was sure about.",
    colors,
    typefaces,
    tone: brand.voice.tone.value,
    phrases: brand.voice.recurringPhrases,
    empty:
      logoAsset === null &&
      colors.length === 0 &&
      typefaces.length === 0 &&
      brand.voice.recurringPhrases.length === 0,
  };
}

// ---------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------

export type SourceLine = { label: string; used: boolean };

/**
 * "What Vibe used" (CORE-1 §34).
 *
 * Product words, never module names. A user should never read "Live Product
 * Intelligence v1" here; those names still exist, on the evidence screens the
 * disclosure links to.
 */
export function buildSourceLines(profile: ProductProfile): SourceLine[] {
  return profile.sources.map((source) => ({ label: source.note, used: source.used }));
}

// ---------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------

export type UnderstandingView = {
  headline: UnderstandingHeadline;
  audience: UnderstandingFact[];
  capabilities: CapabilityLine[];
  journey: JourneyLine[];
  businessSignals: BusinessSignalLine[];
  brand: BrandView;
  sources: SourceLine[];
  limitations: string[];
  /** The technical facts, kept for the secondary disclosure (CORE-1 §15). */
  technical: { label: string; value: string }[];
};

export function buildUnderstandingView(
  profile: ProductProfile,
  synthesized: boolean,
): UnderstandingView {
  const technicalRows: { label: string; value: string | null }[] = [
    { label: "Framework", value: profile.technical.framework },
    { label: "Languages", value: profile.technical.languages.join(", ") || null },
    { label: "Database", value: profile.technical.database },
    { label: "Accounts", value: profile.technical.authProvider },
    { label: "Payments", value: profile.technical.paymentProvider },
    { label: "Analytics", value: profile.technical.analyticsProvider },
    { label: "Hosting", value: profile.technical.deployment },
    { label: "Tests", value: profile.technical.hasTestInfrastructure ? "Present" : null },
  ];

  return {
    headline: buildHeadline(profile, synthesized),
    audience: buildAudienceFacts(profile),
    capabilities: buildCapabilityLines(profile),
    journey: buildJourneyLines(profile),
    businessSignals: buildBusinessSignalLines(profile),
    brand: buildBrandView(profile),
    sources: buildSourceLines(profile),
    limitations: profile.limitations,
    technical: technicalRows.flatMap((row) =>
      row.value === null ? [] : [{ label: row.label, value: row.value }],
    ),
  };
}

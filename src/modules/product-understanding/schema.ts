/**
 * The Product Profile (CORE-1 §5–§17).
 *
 * ## What this is
 *
 * The scanners answer *"what did Vibe observe?"*. The Business Audit answers
 * *"what does this mean for the business?"*. This sits between them and
 * answers the question neither of them does: **"what is this product?"**
 *
 * It is deliberately a persisted, versioned document rather than a view model.
 * Everything downstream — the audit, next moves, content, positioning, and
 * eventually product memory — needs a single answer to that question, and a
 * shape that only exists while a page renders cannot be that answer.
 *
 * ## Two rules the whole schema is built around
 *
 * **1. Every claim carries its provenance.** There is no bare string anywhere
 * in the profile. `Attributed<T>` pairs a value with how sure we are and where
 * it came from, because "this product is for restaurant owners" means something
 * completely different when the founder typed it than when a model inferred it
 * from a landing page.
 *
 * **2. Absence is a first-class value.** `not_found` means Vibe looked in the
 * sources it had and saw nothing. It never means the thing does not exist, and
 * it is never rendered as a deficiency (CORE-1 §17, §42). A profile that
 * honestly reports what it could not establish is worth more than one that
 * guesses, because the user is about to be asked whether Vibe got it right.
 *
 * Nothing here is Vibe-Business-specific. A webshop, a booking tool, a
 * portfolio and a marketplace all have to fit (CORE-1 §44).
 */

export const PRODUCT_PROFILE_SCHEMA_VERSION = "product-profile.v1" as const;

/**
 * Bumped when the *derivation* changes materially — new capability rules, a
 * different brand resolution, changed journey semantics. Persisted with every
 * profile so a stored one always says which logic produced it, and so reuse
 * invalidates when that logic moves.
 */
export const PROFILE_BUILDER_VERSION = "product-understanding-v1" as const;

// ---------------------------------------------------------------------
// Provenance and confidence
// ---------------------------------------------------------------------

/**
 * Where a claim came from, in descending authority (CORE-1 §25).
 *
 * The order is the point. A founder saying "my product is for restaurant
 * owners" outranks a model's reading of their homepage, permanently — a later
 * scan must never quietly replace it with "freelancers" because a hero
 * headline changed.
 */
export const SOURCE_PRIORITY = [
  "user_confirmed",
  "repository",
  "live_product",
  "deep_scan",
  "ai_inferred",
] as const;

export type EvidenceSource = (typeof SOURCE_PRIORITY)[number];

/**
 * How sure Vibe is, in four steps (CORE-1 §17).
 *
 *  - `confirmed`  — the user said so, or a source states it directly.
 *  - `likely`     — several signals agree, none of them conclusive.
 *  - `unclear`    — there is something, but not enough to claim.
 *  - `not_found`  — nothing in the sources Vibe read. **Not** "does not exist".
 */
export const CONFIDENCE_LEVELS = ["confirmed", "likely", "unclear", "not_found"] as const;

export type ProfileConfidence = (typeof CONFIDENCE_LEVELS)[number];

/**
 * One claim, with everything needed to defend it.
 *
 * `value` is null exactly when the confidence is `not_found` or `unclear` — a
 * value with nothing behind it is the failure mode this type exists to make
 * unrepresentable in practice (enforced by `validate.ts`, not by the type).
 *
 * `evidence` holds evidence-pack ids, which is what makes a claim checkable
 * rather than merely attributed: a "Why?" disclosure can resolve each id back
 * to the deterministic fact it names.
 */
export type Attributed<T> = {
  value: T | null;
  confidence: ProfileConfidence;
  sources: EvidenceSource[];
  evidence: string[];
};

export function unknown<T>(sources: EvidenceSource[] = []): Attributed<T> {
  return { value: null, confidence: "not_found", sources, evidence: [] };
}

// ---------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------

/**
 * Broad product categories (CORE-1 §6, §44).
 *
 * A closed vocabulary so the field is groupable and comparable, and wide
 * enough that a customer product is not forced into "SaaS" because that is
 * what Vibe Business happens to be.
 */
export const PRODUCT_CATEGORIES = [
  "saas_application",
  "web_app",
  "ecommerce_store",
  "marketplace",
  "content_site",
  "documentation_site",
  "booking_tool",
  "internal_tool",
  "portfolio_or_personal_site",
  "landing_page",
  "developer_tool",
  "mobile_app_companion",
  "other",
] as const;

export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

export type ProductIdentity = {
  name: Attributed<string>;
  /** One sentence. What the product is, in the words a founder would use. */
  shortDescription: Attributed<string>;
  /** Two or three sentences. The "Vibe understands your product" paragraph. */
  understanding: Attributed<string>;
  category: Attributed<ProductCategory>;
  /** The job the product exists to do. */
  mainPurpose: Attributed<string>;
  /** The value it promises — positioning, not a feature list. */
  mainPromise: Attributed<string>;
};

// ---------------------------------------------------------------------
// Audience
// ---------------------------------------------------------------------

export type ProductAudience = {
  primaryAudience: Attributed<string>;
  /** e.g. "solo founders", "operations teams". Narrower than the audience. */
  userType: Attributed<string>;
  problemSolved: Attributed<string>;
  useCase: Attributed<string>;
};

// ---------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------

/**
 * What a person can *do* with the product (CORE-1 §8).
 *
 * Deliberately not "which components exist". A closed, product-shaped
 * vocabulary that spans a webshop, a booking tool, a content site and a SaaS
 * app — because the model must not be able to invent a feature, and a free
 * string would let it (CORE-1 §20).
 */
export const CAPABILITY_IDS = [
  "create_account",
  "sign_in",
  "browse_catalog",
  "search",
  "read_content",
  "purchase",
  "subscribe",
  "book_appointment",
  "use_dashboard",
  "create_or_upload_content",
  "connect_integration",
  "export_or_download",
  "collaborate_or_invite",
  "manage_settings",
  "contact_team",
  "get_support",
] as const;

export type CapabilityId = (typeof CAPABILITY_IDS)[number];

export const CAPABILITY_LABELS: Record<CapabilityId, string> = {
  create_account: "Create an account",
  sign_in: "Sign in",
  browse_catalog: "Browse what's on offer",
  search: "Search",
  read_content: "Read articles or documentation",
  purchase: "Buy something",
  subscribe: "Subscribe to a plan",
  book_appointment: "Book a time or place",
  use_dashboard: "Use a signed-in workspace",
  create_or_upload_content: "Create or upload something",
  connect_integration: "Connect an outside service",
  export_or_download: "Export or download their data",
  collaborate_or_invite: "Bring other people in",
  manage_settings: "Manage their settings",
  contact_team: "Get in touch with the team",
  get_support: "Find help",
};

export type ProductCapability = {
  id: CapabilityId;
  /** Human label. Defaults to `CAPABILITY_LABELS`, refinable by the user. */
  label: string;
  confidence: ProfileConfidence;
  sources: EvidenceSource[];
  evidence: string[];
};

// ---------------------------------------------------------------------
// Customer journey
// ---------------------------------------------------------------------

/**
 * The path from arrival to value (CORE-1 §9).
 *
 * A fixed set of stages rather than a graph. The question this answers is
 * "what can a visitor do from arrival to value?", and a handful of named
 * stages answers it; a journey engine would be a different sprint.
 */
export const JOURNEY_STAGES = [
  "entry_point",
  "sign_up",
  "login",
  "onboarding",
  "primary_action",
  "pricing",
  "checkout",
  "signed_in_experience",
] as const;

export type JourneyStageId = (typeof JOURNEY_STAGES)[number];

export const JOURNEY_STAGE_LABELS: Record<JourneyStageId, string> = {
  entry_point: "Arriving",
  sign_up: "Signing up",
  login: "Signing in",
  onboarding: "Getting started",
  primary_action: "Doing the main thing",
  pricing: "Seeing what it costs",
  checkout: "Paying",
  signed_in_experience: "Using it",
};

export type JourneyStage = {
  id: JourneyStageId;
  /** One short sentence about what happens here. Null when nothing was found. */
  detail: string | null;
  confidence: ProfileConfidence;
  sources: EvidenceSource[];
  evidence: string[];
};

// ---------------------------------------------------------------------
// Business signals
// ---------------------------------------------------------------------

/**
 * Observations relevant to the business, with no verdict attached
 * (CORE-1 §10).
 *
 * The line this type exists to hold: *"Subscription pricing appears to
 * exist"* belongs here; *"monetisation is weak"* belongs to the Business
 * Audit. Nothing in this module is allowed to cross it.
 */
export const BUSINESS_SIGNAL_IDS = [
  "pricing_surface",
  "payment_capability",
  "subscription_capability",
  "analytics",
  "conversion_path",
  "acquisition_surface",
  "retention_capability",
  "account_system",
] as const;

export type BusinessSignalId = (typeof BUSINESS_SIGNAL_IDS)[number];

export type BusinessSignal = {
  id: BusinessSignalId;
  /** A statement of fact, phrased with its own uncertainty (CORE-1 §42). */
  statement: string;
  confidence: ProfileConfidence;
  sources: EvidenceSource[];
  evidence: string[];
};

// ---------------------------------------------------------------------
// Brand
// ---------------------------------------------------------------------

export type BrandAssetRole = "logo" | "logo_alternate" | "favicon" | "app_icon" | "open_graph_image";

/**
 * A brand asset Vibe believes belongs to the product.
 *
 * `displayUrl` is set only when the asset can actually be shown: an absolute
 * URL on the live origin, or a path under the repository's web root that the
 * live site also serves. Everything else keeps `null`, and the UI shows a
 * neutral mark rather than a broken image (CORE-1 §29).
 */
export type BrandAsset = {
  role: BrandAssetRole;
  /** Where it lives — a repository path or an origin-relative live path. */
  reference: string;
  displayUrl: string | null;
  confidence: ProfileConfidence;
  sources: EvidenceSource[];
  evidence: string[];
};

export type BrandColorRole = "primary" | "secondary" | "accent" | "background" | "foreground";

export type BrandColor = {
  role: BrandColorRole;
  /** Lowercase six-digit hex. */
  value: string;
  confidence: ProfileConfidence;
  sources: EvidenceSource[];
  evidence: string[];
};

export type BrandTypeface = {
  role: "display" | "body" | "mono";
  family: string;
  confidence: ProfileConfidence;
  sources: EvidenceSource[];
  evidence: string[];
};

/**
 * How the product talks (CORE-1 §14).
 *
 * Small and defensible on purpose: a tone word, the promise the site repeats,
 * and the phrases it actually uses. No brand psychology, no archetypes —
 * nothing that cannot be traced back to copy Vibe read.
 */
export type BrandVoice = {
  tone: Attributed<string>;
  positioningLine: Attributed<string>;
  /** Short phrases the product repeats about itself. Untrusted third-party text. */
  recurringPhrases: string[];
};

export type BrandProfile = {
  assets: BrandAsset[];
  colors: BrandColor[];
  typefaces: BrandTypeface[];
  voice: BrandVoice;
};

// ---------------------------------------------------------------------
// Technical profile
// ---------------------------------------------------------------------

/**
 * Facts about how it is built (CORE-1 §15).
 *
 * Part of the profile because downstream work needs it, but secondary in the
 * UI: a founder looking at "Vibe understands your product" does not want to
 * read a dependency list first.
 */
export type TechnicalProfile = {
  framework: string | null;
  languages: string[];
  database: string | null;
  authProvider: string | null;
  paymentProvider: string | null;
  analyticsProvider: string | null;
  deployment: string | null;
  integrations: string[];
  hasTestInfrastructure: boolean;
};

// ---------------------------------------------------------------------
// Sources and completeness
// ---------------------------------------------------------------------

/** Whether an evidence source contributed, and why not when it did not. */
export type SourceStatus = {
  source: Exclude<EvidenceSource, "ai_inferred" | "user_confirmed">;
  used: boolean;
  /** Short, human-readable. Shown to the user (CORE-1 §34, §43). */
  note: string;
};

/**
 * `partial` is the normal state, not a failure: most products have no Deep
 * Scan, and plenty have no reachable public site yet (CORE-1 §43).
 */
export type ProfileCompleteness = "complete" | "partial";

// ---------------------------------------------------------------------
// The profile
// ---------------------------------------------------------------------

export type ProductProfile = {
  schemaVersion: typeof PRODUCT_PROFILE_SCHEMA_VERSION;
  builderVersion: string;
  /** Set when a model contributed; null when the profile is fully deterministic. */
  promptVersion: string | null;
  provider: string | null;
  model: string | null;

  identity: ProductIdentity;
  audience: ProductAudience;
  capabilities: ProductCapability[];
  journey: JourneyStage[];
  businessSignals: BusinessSignal[];
  brand: BrandProfile;
  technical: TechnicalProfile;

  sources: SourceStatus[];
  completeness: ProfileCompleteness;
  /** Notes about what limited this profile. Never phrased as the user's fault. */
  limitations: string[];
  generatedAt: string;
};

/** Fields the user may correct directly (CORE-1 §24). */
export const EDITABLE_FIELDS = [
  "name",
  "shortDescription",
  "understanding",
  "mainPurpose",
  "mainPromise",
  "primaryAudience",
  "problemSolved",
] as const;

export type EditableField = (typeof EDITABLE_FIELDS)[number];

/**
 * A user's corrections, stored separately from the derived profile.
 *
 * Separate on purpose: a re-scan replaces the derived half wholesale, and the
 * only way a correction can survive that is by not living inside it
 * (CORE-1 §25). An absent key means "not corrected", which is different from
 * a key set to an empty string.
 */
export type ProfileCorrections = Partial<Record<EditableField, string>>;

export const MAX_CORRECTION_LENGTH = 600;

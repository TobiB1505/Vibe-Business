/**
 * Detecting a real metadata gap (Sprint 13A.1 §3, §4, §6, §9).
 *
 * ## The lesson this module is built on
 *
 * Sprint 8 reported `robots.txt` as present because a *parser* in the codebase
 * contained the string. The audit believed it, the Opportunity Engine produced
 * confident wrong advice, and nothing downstream could tell.
 *
 * Metadata is the same trap with more surface: `openGraph`, `title` and
 * `description` appear in type definitions, test fixtures, documentation,
 * helper functions and dead code. None of those put a single tag on a page.
 *
 * So the rule is inverted from the obvious one. Evidence of *presence* must
 * come from a framework-served location — the App Router's own `metadata`
 * export in a layout or page — and everything else is not evidence at all. When
 * the architecture is not one this capability understands, the answer is
 * `unsupported`, never a best guess.
 */

/** Fields v1 owns. Deliberately small (§4). */
export const OWNED_METADATA_FIELDS = [
  "title",
  "description",
  "og:title",
  "og:description",
  "og:type",
  "og:url",
  "og:siteName",
] as const;
export type OwnedMetadataField = (typeof OWNED_METADATA_FIELDS)[number];

/**
 * What the framework actually serves, as read from the metadata export.
 *
 * Deliberately not a parse of the whole file: the question is only which of the
 * owned fields are already defined, because those are the ones this capability
 * must not touch.
 */
export type ObservedMetadata = {
  title: string | null;
  description: string | null;
  /** Any `openGraph` key already present, owned or not. */
  openGraphKeys: string[];
  /** Metadata this capability does not own, e.g. `twitter`. Never touched. */
  unownedKeys: string[];
};

export const METADATA_READINESS = [
  "ready",
  "needs_user_input",
  "not_applicable",
  "unsupported",
] as const;
export type MetadataReadiness = (typeof METADATA_READINESS)[number];

export type MetadataAssessment = {
  readiness: MetadataReadiness;
  /** Owned fields that are absent and could be filled from trusted sources. */
  missing: OwnedMetadataField[];
  /** Why, in terms a user can act on. */
  reason: string;
};

/**
 * Where the metadata export lives, and whether v1 can reason about it.
 *
 * `custom_factory` is the honest answer for a project that builds its metadata
 * through `generateMetadata()` or a helper: it is a perfectly good pattern, and
 * a capability that cannot read it must not edit it (§3, state F).
 */
export type MetadataSource =
  | { kind: "static_export"; filePath: string; observed: ObservedMetadata }
  | { kind: "custom_factory"; filePath: string }
  | { kind: "absent" };

/**
 * Trusted values that may populate the owned fields (§6).
 *
 * Precedence is expressed by the order the resolver reads them, and the rule is
 * that **existing active metadata always wins**: a title already served by the
 * framework is the customer's decision, and rewriting it to something Vibe
 * prefers would be editing their product's voice under the guise of a fix.
 */
export type TrustedContent = {
  /** From the framework-served metadata itself. Highest precedence. */
  existingTitle: string | null;
  existingDescription: string | null;
  /** From the project's structured business context. */
  contextProductName: string | null;
  contextOneLiner: string | null;
  /** The project's verified public origin, for `og:url`. */
  productionOrigin: string | null;
};

/** The exact values a preparation would write. Never invented (§6). */
export type ResolvedMetadataValues = {
  title: string;
  description: string;
  ogUrl: string | null;
  siteName: string | null;
};

/**
 * Resolves the values to write, or reports that they cannot be resolved.
 *
 * No AI, and no fallback copy. If neither an existing metadata field nor the
 * business context can supply a truthful title or description, the answer is
 * `needs_user_input` — writing "The best platform for teams" because something
 * had to go there is the failure this whole capability is shaped to avoid.
 */
export function resolveMetadataValues(
  trusted: TrustedContent,
): { ok: true; values: ResolvedMetadataValues } | { ok: false; missing: OwnedMetadataField[] } {
  const title = trusted.existingTitle ?? trusted.contextProductName;
  const description = trusted.existingDescription ?? trusted.contextOneLiner;

  const missing: OwnedMetadataField[] = [];
  if (!title?.trim()) missing.push("title");
  if (!description?.trim()) missing.push("description");
  if (missing.length > 0) return { ok: false, missing };

  return {
    ok: true,
    values: {
      title: title!.trim(),
      description: description!.trim(),
      // Only when the project has a verified public origin. A guessed URL in
      // `og:url` points shared links at the wrong place.
      ogUrl: trusted.productionOrigin?.trim() || null,
      // The product name is a fact the customer supplied; it is not a claim.
      siteName: (trusted.existingTitle ?? trusted.contextProductName)?.trim() || null,
    },
  };
}

/** The owned Open Graph fields absent from what the framework serves. */
function missingOpenGraph(observed: ObservedMetadata): OwnedMetadataField[] {
  const present = new Set(observed.openGraphKeys.map((key) => key.toLowerCase()));
  const wanted: OwnedMetadataField[] = ["og:title", "og:description", "og:type"];

  return wanted.filter((field) => !present.has(field.slice(3).toLowerCase()));
}

/**
 * Decides whether this capability applies, and says why (§3, §9).
 *
 * Every branch is a refusal or a readiness with a sentence attached, because a
 * capability that says only "not applicable" gives a user nothing to act on.
 */
export function assessMetadata(
  source: MetadataSource,
  trusted: TrustedContent,
): MetadataAssessment {
  if (source.kind === "absent") {
    // No framework-served metadata export at all. That is a bigger change than
    // v1 owns — creating one means deciding where it lives in someone else's
    // layout, which is a structural edit rather than a gap fill.
    return {
      readiness: "unsupported",
      missing: [],
      reason: "This project has no App Router metadata export that Vibe can extend.",
    };
  }

  if (source.kind === "custom_factory") {
    // A `generateMetadata()` function is a good pattern and an unreadable one
    // for a deterministic editor. Editing it blind could silently override
    // values computed at request time.
    return {
      readiness: "unsupported",
      missing: [],
      reason: "This project builds its metadata dynamically, which Vibe does not edit.",
    };
  }

  const missing = missingOpenGraph(source.observed);
  const resolved = resolveMetadataValues(trusted);

  if (!resolved.ok) {
    return {
      readiness: "needs_user_input",
      missing: resolved.missing,
      reason: "Vibe needs a product title and description it can trust before adding metadata.",
    };
  }

  if (missing.length === 0) {
    return {
      readiness: "not_applicable",
      missing: [],
      reason: "This page already provides the metadata Vibe would add.",
    };
  }

  return {
    readiness: "ready",
    missing,
    reason: "The homepage is missing social metadata that Vibe can add from existing information.",
  };
}

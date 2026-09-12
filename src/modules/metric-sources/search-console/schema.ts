/**
 * The Search Console metric source domain (Sprint 12C §8, §9, §23, §39).
 *
 * ## What this connector is, and is not
 *
 * It is a **read-only** window onto one Search Console property, for one
 * project, so the Sprint 12B measurement engine can ask "how many search
 * impressions did this site get on each of these days?".
 *
 * It is not an SEO tool. It cannot add a property, verify ownership, submit a
 * sitemap, inspect a URL, or read query and page breakdowns. Those are absent
 * by construction rather than by policy — there is no code that could perform
 * them, and the requested OAuth scope would not permit them if there were.
 */

/**
 * The OAuth scope Vibe requests, and the entire authority it obtains.
 *
 * Verified against Google's current `sites.list` documentation, which lists
 * both `webmasters.readonly` and the read-write `webmasters`. The read-only
 * scope is sufficient for everything this connector does, so requesting the
 * other would be asking a customer for authority to modify their Search Console
 * in exchange for reading a number (§3, CLAUDE.md rule 22).
 */
export const SEARCH_CONSOLE_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly" as const;

/**
 * The adapter's versioned query identity (§39).
 *
 * Names what "a search_impressions reading" *means*: property-level, daily,
 * finalized, no dimensional filters. Changing any of those changes what a
 * stored historical measurement was, so it changes this string too — the same
 * discipline `sandbox-policy-v5` and `review-policy-v1` follow.
 */
export const SEARCH_CONSOLE_ADAPTER = "search-console-v1" as const;

/**
 * Connection lifecycle (§8).
 *
 * The distinction that matters is between `authorized` and `connected`. Google
 * saying yes is not a usable connection: without a property selected there is
 * nothing to query, and treating OAuth success as "connected" is how a product
 * ends up reporting a metric for somebody else's website.
 */
export const CONNECTION_STATUSES = [
  "not_connected",
  /** An OAuth transaction is open. No credential exists yet. */
  "authorizing",
  /** Google authorized us, but no property is bound to this project yet. */
  "property_selection_required",
  /** Authorized *and* bound to one property. The only usable state. */
  "connected",
  /** The credential stopped working. History is kept; new reads are refused. */
  "reconnect_required",
  /** Deliberately ended by the user. Credential destroyed, history kept (§25). */
  "disconnected",
  "failed",
] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

/** The only status from which a metric read may be attempted. */
export function isUsableConnection(status: ConnectionStatus): boolean {
  return status === "connected";
}

/**
 * Search Console property kinds (§9).
 *
 * Confirmed against Google's `sites` resource documentation: `siteUrl` is
 * either a URL-prefix property (`https://www.example.com/`) or a domain
 * property (`sc-domain:example.com`). They are not interchangeable — a domain
 * property covers every subdomain and protocol, a URL-prefix property covers
 * exactly one prefix — and the difference decides which one legitimately
 * measures a given project.
 */
export const PROPERTY_TYPES = ["url_prefix", "domain"] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

/**
 * Permission levels, exactly as Google's `sites` resource enumerates them.
 *
 * `siteUnverifiedUser` is listed here because Google returns it, not because it
 * is useful: an unverified user cannot read Search Analytics, so offering one
 * as a measurement source would produce a connection that authorizes fine and
 * then fails on every read.
 */
export const PERMISSION_LEVELS = [
  "siteOwner",
  "siteFullUser",
  "siteRestrictedUser",
  "siteUnverifiedUser",
] as const;
export type PermissionLevel = (typeof PERMISSION_LEVELS)[number];

/** Whether a permission level can actually read Search Analytics. */
export function canReadSearchAnalytics(level: PermissionLevel): boolean {
  return level !== "siteUnverifiedUser";
}

/**
 * One property the authorized Google account can see.
 *
 * `siteUrl` is kept verbatim and treated as **opaque authority** (§9): it is
 * what gets sent back to Google, and reconstructing it from a parsed host would
 * eventually send a subtly different string than the one that was authorized.
 */
export type PropertyCandidate = {
  /** Google's own identifier. Opaque; never rebuilt from parts. */
  siteUrl: string;
  type: PropertyType;
  permissionLevel: PermissionLevel;
  /** Human-facing form, derived for display only. Never sent to Google. */
  displayName: string;
};

/**
 * How well a candidate matches the project's own production origin (§10).
 *
 * Ordered by confidence. The gap between `exact_url_prefix` and
 * `covering_domain` is deliberate: both are correct answers, and when both
 * exist the product must ask rather than choose.
 */
export const MATCH_STRENGTHS = ["exact_url_prefix", "covering_domain", "related", "none"] as const;
export type MatchStrength = (typeof MATCH_STRENGTHS)[number];

export type RankedProperty = PropertyCandidate & {
  match: MatchStrength;
  /** Whether this one may be selected without asking. Never more than one. */
  recommended: boolean;
};

/**
 * Why a connector operation failed (§23).
 *
 * Richer than the Sprint 12B `MetricSourceFailure` union on purpose. These
 * describe the *connection*, and each implies a different next step for a
 * human: reconnect, wait, fix access, or nothing at all. The adapter maps them
 * down to the port's four when answering the measurement engine, because the
 * engine's job is to decide what a measurement means, not to explain OAuth.
 */
export const SOURCE_FAILURE_CODES = [
  /** No credential, or Google rejected it outright. */
  "unauthorized",
  /** The refresh token no longer works. The user must reconnect (§24). */
  "refresh_failed",
  /** The account lost access to the bound property. */
  "property_access_revoked",
  /** Quota or load limit. Explicitly **not** a measurement result (§23). */
  "quota_limited",
  "provider_unavailable",
  /** Vibe asked for something malformed. A defect, not a user situation. */
  "invalid_request",
  /** The provider answered, but not with numbers we can trust (§20). */
  "provider_data_invalid",
] as const;
export type SourceFailureCode = (typeof SOURCE_FAILURE_CODES)[number];

/**
 * Whether a failure means the stored credential is finished.
 *
 * The only failures that should move a connection to `reconnect_required`.
 * Quota and availability are temporary and must never cost a user their
 * connection — a connector that disconnected itself every time Google was busy
 * would be worse than one that simply waited.
 */
export function requiresReconnect(code: SourceFailureCode): boolean {
  return code === "refresh_failed" || code === "unauthorized" || code === "property_access_revoked";
}

/**
 * A day of provider data, after normalization (§18, §20).
 *
 * `pending` is the point of this type. Search Console finalizes data on a lag,
 * so a day inside a requested window can legitimately have no row yet — and
 * that is *not* a day with zero impressions. Conflating them would let a
 * measurement compare a complete baseline against a half-finalized window and
 * call the difference a business outcome.
 */
export type NormalizedDay =
  | { day: string; state: "final"; impressions: number }
  | { day: string; state: "pending" };

/** What a window's worth of provider data amounts to (§19). */
export type WindowCompleteness = {
  /** Whole days the business window asked for. */
  expectedDays: number;
  /** Days the provider returned finalized numbers for. */
  finalizedDays: number;
  /** Days inside the window with no finalized row yet. */
  pendingDays: number;
  complete: boolean;
};

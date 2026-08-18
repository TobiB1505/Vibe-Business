import {
  canReadSearchAnalytics,
  type MatchStrength,
  type PermissionLevel,
  type PropertyCandidate,
  type PropertyType,
  type RankedProperty,
} from "./schema";

/**
 * Turning Google's property list into a choice a human can make (§9, §10, §11).
 *
 * ## The failure this module exists to prevent
 *
 * Silently picking the first property. A Google account routinely has several —
 * an old URL-prefix property, a domain property, a staging site, a client's
 * site — and reading the wrong one produces a measurement that is entirely
 * plausible and about somebody else's website. Nothing downstream could ever
 * detect it: the numbers are real, the dates are right, the classification is
 * sound, and the conclusion is nonsense.
 *
 * So the rule is: recommend only when there is exactly one defensible answer,
 * and otherwise ask.
 */

const DOMAIN_PREFIX = "sc-domain:";

/**
 * Classifies a `siteUrl` exactly as Google's documentation defines it.
 *
 * The string is never rebuilt — only inspected. Whatever Google returned is
 * what gets sent back, because a normalized-and-reconstructed identifier
 * eventually differs from the authorized one in some trailing slash nobody
 * noticed.
 */
export function classifyProperty(siteUrl: string): PropertyType {
  return siteUrl.startsWith(DOMAIN_PREFIX) ? "domain" : "url_prefix";
}

/** The bare host a property covers, for comparison only. */
function propertyHost(siteUrl: string): string | null {
  if (siteUrl.startsWith(DOMAIN_PREFIX)) {
    const host = siteUrl.slice(DOMAIN_PREFIX.length).trim().toLowerCase();
    return host || null;
  }

  try {
    return new URL(siteUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** A friendlier label. Display only — never sent to Google (§27). */
export function displayNameFor(siteUrl: string): string {
  if (siteUrl.startsWith(DOMAIN_PREFIX)) return siteUrl.slice(DOMAIN_PREFIX.length);
  return siteUrl;
}

export function toCandidate(entry: {
  siteUrl: string;
  permissionLevel: PermissionLevel;
}): PropertyCandidate {
  return {
    siteUrl: entry.siteUrl,
    type: classifyProperty(entry.siteUrl),
    permissionLevel: entry.permissionLevel,
    displayName: displayNameFor(entry.siteUrl),
  };
}

/**
 * Whether a domain property covers a host.
 *
 * A Search Console domain property covers the domain *and its subdomains*, so
 * `sc-domain:example.com` legitimately covers `www.example.com`. The suffix
 * check is anchored on a dot so that `sc-domain:example.com` does not appear to
 * cover `notexample.com`.
 */
function domainCovers(domainHost: string, originHost: string): boolean {
  return originHost === domainHost || originHost.endsWith(`.${domainHost}`);
}

/**
 * Compares a candidate against the project's own verified production origin.
 *
 * The origin comes from trusted project state, never from a client — the same
 * rule the review artifact's "before" side follows, and for the same reason: a
 * caller who could name the origin could aim the matcher at any property they
 * happened to have access to.
 */
export function matchStrength(candidate: PropertyCandidate, productionOrigin: string): MatchStrength {
  let origin: URL;
  try {
    origin = new URL(productionOrigin);
  } catch {
    return "none";
  }

  const originHost = origin.hostname.toLowerCase();
  const host = propertyHost(candidate.siteUrl);
  if (!host) return "none";

  if (candidate.type === "url_prefix") {
    let candidateOrigin: URL;
    try {
      candidateOrigin = new URL(candidate.siteUrl);
    } catch {
      return "none";
    }

    // Same host *and* same scheme. A URL-prefix property is protocol-specific,
    // so an `http://` property does not measure an `https://` site — and
    // treating them as equivalent would silently read a property that has no
    // traffic.
    if (candidateOrigin.hostname.toLowerCase() === originHost) {
      return candidateOrigin.protocol === origin.protocol ? "exact_url_prefix" : "related";
    }
    return host.endsWith(`.${originHost}`) || originHost.endsWith(`.${host}`) ? "related" : "none";
  }

  if (domainCovers(host, originHost)) return "covering_domain";
  return "none";
}

/**
 * Ranks the authorized properties and decides whether one may be auto-selected.
 *
 * ## The auto-selection rule
 *
 * Exactly one candidate is recommended, and only when it is the **sole**
 * property at the strongest match level present, that level is a real match,
 * and it can actually read Search Analytics.
 *
 * Two properties at the same strength is the ambiguous case §10 forbids
 * resolving: a domain property and a URL-prefix property for the same site are
 * both correct answers to "which one measures this?", and they return different
 * numbers. Guessing there is how a measurement becomes confidently wrong.
 */
export function rankProperties(
  candidates: PropertyCandidate[],
  productionOrigin: string | null,
): RankedProperty[] {
  const order: MatchStrength[] = ["exact_url_prefix", "covering_domain", "related", "none"];

  const ranked = candidates.map((candidate) => ({
    ...candidate,
    match: productionOrigin ? matchStrength(candidate, productionOrigin) : "none",
    recommended: false,
  })) as RankedProperty[];

  ranked.sort((left, right) => order.indexOf(left.match) - order.indexOf(right.match));

  // Only properties that can actually read Search Analytics may be
  // recommended. An unverified user authorizes cleanly and then fails on every
  // read, which would present as a broken product rather than a permissions
  // problem.
  const eligible = ranked.filter(
    (property) => property.match !== "none" && canReadSearchAnalytics(property.permissionLevel),
  );
  if (eligible.length === 0) return ranked;

  const strongest = eligible[0].match;
  const atStrongest = eligible.filter((property) => property.match === strongest);

  // `related` is never strong enough to choose on someone's behalf. It means
  // "this looks like it might be about the same site", which is exactly the
  // judgement a human should make.
  if (atStrongest.length === 1 && strongest !== "related") atStrongest[0].recommended = true;

  return ranked;
}

/**
 * Whether the client's chosen property is one the server actually discovered.
 *
 * The whole of §11 in one function. A client submits a property id; without
 * this check it could submit `sc-domain:some-other-company.com` and Vibe would
 * dutifully query it. Membership is tested against the candidate set the
 * *server* obtained from Google for *this* connection, not against anything
 * the request carried.
 */
export function isSelectableProperty(
  candidates: PropertyCandidate[],
  siteUrl: string,
): boolean {
  const candidate = candidates.find((entry) => entry.siteUrl === siteUrl);
  return candidate !== undefined && canReadSearchAnalytics(candidate.permissionLevel);
}

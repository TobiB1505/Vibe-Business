import { USER_AGENT } from "./net/safe-fetch";

/**
 * robots.txt parsing (Sprint 3 §10).
 *
 * Scope is deliberately narrow: which paths we may fetch, where the
 * sitemaps are, and how slowly to go. This is not an SEO audit — no
 * scoring, no advice, no opinion about the rules a site chose.
 *
 * The rules are honoured rather than merely recorded. Vibe Business
 * identifies itself with a real user agent, so it must behave like a
 * well-mannered crawler when a site says no.
 */

/** The token site owners would write to address our crawler specifically. */
export const ROBOTS_USER_AGENT_TOKEN = "vibebusinessbot";

export type RobotsRule = { type: "allow" | "disallow"; path: string };

export type RobotsPolicy = {
  exists: boolean;
  /** Rules from the most specific group that applies to us. */
  rules: RobotsRule[];
  sitemaps: string[];
  crawlDelaySeconds: number | null;
  /** True when our user agent is disallowed from the whole site. */
  blanketDisallow: boolean;
};

export const EMPTY_ROBOTS_POLICY: RobotsPolicy = {
  exists: false,
  rules: [],
  sitemaps: [],
  crawlDelaySeconds: null,
  blanketDisallow: false,
};

const MAX_RULES = 500;
const MAX_SITEMAPS = 10;

type Group = {
  agents: string[];
  rules: RobotsRule[];
  crawlDelaySeconds: number | null;
};

/**
 * Parses robots.txt into the group that applies to us.
 *
 * Per the de-facto standard, a crawler obeys the group naming it
 * specifically, and only falls back to `*` when no such group exists —
 * so a site that grants us an exception is not overridden by its own
 * stricter wildcard group.
 */
export function parseRobots(text: string): RobotsPolicy {
  const groups: Group[] = [];
  let current: Group | null = null;
  let expectingAgents = false;
  const sitemaps: string[] = [];

  for (const rawLine of text.split(/\r?\n/).slice(0, 5000)) {
    const line = rawLine.split("#")[0].trim();
    if (line === "") continue;

    const separator = line.indexOf(":");
    if (separator === -1) continue;

    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (field === "sitemap") {
      if (value !== "" && sitemaps.length < MAX_SITEMAPS) sitemaps.push(value);
      continue;
    }

    if (field === "user-agent") {
      // Consecutive User-agent lines share one group of rules.
      if (!expectingAgents || current === null) {
        current = { agents: [], rules: [], crawlDelaySeconds: null };
        groups.push(current);
        expectingAgents = true;
      }
      current.agents.push(value.toLowerCase());
      continue;
    }

    if (current === null) continue;
    expectingAgents = false;

    if (field === "disallow" || field === "allow") {
      if (current.rules.length < MAX_RULES) {
        current.rules.push({ type: field, path: value });
      }
      continue;
    }

    if (field === "crawl-delay") {
      const seconds = Number.parseFloat(value);
      if (Number.isFinite(seconds) && seconds >= 0) current.crawlDelaySeconds = seconds;
    }
  }

  const ourToken = ROBOTS_USER_AGENT_TOKEN;
  const specific = groups.filter((group) =>
    group.agents.some((agent) => agent !== "*" && (ourToken.includes(agent) || agent === ourToken)),
  );
  const wildcard = groups.filter((group) => group.agents.includes("*"));
  const applicable = specific.length > 0 ? specific : wildcard;

  const rules = applicable.flatMap((group) => group.rules);
  const crawlDelaySeconds =
    applicable.map((group) => group.crawlDelaySeconds).find((value) => value !== null) ?? null;

  // `Disallow: /` with no re-allowing rule means the whole site is closed to us.
  const blanketDisallow =
    rules.some((rule) => rule.type === "disallow" && rule.path === "/") &&
    !rules.some((rule) => rule.type === "allow" && (rule.path === "/" || rule.path === "/*"));

  return { exists: true, rules, sitemaps, crawlDelaySeconds, blanketDisallow };
}

/** Expands a robots path pattern (`*` wildcard, `$` anchor) into a matcher. */
function matchesRule(path: string, pattern: string): boolean {
  if (pattern === "") return false;

  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;

  const escaped = body
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join("[\\s\\S]*");

  try {
    return new RegExp(`^${escaped}${anchored ? "$" : ""}`).test(path);
  } catch {
    return false;
  }
}

/**
 * Standard longest-match-wins evaluation: the most specific rule decides,
 * and `Allow` beats `Disallow` at equal length.
 */
export function isPathAllowed(policy: RobotsPolicy, path: string): boolean {
  if (!policy.exists) return true;

  let best: { rule: RobotsRule; length: number } | null = null;
  for (const rule of policy.rules) {
    if (!matchesRule(path, rule.path)) continue;
    const length = rule.path.length;
    if (best === null || length > best.length || (length === best.length && rule.type === "allow")) {
      best = { rule, length };
    }
  }

  return best === null ? true : best.rule.type === "allow";
}

/** Exposed so tests and the crawler agree on the exact agent string in use. */
export function crawlerUserAgent(): string {
  return USER_AGENT;
}

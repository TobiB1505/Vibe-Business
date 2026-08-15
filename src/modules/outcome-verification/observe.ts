import { parseRobots } from "@/modules/live-product-intelligence/robots";
import { parseSitemap } from "@/modules/live-product-intelligence/sitemap";
import {
  safeFetch,
  type SafeFetchDependencies,
  type SafeFetchFailure,
} from "@/modules/live-product-intelligence/net/safe-fetch";
import { DEFAULT_OUTCOME_BUDGETS, type OutcomeBudgets } from "./budgets";
import { canonicalizeUrl, type CanonicalUrl } from "./canonical";
import {
  OUTCOME_RESOURCE_PATHS,
  type ExpectedOutcome,
  type OutcomeResource,
} from "./schema";

/**
 * Observing the public product (Sprint 12A §12, §13, §14, §15).
 *
 * ## Nothing here is a new HTTP client
 *
 * Every request goes through `safeFetch`, the single outbound door built for
 * live product intelligence and mandated by CLAUDE.md rule 35 and ADR 0010. That
 * buys, unchanged and untouched: scheme and credential policy, DNS resolution
 * with every returned address gated, connection pinned to the exact address that
 * passed (so there is no DNS-rebinding window), per-hop redirect revalidation,
 * timeout and byte budgets enforced while the body streams, and content-type
 * refusal before a byte is parsed.
 *
 * Re-implementing any of that here — even "just a small fetch for two files" —
 * would fork the SSRF boundary, and a forked security boundary is one that is
 * correct in one copy.
 *
 * ## This is not a crawl
 *
 * Two absolute paths on one origin, taken from the contract. No link is
 * followed, no sitemap entry is fetched, no sitemap index is walked, no
 * authenticated route is touched, no browser is opened and no JavaScript is
 * executed. The sitemap's contents are read as *data to compare against a fixed
 * expectation*, never as a list of things to go and get (CLAUDE.md rule 39).
 *
 * ## What comes back
 *
 * Derived facts only. The body is parsed inside this module and thrown away:
 * nothing above it ever sees HTML, XML, robots text or a URL list, so nothing
 * above it can persist one (§8, §14, §15, CLAUDE.md rule 37).
 */

/** One resource's outcome, reduced to facts small enough to store. */
export type ResourceObservation = {
  resource: OutcomeResource;
  /** The path requested, from the contract. Never from a fetched document. */
  requestedPath: string;
} & (
  | {
      reachable: true;
      httpStatus: number;
      contentType: string;
      bytes: number;
      truncated: boolean;
      redirects: number;
      /** The origin actually served, after every revalidated hop. */
      effectiveOrigin: string;
      /** Derived facts, by resource kind. Never the document itself. */
      facts: RobotsFacts | SitemapFacts;
    }
  | {
      reachable: false;
      /**
       * Typed reason, split into "the resource is not there" and "we could not
       * look" — the distinction §19 and §23 are built on.
       */
      kind: "absent" | "error";
      httpStatus: number | null;
      transportError: SafeFetchFailure;
    }
);

export type RobotsFacts = {
  kind: "robots";
  /** Sitemap URLs declared by robots.txt, canonicalized. Bounded by the parser. */
  declaredSitemaps: CanonicalUrl[];
};

export type SitemapFacts = {
  kind: "sitemap";
  /** True when the document announced itself as a urlset or a sitemapindex. */
  parsed: boolean;
  /** Canonicalized `<loc>` values, bounded by `maxSitemapUrls`. */
  urls: CanonicalUrl[];
  /** True when the URL budget cut the list short. */
  urlsTruncated: boolean;
};

export type Observation = {
  observedAt: Date;
  /** The origin actually served, once any resource resolved one. */
  effectiveOrigin: string | null;
  byResource: Map<OutcomeResource, ResourceObservation>;
};

/**
 * HTTP statuses that mean *the resource is not published*, as opposed to *we
 * could not look*.
 *
 * A 404 during the observation window is the expected shape of "production has
 * not updated yet", and classifying it as an error would turn every mid-deploy
 * poll into a Vibe fault (§19).
 */
function isAbsence(status: number | undefined): boolean {
  return status === 404 || status === 410;
}

function budgetFor(resource: OutcomeResource, budgets: OutcomeBudgets): number {
  return resource === "robots_txt" ? budgets.maxRobotsBytes : budgets.maxSitemapBytes;
}

/**
 * Fetches one contract resource and reduces it to facts.
 *
 * The redirect policy is `restrictToOrigin`-free on purpose but bounded: the
 * safe fetcher revalidates every hop against the same address policy, and the
 * origin it lands on is *recorded* rather than trusted. A check only accepts a
 * URL on the configured origin or on the observed one, so an origin we were
 * redirected to cannot smuggle in a match for somebody else's site (§16).
 */
async function observeResource(
  resource: OutcomeResource,
  publicOrigin: string,
  dependencies: SafeFetchDependencies,
  budgets: OutcomeBudgets,
): Promise<ResourceObservation> {
  const requestedPath = OUTCOME_RESOURCE_PATHS[resource];
  const target = `${publicOrigin}${requestedPath}`;

  const result = await safeFetch(
    target,
    {
      // robots.txt is text/plain; a sitemap is XML. Some hosts serve robots as
      // text/plain and Next.js's metadata route does too, but a
      // misconfigured host answering text/html is a real thing — and reading
      // an HTML error page as robots.txt would produce confident nonsense, so
      // the content type is a gate rather than a hint.
      accept: resource === "robots_txt" ? ["text"] : ["xml"],
      maxBytes: budgetFor(resource, budgets),
      timeoutMs: budgets.requestTimeoutMs,
      maxRedirects: budgets.maxRedirects,
    },
    dependencies,
  );

  if (!result.ok) {
    return {
      resource,
      requestedPath,
      reachable: false,
      kind: isAbsence(result.status) ? "absent" : "error",
      httpStatus: result.status ?? null,
      transportError: result.error,
    };
  }

  const facts: RobotsFacts | SitemapFacts =
    resource === "robots_txt"
      ? {
          kind: "robots",
          declaredSitemaps: parseRobots(result.body)
            .sitemaps.map(canonicalizeUrl)
            .filter((url): url is CanonicalUrl => url !== null),
        }
      : (() => {
          const document = parseSitemap(result.body, budgets.maxSitemapUrls);
          return {
            kind: "sitemap" as const,
            parsed: document.kind !== "unknown",
            urls: document.urls
              .map(canonicalizeUrl)
              .filter((url): url is CanonicalUrl => url !== null),
            urlsTruncated: document.truncated,
          };
        })();

  return {
    resource,
    requestedPath,
    reachable: true,
    httpStatus: result.status,
    contentType: result.contentType,
    bytes: result.bytesRead,
    truncated: result.truncated,
    redirects: result.redirectChain.length,
    effectiveOrigin: result.url.origin,
    facts,
  };
}

/**
 * One full observation: every resource the contract names, fetched once.
 *
 * Requests are issued together rather than sequentially — two GETs against one
 * origin is not a load concern, and issuing them in parallel keeps a single
 * observation close to instantaneous, which matters when there are seven of them
 * inside a fifteen-minute window.
 */
export async function observePublicProduct(
  expected: ExpectedOutcome,
  dependencies: SafeFetchDependencies,
  options: { budgets?: OutcomeBudgets; now?: Date } = {},
): Promise<Observation> {
  const budgets = options.budgets ?? DEFAULT_OUTCOME_BUDGETS;

  const observations = await Promise.all(
    expected.resources.map((resource) =>
      observeResource(resource, expected.publicOrigin, dependencies, budgets),
    ),
  );

  const byResource = new Map<OutcomeResource, ResourceObservation>();
  for (const observation of observations) byResource.set(observation.resource, observation);

  const effectiveOrigin =
    observations.find((observation) => observation.reachable)?.effectiveOrigin ?? null;

  return { observedAt: options.now ?? new Date(), effectiveOrigin, byResource };
}

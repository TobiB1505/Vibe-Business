import { parseRobots } from "@/modules/live-product-intelligence/robots";
import { parseSitemap } from "@/modules/live-product-intelligence/sitemap";
import {
  safeFetch,
  type SafeFetchDependencies,
  type SafeFetchFailure,
} from "@/modules/live-product-intelligence/net/safe-fetch";
import { DEFAULT_OUTCOME_BUDGETS, type OutcomeBudgets } from "./budgets";
import { canonicalPath, canonicalizeUrl, type CanonicalUrl } from "./canonical";
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
 * A handful of absolute paths on one origin, every one of them taken from the
 * contract that was frozen before the first request. No link is followed, no
 * sitemap entry is fetched, no sitemap index is walked, no authenticated route
 * is touched, no browser is opened and no JavaScript is executed. The sitemap's
 * contents are read as *data to compare against a fixed expectation*, never as
 * a list of things to go and get (CLAUDE.md rule 39).
 *
 * The agentic profile's page paths are the same kind of input: they were
 * derived from the repository's route table and the commit's changed files
 * before anything was fetched, so a page cannot add a page to the list.
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
      facts: RobotsFacts | SitemapFacts | RouteFacts;
    }
  | {
      reachable: false;
      /**
       * Typed reason, split three ways.
       *
       * ```
       * absent        the resource is not published — a 404 or a 410
       * contradicted  the origin answered, and its answer contradicts the
       *               expectation: a 5xx from a page that is supposed to serve
       * error         we could not look, and that is a fact about Vibe
       * ```
       *
       * The first two are the product's answers and the third is ours — the
       * distinction §19 and §23 are built on. `contradicted` exists because a
       * page probe can observe a *server error*, which the two document probes
       * never could: a missing `/sitemap.xml` is an absence, and a homepage
       * returning 500 is not.
       */
      kind: "absent" | "contradicted" | "error";
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

export type RouteFacts = {
  kind: "route";
  /**
   * Whether the response arrived at the path that was requested.
   *
   * The one derived fact a page probe produces, and the reason it produces
   * nothing else: this module reads a page's status line, content type and
   * final URL, and never its content. That is not an oversight — it is the
   * boundary of what the agentic profile is allowed to claim. Reading the body
   * would invite a check about what the page *says*, and Vibe holds no
   * pre-merge copy to compare it against.
   */
  pathPreserved: boolean;
};

export type Observation = {
  observedAt: Date;
  /** The origin actually served, once any resource resolved one. */
  effectiveOrigin: string | null;
  byResource: Map<OutcomeResource, ResourceObservation>;
  /**
   * Page observations, keyed by the path the contract asked for.
   *
   * Separate from `byResource` because `public_route` is the one resource that
   * is fetched more than once per observation — a map keyed by resource could
   * hold exactly one page, and would silently keep the last.
   */
  byRoute: Map<string, ResourceObservation>;
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
  if (resource === "robots_txt") return budgets.maxRobotsBytes;
  if (resource === "public_route") return budgets.maxRoutePageBytes;
  return budgets.maxSitemapBytes;
}

/**
 * Which HTTP answers are the *product's* answer rather than Vibe's problem.
 *
 * A 5xx is the server saying it is broken, and no proxy in front of it makes
 * that Vibe's observation failure — so it is `contradicted`, and the check that
 * reads it says `failed`.
 *
 * 401, 403 and 429 are deliberately **not** here. A bot-blocking WAF and a rate
 * limiter produce exactly those on a perfectly healthy public page, and this
 * module's whole discipline is that a fact about our request never gets
 * reported as a fact about somebody's product (§19, §23). They stay `error`.
 */
function isContradiction(status: number | undefined): boolean {
  return status !== undefined && status >= 500;
}

/**
 * Fetches one public page and reduces it to its status line.
 *
 * Deliberately a different function from `observeResource` rather than a branch
 * inside it. The two probes disagree about what an answer means — a 500 from
 * `/sitemap.xml` is a document Vibe could not read, and a 500 from a page the
 * change touched is the product being broken — and expressing that as a flag
 * would put both meanings behind one `if` that somebody later simplifies.
 */
async function observeRoute(
  path: string,
  publicOrigin: string,
  dependencies: SafeFetchDependencies,
  budgets: OutcomeBudgets,
): Promise<ResourceObservation> {
  const result = await safeFetch(
    `${publicOrigin}${path}`,
    {
      // A page route serves HTML. Anything else — a JSON error envelope, a
      // plain-text maintenance notice — is the origin answering with something
      // that is not the page, which is a contradiction rather than an absence.
      accept: ["html"],
      maxBytes: budgets.maxRoutePageBytes,
      timeoutMs: budgets.requestTimeoutMs,
      maxRedirects: budgets.maxRedirects,
    },
    dependencies,
  );

  if (!result.ok) {
    const contradicted =
      isContradiction(result.status) || result.error === "unsupported_content_type";

    return {
      resource: "public_route",
      requestedPath: path,
      reachable: false,
      kind: isAbsence(result.status) ? "absent" : contradicted ? "contradicted" : "error",
      httpStatus: result.status ?? null,
      transportError: result.error,
    };
  }

  return {
    resource: "public_route",
    requestedPath: path,
    reachable: true,
    httpStatus: result.status,
    contentType: result.contentType,
    bytes: result.bytesRead,
    truncated: result.truncated,
    redirects: result.redirectChain.length,
    effectiveOrigin: result.url.origin,
    // Compared as paths, not as URLs: an `example.com` → `www.example.com`
    // redirect is the origin being adopted, which `effectiveOrigin` records and
    // the evaluator accepts. Being sent from `/pricing` to `/login` is not.
    facts: {
      kind: "route",
      pathPreserved: canonicalPath(result.url.pathname) === canonicalPath(path),
    },
  };
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
  resource: Exclude<OutcomeResource, "public_route">,
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

  /*
   * The pages to probe come from the frozen expectation's own check list, not
   * from a field a caller could widen and not from anything fetched. Bounded a
   * second time here against the same budget the contract applied: a stored
   * expectation written under an earlier, larger budget must not be able to
   * spend today's requests (§9, CLAUDE.md rule 27).
   */
  const routePaths = expected.resources.includes("public_route")
    ? [
        ...new Set(
          expected.checks
            .filter((check) => check.resource === "public_route" && check.target !== null)
            .map((check) => canonicalPath(check.target as string)),
        ),
      ].slice(0, budgets.maxObservedRoutes)
    : [];

  const [documents, routes] = await Promise.all([
    Promise.all(
      expected.resources
        .filter((resource): resource is Exclude<OutcomeResource, "public_route"> =>
          resource !== "public_route",
        )
        .map((resource) => observeResource(resource, expected.publicOrigin, dependencies, budgets)),
    ),
    Promise.all(
      routePaths.map((path) => observeRoute(path, expected.publicOrigin, dependencies, budgets)),
    ),
  ]);

  const byResource = new Map<OutcomeResource, ResourceObservation>();
  for (const observation of documents) byResource.set(observation.resource, observation);

  const byRoute = new Map<string, ResourceObservation>();
  for (const observation of routes) byRoute.set(observation.requestedPath, observation);

  const effectiveOrigin =
    [...documents, ...routes].find((observation) => observation.reachable)?.effectiveOrigin ?? null;

  return { observedAt: options.now ?? new Date(), effectiveOrigin, byResource, byRoute };
}

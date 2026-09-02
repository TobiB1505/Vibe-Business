import { canonicalPath, isUnderPrefix, matchesPath } from "./canonical";
import type {
  Observation,
  ResourceObservation,
  RouteFacts,
  SitemapFacts,
  RobotsFacts,
} from "./observe";
import {
  outcomeCheckId,
  type ExpectedOutcome,
  type OutcomeCheck,
  type OutcomeCheckResult,
  type OutcomeCheckStatus,
  type OutcomeObservedValue,
  type OutcomeStatus,
} from "./schema";

/**
 * Comparing expectation to observation (Sprint 12A §8, §20, §21, §22, §23).
 *
 * Pure and total: expectations in, results out, no clock, no network, no
 * database. Every classification this product can produce about somebody's
 * production website is therefore a unit test rather than a live experiment.
 *
 * ## The four check outcomes, and why `error` is separate
 *
 * ```
 * passed        the expected behaviour is present
 * failed        the document was read and contradicts the expectation
 * not_observed  the document is not published (yet)
 * error         Vibe could not read it reliably
 * ```
 *
 * A DNS outage, a TLS failure, a refused redirect and a rate limit are all
 * facts about the *observation*, not about the product. Folding them into
 * `failed` would let Vibe tell a customer their sitemap is broken because our
 * resolver had a bad afternoon (§19, §23).
 */

/** The origins a URL in a document may be on and still count as the product's. */
function acceptedOrigins(expected: ExpectedOutcome, observation: Observation): string[] {
  return observation.effectiveOrigin === null || observation.effectiveOrigin === expected.publicOrigin
    ? [expected.publicOrigin]
    : [expected.publicOrigin, observation.effectiveOrigin];
}

/** Transport-level evidence, identical for every check reading one resource. */
function transportEvidence(observation: ResourceObservation): OutcomeObservedValue {
  if (!observation.reachable) {
    return {
      ...(observation.httpStatus !== null ? { httpStatus: observation.httpStatus } : {}),
      transportError: observation.transportError,
    };
  }

  return {
    httpStatus: observation.httpStatus,
    contentType: observation.contentType,
    bytes: observation.bytes,
    truncated: observation.truncated,
    redirects: observation.redirects,
  };
}

/**
 * How a check reports when its resource could not be read.
 *
 * `absent` is the product's answer — the file is not published — so a
 * presence check is `not_observed` and, critically, an **absence check is not
 * `passed`**. A sitemap that does not exist does not demonstrate that private
 * routes are excluded from it; it demonstrates nothing. Reporting `passed`
 * there would let a completely undeployed product accumulate green checks (§21).
 */
function unreadable(observation: Extract<ResourceObservation, { reachable: false }>): OutcomeCheckStatus {
  if (observation.kind === "absent") return "not_observed";
  // The origin answered, and its answer contradicts the expectation — a 5xx
  // from a page the change touched, or a page route serving something that is
  // not a page. Only a route probe ever produces this; the two document probes
  // classify every unreadable answer as an absence or as our own failure.
  if (observation.kind === "contradicted") return "failed";
  return "error";
}

/**
 * One page probe, judged (ADR 0071).
 *
 * ```
 * 2xx HTML at the path we asked for   → passed
 * 2xx HTML somewhere else             → not_observed   we saw a different page
 * 404 / 410                           → not_observed   the page is not published
 * 5xx, or served as not-a-page        → failed         the origin contradicts us
 * 401 / 403 / 429 / transport         → error          we could not look
 * ```
 *
 * `passed` here carries one sentence and no more: *this path answered as a
 * page.* It is not evidence that the merged build is the one serving it — Vibe
 * reads no deployment API (§3) and holds no pre-merge copy of the page to
 * compare against. The card says so, and `OUTCOME_PROFILE_SCOPE_NOTES` is where
 * that sentence is written down once.
 *
 * The redirect case is `not_observed` rather than `failed` on purpose. A
 * `/pricing` that now redirects to `/plans` is a site that was reorganised, not
 * a site that is broken, and the honest report is that Vibe did not see the
 * page it asked about.
 */
function evaluateRouteCheck(
  check: OutcomeCheck,
  observation: Observation,
): { status: OutcomeCheckStatus; observedValue: OutcomeObservedValue } {
  const probe =
    check.target === null ? undefined : observation.byRoute.get(canonicalPath(check.target));

  if (probe === undefined) {
    // The contract names a page the observation never attempted. A Vibe defect,
    // reported as one rather than as a product fact.
    return { status: "error", observedValue: { transportError: "request_failed" } };
  }

  const evidence = transportEvidence(probe);
  if (!probe.reachable) return { status: unreadable(probe), observedValue: evidence };

  const { pathPreserved } = probe.facts as RouteFacts;

  return {
    status: pathPreserved ? "passed" : "not_observed",
    observedValue: { ...evidence, pathPreserved },
  };
}

function evaluateCheck(
  check: OutcomeCheck,
  observation: Observation,
  origins: string[],
): { status: OutcomeCheckStatus; observedValue: OutcomeObservedValue } {
  if (check.kind === "public_route_serves_page") return evaluateRouteCheck(check, observation);

  const resource = observation.byResource.get(check.resource);

  if (resource === undefined) {
    // The contract names a resource the observation never attempted. A Vibe
    // defect, reported as one rather than as a product fact.
    return { status: "error", observedValue: { transportError: "request_failed" } };
  }

  const evidence = transportEvidence(resource);

  if (!resource.reachable) {
    return { status: unreadable(resource), observedValue: evidence };
  }

  // `public_route_serves_page` is already gone from `check.kind` here, narrowed
  // out by the early return above — so this switch stays exhaustive without a
  // case for it, and adding a check kind that reaches this far is still a type
  // error rather than a silent fall-through.
  switch (check.kind) {
    case "robots_reachable":
    case "sitemap_reachable":
      // Reachability is exactly what was just established: a 2xx of the right
      // content type, after every redirect hop was revalidated.
      return { status: "passed", observedValue: evidence };

    case "robots_declares_sitemap": {
      const facts = resource.facts as RobotsFacts;
      const present = facts.declaredSitemaps.some((url) =>
        matchesPath(url, "/sitemap.xml", origins),
      );
      return { status: present ? "passed" : "failed", observedValue: { ...evidence, present } };
    }

    case "sitemap_parsed": {
      const facts = resource.facts as SitemapFacts;
      return {
        // A document served as XML that announces itself as neither a urlset
        // nor a sitemapindex is a reliable read of something that is not a
        // sitemap — a contradiction, not an absence.
        status: facts.parsed ? "passed" : "failed",
        observedValue: { ...evidence, parsed: facts.parsed, urlCount: facts.urls.length },
      };
    }

    case "sitemap_includes_public_root":
    case "sitemap_includes_path": {
      const facts = resource.facts as SitemapFacts;
      const path = check.target ?? "/";
      const present = facts.urls.some((url) => matchesPath(url, path, origins));

      return {
        // A sitemap that parsed and does not list a page the capability put in
        // it is a contradiction, not a "not yet" — the document is published
        // and says something different.
        status: present ? "passed" : "failed",
        observedValue: { ...evidence, present, urlCount: facts.urls.length },
      };
    }

    case "sitemap_excludes_private_prefix": {
      const facts = resource.facts as SitemapFacts;
      const prefix = check.target ?? "/";
      const present = facts.urls.some((url) => isUnderPrefix(url, prefix, origins));

      if (facts.urlsTruncated && !present) {
        // The URL budget cut the list short, so "we did not find it" is not the
        // same sentence as "it is not there". Absence over a truncated list is
        // not evidence of absence, and claiming otherwise is precisely the
        // silent coverage loss CLAUDE.md rule 27 forbids.
        return {
          status: "not_observed",
          observedValue: { ...evidence, present: false, urlCount: facts.urls.length, truncated: true },
        };
      }

      return {
        // Present means the capability's own exclusion rule is not holding in
        // production: a private surface is being advertised to crawlers. That
        // is the defect v2 was built to prevent, and it must read as `failed`.
        status: present ? "failed" : "passed",
        observedValue: { ...evidence, present, urlCount: facts.urls.length },
      };
    }
  }
}

export function evaluateObservation(
  expected: ExpectedOutcome,
  observation: Observation,
): OutcomeCheckResult[] {
  const origins = acceptedOrigins(expected, observation);
  const observedAt = observation.observedAt.toISOString();

  return expected.checks.map((check) => {
    const { status, observedValue } = evaluateCheck(check, observation, origins);
    return {
      checkId: outcomeCheckId(check),
      kind: check.kind,
      target: check.target === null ? null : canonicalPath(check.target),
      status,
      observedValue,
      observedAt,
    };
  });
}

/** True when every expectation held — the early-exit condition (§20). */
export function allChecksPassed(results: readonly OutcomeCheckResult[]): boolean {
  // An empty result set is deliberately *not* success. A contract with no
  // checks would otherwise verify instantly and mean nothing, which is how an
  // unsupported capability could quietly report a green outcome.
  return results.length > 0 && results.every((result) => result.status === "passed");
}

/**
 * The terminal classification for a completed window (§20, §21, §22, §23).
 *
 * ```
 * every check passed                     → verified
 * nothing passed, everything errored     → failed        we could not look
 * nothing passed                         → not_observed  it did not appear
 * otherwise                              → partial       some of it did
 * ```
 *
 * The order matters and the middle two are the pair worth being careful about.
 * "Vibe could not observe the outcome" and "the outcome was not observed" are
 * different claims: one is about Vibe, one is about the product, and only the
 * first is ever Vibe's fault to report.
 */
export function classifyOutcome(
  results: readonly OutcomeCheckResult[],
): Exclude<OutcomeStatus, "queued" | "observing"> {
  if (results.length === 0) return "failed";
  if (allChecksPassed(results)) return "verified";

  const passed = results.some((result) => result.status === "passed");
  if (passed) return "partial";

  return results.every((result) => result.status === "error") ? "failed" : "not_observed";
}

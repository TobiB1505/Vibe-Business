import { describe, expect, it } from "vitest";
import {
  htmlResponse,
  redirectResponse,
  xmlResponse,
  textResponse,
} from "@/modules/live-product-intelligence/test-support";
import { resolveOutcomeContract } from "@/modules/execution/outcome-contract";
import { allChecksPassed, classifyOutcome, evaluateObservation } from "./evaluate";
import { observePublicProduct } from "./observe";
import { DEFAULT_OUTCOME_BUDGETS } from "./budgets";
import type { ExpectedOutcome, OutcomeCheckResult, OutcomeCheckStatus } from "./schema";
import {
  OUTCOME_ORIGIN,
  outcomeHttp,
  outcomeSite,
  outcomeSnapshot,
  robotsBody,
  sitemapBody,
} from "./test-support";

/**
 * SEO outcome classification (Sprint 12A §20, §21, §22, §23, §41).
 *
 * End-to-end through the real contract, the real observer and the real
 * evaluator, against in-memory network doubles — so what these tests describe
 * is what production would conclude, not what a hand-written result array
 * happens to classify as.
 *
 * The four scenarios §41 names are each a `describe` block below, and the
 * classification is asserted explicitly rather than inferred.
 */

function contract(): ExpectedOutcome {
  const resolved = resolveOutcomeContract({
    capability: "nextjs_seo_foundations_v2",
    publicOrigin: OUTCOME_ORIGIN,
    repository: outcomeSnapshot(),
    changedPaths: [],
  });
  if (!resolved.supported) throw new Error("expected a supported contract");
  return resolved.expected;
}

async function observe(
  routes: Parameters<typeof outcomeHttp>[0],
  budgets = DEFAULT_OUTCOME_BUDGETS,
): Promise<OutcomeCheckResult[]> {
  const expected = contract();
  const observation = await observePublicProduct(expected, outcomeHttp(routes), { budgets });
  return evaluateObservation(expected, observation);
}

function statusOf(results: OutcomeCheckResult[], checkId: string): OutcomeCheckStatus {
  const result = results.find((entry) => entry.checkId === checkId);
  if (!result) throw new Error(`no result for ${checkId}`);
  return result.status;
}

/** The site as the capability intends it: both files live, sitemap correct. */
const CORRECT_SITE = outcomeSite({
  sitemap: xmlResponse(sitemapBody([OUTCOME_ORIGIN, `${OUTCOME_ORIGIN}/pricing`])),
});

describe("all expected behaviour present → verified (§20, §41)", () => {
  it("passes every check", async () => {
    const results = await observe(CORRECT_SITE);

    expect(results.every((result) => result.status === "passed")).toBe(true);
    expect(allChecksPassed(results)).toBe(true);
    expect(classifyOutcome(results)).toBe("verified");
  });

  it("records bounded derived evidence and nothing else", async () => {
    const results = await observe(CORRECT_SITE);
    const serialized = JSON.stringify(results);

    // No body, no XML, no robots text, no query string.
    expect(serialized).not.toContain("<urlset");
    expect(serialized).not.toContain("User-Agent");
    expect(serialized).not.toContain("<?xml");

    const sitemapCheck = results.find((r) => r.checkId === "sitemap_parsed");
    expect(sitemapCheck?.observedValue.httpStatus).toBe(200);
    expect(sitemapCheck?.observedValue.urlCount).toBe(2);
  });
});

describe("robots missing initially, appearing later → eventually verified (§41)", () => {
  it("is not verified while robots.txt is absent", async () => {
    const results = await observe(outcomeSite({ robots: null }));

    expect(statusOf(results, "robots_reachable")).toBe("not_observed");
    expect(statusOf(results, "robots_declares_sitemap")).toBe("not_observed");
    expect(allChecksPassed(results)).toBe(false);

    // Some sitemap checks passed, so the honest classification at this instant
    // is `partial` — but the workflow does not conclude here, it keeps looking.
    expect(classifyOutcome(results)).toBe("partial");
  });

  it("verifies once it appears, without any change to the expectation", async () => {
    // The same frozen contract, a later observation. Production changing does
    // not rewrite what Vibe said it was looking for (§9).
    const first = await observe(outcomeSite({ robots: null }));
    const second = await observe(CORRECT_SITE);

    expect(allChecksPassed(first)).toBe(false);
    expect(allChecksPassed(second)).toBe(true);
    expect(first.map((r) => r.checkId)).toEqual(second.map((r) => r.checkId));
  });
});

describe("sitemap reachable but containing an auth route → partial (§21, §41)", () => {
  it("fails only the excluded-prefix check", async () => {
    // The Sprint 9 defect, observed in production: `/login` and `/signup` being
    // advertised to every crawler on the internet.
    const results = await observe(
      outcomeSite({
        sitemap: xmlResponse(
          sitemapBody([OUTCOME_ORIGIN, `${OUTCOME_ORIGIN}/login`, `${OUTCOME_ORIGIN}/signup`]),
        ),
      }),
    );

    expect(statusOf(results, "sitemap_excludes_private_prefix:/login")).toBe("failed");
    expect(statusOf(results, "sitemap_excludes_private_prefix:/signup")).toBe("failed");
    expect(statusOf(results, "sitemap_reachable")).toBe("passed");
    expect(statusOf(results, "sitemap_includes_public_root:/")).toBe("passed");
    expect(statusOf(results, "robots_reachable")).toBe("passed");

    // Not `failed` for the whole change. Per-check truth is preserved (§21).
    expect(classifyOutcome(results)).toBe("partial");
  });

  it("catches a nested application route, not just the exact prefix", async () => {
    const results = await observe(
      outcomeSite({
        sitemap: xmlResponse(sitemapBody([OUTCOME_ORIGIN, `${OUTCOME_ORIGIN}/app/projects/42`])),
      }),
    );

    expect(statusOf(results, "sitemap_excludes_private_prefix:/app")).toBe("failed");
  });

  it("does not report a page that merely shares a prefix's letters", async () => {
    const results = await observe(
      outcomeSite({
        sitemap: xmlResponse(sitemapBody([OUTCOME_ORIGIN, `${OUTCOME_ORIGIN}/application-form`])),
      }),
    );

    expect(statusOf(results, "sitemap_excludes_private_prefix:/app")).toBe("passed");
  });

  it("refuses to claim absence over a truncated URL list", async () => {
    // "We did not find it in the first ten" is not "it is not there", and
    // reporting it as passed would be silent coverage loss (CLAUDE.md rule 27).
    const many = Array.from({ length: 40 }, (_, index) => `${OUTCOME_ORIGIN}/page-${index}`);
    const results = await observe(
      outcomeSite({ sitemap: xmlResponse(sitemapBody([OUTCOME_ORIGIN, ...many])) }),
      { ...DEFAULT_OUTCOME_BUDGETS, maxSitemapUrls: 5 },
    );

    expect(statusOf(results, "sitemap_excludes_private_prefix:/login")).toBe("not_observed");
  });

  it("fails a sitemap that does not list the homepage", async () => {
    const results = await observe(
      outcomeSite({ sitemap: xmlResponse(sitemapBody([`${OUTCOME_ORIGIN}/pricing`])) }),
    );

    // The document is published and says something different — a contradiction,
    // not a "not yet".
    expect(statusOf(results, "sitemap_includes_public_root:/")).toBe("failed");
    expect(classifyOutcome(results)).toBe("partial");
  });

  it("fails a robots.txt that points at somebody else's sitemap", async () => {
    const results = await observe(
      outcomeSite({ robots: textResponse(robotsBody("https://elsewhere.test")) }),
    );

    expect(statusOf(results, "robots_declares_sitemap")).toBe("failed");
  });
});

describe("endpoints never appearing → not_observed (§22, §41)", () => {
  it("classifies a completely un-updated production as not observed", async () => {
    const results = await observe(outcomeSite({ robots: null, sitemap: null }));

    expect(results.every((result) => result.status === "not_observed")).toBe(true);
    expect(classifyOutcome(results)).toBe("not_observed");
  });

  it("does not credit an absence check for a sitemap that does not exist", async () => {
    // A sitemap that is not published does not demonstrate that private routes
    // are excluded from it. Reporting `passed` there would let a completely
    // undeployed product accumulate green checks.
    const results = await observe(outcomeSite({ robots: null, sitemap: null }));

    expect(statusOf(results, "sitemap_excludes_private_prefix:/login")).toBe("not_observed");
  });
});

describe("network unavailable throughout → failed (§23, §41)", () => {
  it("classifies a total transport failure as Vibe's inability, not the product's", async () => {
    const results = await observe(
      outcomeSite({ robots: { fail: "connection_failed" }, sitemap: { fail: "connection_failed" } }),
    );

    expect(results.every((result) => result.status === "error")).toBe(true);
    expect(classifyOutcome(results)).toBe("failed");
  });

  it("classifies a blocked destination the same way", async () => {
    const results = await observe(outcomeSite({ robots: { fail: "tls_error" }, sitemap: { fail: "tls_error" } }));

    expect(classifyOutcome(results)).toBe("failed");
  });

  it("does not classify a mixture of errors and passes as failed", async () => {
    // A DNS blip on one endpoint must not turn a partly-observed outcome into
    // "we could not look at all".
    const results = await observe(outcomeSite({ robots: { fail: "timeout" } }));

    expect(statusOf(results, "robots_reachable")).toBe("error");
    expect(statusOf(results, "sitemap_reachable")).toBe("passed");
    expect(classifyOutcome(results)).toBe("partial");
  });
});

describe("stored evidence stays bounded and derived (§8, §14, §15)", () => {
  /**
   * The evidence policy, enforced as a shape rather than as a habit.
   *
   * The interesting mutation is not "the raw XML gets stored" — that is caught
   * by a substring assertion. It is a URL list, a header dump or a body excerpt
   * arriving inside a field that already exists and is typed `string`. So this
   * checks the *keys* against an allowlist and the *values* against a length
   * bound, which is what CLAUDE.md rule 37 actually asks for.
   */
  const ALLOWED_KEYS = [
    "httpStatus",
    "contentType",
    "urlCount",
    "present",
    "parsed",
    "redirects",
    "bytes",
    "truncated",
    "transportError",
  ];

  it("uses only allowlisted evidence keys", async () => {
    const results = await observe(
      outcomeSite({
        sitemap: xmlResponse(sitemapBody([OUTCOME_ORIGIN, `${OUTCOME_ORIGIN}/login`])),
      }),
    );

    for (const result of results) {
      for (const key of Object.keys(result.observedValue)) {
        expect(ALLOWED_KEYS).toContain(key);
      }
    }
  });

  it("stores only short scalars, never a list or a document", async () => {
    const many = Array.from({ length: 40 }, (_, index) => `${OUTCOME_ORIGIN}/page-${index}`);
    const results = await observe(outcomeSite({ sitemap: xmlResponse(sitemapBody(many)) }));

    for (const result of results) {
      for (const value of Object.values(result.observedValue)) {
        expect(["number", "boolean", "string"]).toContain(typeof value);
        // A content type is ~20 characters and a transport code shorter. Any
        // string longer than this is carrying content that does not belong in
        // an evidence row.
        if (typeof value === "string") expect(value.length).toBeLessThanOrEqual(64);
      }
    }
  });

  it("never records a URL taken from a fetched document", async () => {
    const results = await observe(
      outcomeSite({
        sitemap: xmlResponse(
          sitemapBody([OUTCOME_ORIGIN, `${OUTCOME_ORIGIN}/secret-launch-page?token=abc`]),
        ),
      }),
    );

    const serialized = JSON.stringify(results);
    expect(serialized).not.toContain("secret-launch-page");
    expect(serialized).not.toContain("token=abc");
  });

  it("records only the check ids the contract produced, never a discovered path", async () => {
    const results = await observe(
      outcomeSite({
        sitemap: xmlResponse(sitemapBody([OUTCOME_ORIGIN, `${OUTCOME_ORIGIN}/discovered`])),
      }),
    );

    for (const result of results) {
      expect(result.checkId).not.toContain("discovered");
      if (result.target !== null) {
        expect(contract().checks.map((check) => check.target)).toContain(result.target);
      }
    }
  });
});

describe("classification boundaries (§20, §21, §22, §23)", () => {
  const result = (status: OutcomeCheckStatus): OutcomeCheckResult => ({
    checkId: `check_${status}_${Math.random()}`,
    kind: "sitemap_reachable",
    target: null,
    status,
    observedValue: {},
    observedAt: "2026-08-14T14:50:00.000Z",
  });

  it.each([
    [["passed", "passed"], "verified"],
    [["passed", "failed"], "partial"],
    [["passed", "not_observed"], "partial"],
    [["passed", "error"], "partial"],
    [["not_observed", "not_observed"], "not_observed"],
    [["not_observed", "error"], "not_observed"],
    [["failed", "not_observed"], "not_observed"],
    [["error", "error"], "failed"],
  ])("classifies %j as %s", (statuses, expected) => {
    expect(classifyOutcome((statuses as OutcomeCheckStatus[]).map(result))).toBe(expected);
  });

  it("never treats an empty check list as success", async () => {
    // An unsupported capability with no checks would otherwise verify for free.
    expect(allChecksPassed([])).toBe(false);
    expect(classifyOutcome([])).toBe("failed");
  });
});

/**
 * The agentic profile, end to end (ADR 0071).
 *
 * Same discipline as everything above: the contract is resolved by the real
 * `resolveOutcomeContract`, the observation by the real `observePublicProduct`
 * against the fake transport, and the classification by the real evaluator. No
 * hand-written result array — what is asserted is what production would
 * conclude.
 */
function agenticContract(changedPaths: string[]): ExpectedOutcome {
  const resolved = resolveOutcomeContract({
    capability: "agentic_execution_v1",
    publicOrigin: OUTCOME_ORIGIN,
    repository: outcomeSnapshot(),
    changedPaths,
  });
  if (!resolved.supported) throw new Error(`expected supported, got ${resolved.reason}`);
  return resolved.expected;
}

async function observeAgentic(
  changedPaths: string[],
  routes: Parameters<typeof outcomeHttp>[0],
): Promise<OutcomeCheckResult[]> {
  const expected = agenticContract(changedPaths);
  const observation = await observePublicProduct(expected, outcomeHttp(routes), {
    budgets: DEFAULT_OUTCOME_BUDGETS,
  });
  return evaluateObservation(expected, observation);
}

const CHANGED_PAGES = ["src/app/page.tsx", "src/app/pricing/page.tsx"];

describe("an agentic change whose pages are being served (ADR 0071)", () => {
  it("verifies when both touched pages answer", async () => {
    const results = await observeAgentic(CHANGED_PAGES, {
      [`${OUTCOME_ORIGIN}/`]: htmlResponse("<h1>Home</h1>"),
      [`${OUTCOME_ORIGIN}/pricing`]: htmlResponse("<h1>Plans</h1>"),
    });

    expect(results.map((result) => result.checkId)).toEqual([
      "public_route_serves_page:/",
      "public_route_serves_page:/pricing",
    ]);
    expect(classifyOutcome(results)).toBe("verified");
  });

  it("stores the status line and never the page", async () => {
    // The same evidence policy the two document probes work under (§14, §15,
    // CLAUDE.md rule 37) — and here it is also the boundary of the claim: this
    // profile does not read a page's content, so it cannot report on it.
    const results = await observeAgentic(["src/app/pricing/page.tsx"], {
      [`${OUTCOME_ORIGIN}/pricing`]: htmlResponse("<h1>Plans</h1><p>19 EUR</p>"),
    });

    expect(JSON.stringify(results)).not.toContain("19 EUR");
    expect(JSON.stringify(results)).not.toContain("<h1>");
    expect(results[0].observedValue.httpStatus).toBe(200);
    expect(results[0].observedValue.pathPreserved).toBe(true);
  });
});

describe("an agentic change that broke a page (ADR 0071)", () => {
  it("reads a 500 on a touched page as failed, not as an absence", async () => {
    // The most expensive thing this pipeline can do is merge a change that
    // takes a public page down, and this is the check that says so.
    const results = await observeAgentic(CHANGED_PAGES, {
      [`${OUTCOME_ORIGIN}/`]: htmlResponse("<h1>Home</h1>"),
      [`${OUTCOME_ORIGIN}/pricing`]: { status: 500 },
    });

    expect(statusOf(results, "public_route_serves_page:/pricing")).toBe("failed");
    expect(statusOf(results, "public_route_serves_page:/")).toBe("passed");
    expect(classifyOutcome(results)).toBe("partial");
  });

  it("reads a 404 as the page not being published, not as it being broken", async () => {
    const results = await observeAgentic(["src/app/pricing/page.tsx"], {
      [`${OUTCOME_ORIGIN}/pricing`]: { status: 404 },
    });

    expect(statusOf(results, "public_route_serves_page:/pricing")).toBe("not_observed");
    expect(classifyOutcome(results)).toBe("not_observed");
  });

  it("never blames the product for a request Vibe could not make", async () => {
    // A rate limiter and a bot-blocking WAF answer exactly like this on a
    // perfectly healthy page. `failed` here would be Vibe telling a founder
    // their site is broken because of our user agent (§19, §23).
    const results = await observeAgentic(["src/app/pricing/page.tsx"], {
      [`${OUTCOME_ORIGIN}/pricing`]: { status: 429 },
    });

    expect(statusOf(results, "public_route_serves_page:/pricing")).toBe("error");
    expect(classifyOutcome(results)).toBe("failed");
  });

  it("reports a page that redirects elsewhere as not observed", async () => {
    const results = await observeAgentic(["src/app/pricing/page.tsx"], {
      [`${OUTCOME_ORIGIN}/pricing`]: redirectResponse(`${OUTCOME_ORIGIN}/plans`),
      [`${OUTCOME_ORIGIN}/plans`]: htmlResponse("<h1>Plans</h1>"),
    });

    const result = results[0];
    expect(result.status).toBe("not_observed");
    expect(result.observedValue.pathPreserved).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  redirectResponse,
  textResponse,
  xmlResponse,
} from "@/modules/live-product-intelligence/test-support";
import { DEFAULT_OUTCOME_BUDGETS } from "./budgets";
import { observePublicProduct } from "./observe";
import type { ExpectedOutcome } from "./schema";
import {
  OUTCOME_ADDRESS,
  OUTCOME_HOSTNAME,
  OUTCOME_ORIGIN,
  outcomeHttp,
  outcomeSite,
  robotsBody,
  sitemapBody,
} from "./test-support";

/**
 * Observing the public product (Sprint 12A §12, §13, §40).
 *
 * ## What these tests are really asserting
 *
 * That outcome verification goes through the **same** outbound door as live
 * product intelligence, and gets its SSRF, redirect, timeout and size
 * guarantees for free rather than re-implementing weaker ones.
 *
 * The full safe-fetch suite is not duplicated here — `net/safe-fetch.test.ts`
 * already proves the address gate, the pinned connection and the per-hop
 * redirect revalidation over nine private ranges. What this file proves is that
 * observation **uses that path**, which is the part a refactor could quietly
 * break while every safe-fetch test stayed green (§40).
 *
 * ## And that this is not a crawl
 *
 * Exactly two requests per observation, to exactly the two paths the contract
 * names, whatever the fetched documents happen to contain.
 */

function expected(overrides: Partial<ExpectedOutcome> = {}): ExpectedOutcome {
  return {
    profile: "nextjs_seo_foundations_outcome_v1",
    profileVersion: "nextjs-seo-foundations-outcome-v1",
    publicOrigin: OUTCOME_ORIGIN,
    resources: ["robots_txt", "sitemap_xml"],
    checks: [],
    truncated: false,
    ...overrides,
  };
}

describe("only the contract's endpoints are requested (§13)", () => {
  it("makes exactly two requests, to robots.txt and sitemap.xml", async () => {
    const http = outcomeHttp(outcomeSite());

    await observePublicProduct(expected(), http);

    expect(http.transport.requests.map((request) => request.url)).toEqual(
      expect.arrayContaining([`${OUTCOME_ORIGIN}/robots.txt`, `${OUTCOME_ORIGIN}/sitemap.xml`]),
    );
    expect(http.transport.requests).toHaveLength(2);
  });

  it("never fetches the site root", async () => {
    // "Is the homepage in the sitemap" is a question about the sitemap. The
    // extra request would buy nothing and would be one more hit on somebody's
    // production website, seven times over.
    const http = outcomeHttp(outcomeSite());

    await observePublicProduct(expected(), http);

    expect(http.transport.requests.some((request) => request.url === `${OUTCOME_ORIGIN}/`)).toBe(
      false,
    );
  });

  it("never follows a URL it found inside the sitemap", async () => {
    // The sitemap is data to compare against a fixed expectation, never a list
    // of things to go and get (CLAUDE.md rule 39).
    const http = outcomeHttp(
      outcomeSite({
        sitemap: xmlResponse(
          sitemapBody([
            OUTCOME_ORIGIN,
            `${OUTCOME_ORIGIN}/pricing`,
            `${OUTCOME_ORIGIN}/blog/one`,
            "https://elsewhere.test/",
          ]),
        ),
      }),
    );

    await observePublicProduct(expected(), http);

    expect(http.transport.requests).toHaveLength(2);
  });

  it("never follows a sitemap declared by robots.txt", async () => {
    const http = outcomeHttp(
      outcomeSite({ robots: textResponse(robotsBody("https://elsewhere.test")) }),
    );

    await observePublicProduct(expected(), http);

    expect(http.transport.requests).toHaveLength(2);
    expect(
      http.transport.requests.every((request) => request.url.startsWith(OUTCOME_ORIGIN)),
    ).toBe(true);
  });
});

describe("the safe outbound boundary is not bypassed (§12, §40)", () => {
  it("refuses an origin resolving to a private address, without making the request", async () => {
    // Not "fetches and discards" — a guard that reached a private address has
    // already leaked internal reachability.
    const http = outcomeHttp(outcomeSite(), { [OUTCOME_HOSTNAME]: ["127.0.0.1"] });

    const observation = await observePublicProduct(expected(), http);

    expect(http.transport.requests).toHaveLength(0);
    for (const resource of observation.byResource.values()) {
      expect(resource.reachable).toBe(false);
      if (!resource.reachable) expect(resource.transportError).toBe("unsafe_destination");
    }
  });

  it("refuses a hostname that resolves to both a public and a private address", async () => {
    // The shape of a DNS rebinding answer. Picking the safe one would be a bug,
    // not a kindness.
    const http = outcomeHttp(outcomeSite(), {
      [OUTCOME_HOSTNAME]: [OUTCOME_ADDRESS, "10.0.0.5"],
    });

    await observePublicProduct(expected(), http);

    expect(http.transport.requests).toHaveLength(0);
  });

  it("pins the connection to the address that passed the gate", async () => {
    const http = outcomeHttp(outcomeSite());

    await observePublicProduct(expected(), http);

    for (const request of http.transport.requests) {
      expect(request.pinnedAddress).toBe(OUTCOME_ADDRESS);
    }
  });

  it("revalidates a redirect rather than following it blindly", async () => {
    const http = outcomeHttp(
      {
        [`${OUTCOME_ORIGIN}/robots.txt`]: redirectResponse("https://internal.test/robots.txt"),
        [`${OUTCOME_ORIGIN}/sitemap.xml`]: xmlResponse(sitemapBody([OUTCOME_ORIGIN])),
        "https://internal.test/robots.txt": textResponse(robotsBody()),
      },
      { [OUTCOME_HOSTNAME]: [OUTCOME_ADDRESS], "internal.test": ["192.168.1.10"] },
    );

    const observation = await observePublicProduct(expected(), http);

    const robots = observation.byResource.get("robots_txt");
    expect(robots?.reachable).toBe(false);
    if (robots && !robots.reachable) expect(robots.transportError).toBe("unsafe_destination");
    // The first hop was made; the second was refused before leaving.
    expect(
      http.transport.requests.some((request) => request.url.startsWith("https://internal.test")),
    ).toBe(false);
  });

  it("applies the size budget while the body streams, not after", async () => {
    const http = outcomeHttp(outcomeSite());

    await observePublicProduct(expected(), http, {
      budgets: { ...DEFAULT_OUTCOME_BUDGETS, maxRobotsBytes: 32, maxSitemapBytes: 64 },
    });

    const byPath = new Map(http.transport.requests.map((r) => [new URL(r.url).pathname, r.maxBytes]));
    expect(byPath.get("/robots.txt")).toBe(32);
    expect(byPath.get("/sitemap.xml")).toBe(64);
  });

  it("bounds the sitemap URL list rather than reading an unbounded document", async () => {
    const many = Array.from({ length: 50 }, (_, index) => `${OUTCOME_ORIGIN}/page-${index}`);
    const http = outcomeHttp(outcomeSite({ sitemap: xmlResponse(sitemapBody(many)) }));

    const observation = await observePublicProduct(expected(), http, {
      budgets: { ...DEFAULT_OUTCOME_BUDGETS, maxSitemapUrls: 10 },
    });

    const sitemap = observation.byResource.get("sitemap_xml");
    if (!sitemap?.reachable || sitemap.facts.kind !== "sitemap") throw new Error("expected sitemap");
    expect(sitemap.facts.urls).toHaveLength(10);
    expect(sitemap.facts.urlsTruncated).toBe(true);
  });
});

describe("what an observation reduces to (§8, §14, §15)", () => {
  it("returns derived facts and never the document", async () => {
    const http = outcomeHttp(outcomeSite());

    const observation = await observePublicProduct(expected(), http);

    // The serialized observation must not contain the body of either file.
    const serialized = JSON.stringify([...observation.byResource.values()]);
    expect(serialized).not.toContain("User-Agent");
    expect(serialized).not.toContain("<urlset");
    expect(serialized).not.toContain("<?xml");
  });

  it("reads the sitemap URLs robots.txt declares", async () => {
    const http = outcomeHttp(outcomeSite());

    const observation = await observePublicProduct(expected(), http);
    const robots = observation.byResource.get("robots_txt");

    if (!robots?.reachable || robots.facts.kind !== "robots") throw new Error("expected robots");
    expect(robots.facts.declaredSitemaps).toEqual([
      { origin: OUTCOME_ORIGIN, path: "/sitemap.xml" },
    ]);
  });

  it("separates an absent resource from an unreadable one (§19)", async () => {
    // A 404 during the window is the expected shape of "production has not
    // updated yet". Classifying it as an error would make every mid-deploy poll
    // a Vibe fault.
    const http = outcomeHttp(outcomeSite({ robots: null }));

    const observation = await observePublicProduct(expected(), http);
    const robots = observation.byResource.get("robots_txt");

    expect(robots?.reachable).toBe(false);
    if (robots && !robots.reachable) {
      expect(robots.kind).toBe("absent");
      expect(robots.httpStatus).toBe(404);
    }
  });

  it("treats a transport failure as unreadable, not as absent", async () => {
    const http = outcomeHttp(
      outcomeSite({ robots: { fail: "timeout" }, sitemap: { fail: "timeout" } }),
    );

    const observation = await observePublicProduct(expected(), http);

    for (const resource of observation.byResource.values()) {
      expect(resource.reachable).toBe(false);
      if (!resource.reachable) expect(resource.kind).toBe("error");
    }
  });

  it("refuses a robots.txt served as HTML rather than reading nonsense out of it", async () => {
    // A host answering an HTML error page for /robots.txt is a real thing, and
    // parsing it as robots would produce confident nonsense.
    const http = outcomeHttp(
      outcomeSite({ robots: { status: 200, headers: { "content-type": "text/html" }, body: "<html>" } }),
    );

    const observation = await observePublicProduct(expected(), http);
    const robots = observation.byResource.get("robots_txt");

    expect(robots?.reachable).toBe(false);
    if (robots && !robots.reachable) expect(robots.transportError).toBe("unsupported_content_type");
  });

  it("records the origin that actually answered", async () => {
    const http = outcomeHttp(
      {
        [`${OUTCOME_ORIGIN}/robots.txt`]: redirectResponse("https://www.product.test/robots.txt"),
        [`${OUTCOME_ORIGIN}/sitemap.xml`]: redirectResponse("https://www.product.test/sitemap.xml"),
        "https://www.product.test/robots.txt": textResponse(robotsBody()),
        "https://www.product.test/sitemap.xml": xmlResponse(sitemapBody([OUTCOME_ORIGIN])),
      },
      { [OUTCOME_HOSTNAME]: [OUTCOME_ADDRESS], "www.product.test": [OUTCOME_ADDRESS] },
    );

    const observation = await observePublicProduct(expected(), http);

    expect(observation.effectiveOrigin).toBe("https://www.product.test");
  });
});

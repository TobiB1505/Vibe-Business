import { describe, expect, it } from "vitest";
import { isPathAllowed, parseRobots } from "./robots";
import { parseSitemap } from "./sitemap";
import { isSnapshotFresh, SNAPSHOT_FRESHNESS_MS } from "./store";

describe("parseRobots", () => {
  it("parses rules, sitemaps and crawl delay", () => {
    const policy = parseRobots(`
# comment
User-agent: *
Disallow: /admin
Allow: /admin/public
Crawl-delay: 2

Sitemap: https://acme.test/sitemap.xml
`);

    expect(policy.exists).toBe(true);
    expect(policy.rules).toEqual([
      { type: "disallow", path: "/admin" },
      { type: "allow", path: "/admin/public" },
    ]);
    expect(policy.sitemaps).toEqual(["https://acme.test/sitemap.xml"]);
    expect(policy.crawlDelaySeconds).toBe(2);
  });

  it("prefers a group naming our crawler over the wildcard group", () => {
    const policy = parseRobots(`
User-agent: *
Disallow: /

User-agent: VibeBusinessBot
Disallow: /private
`);

    expect(policy.rules).toEqual([{ type: "disallow", path: "/private" }]);
    expect(policy.blanketDisallow).toBe(false);
  });

  it("detects a blanket disallow", () => {
    expect(parseRobots("User-agent: *\nDisallow: /").blanketDisallow).toBe(true);
  });

  it("does not treat an empty Disallow as a blanket disallow", () => {
    expect(parseRobots("User-agent: *\nDisallow:").blanketDisallow).toBe(false);
  });

  it("shares one rule group across consecutive user-agent lines", () => {
    const policy = parseRobots("User-agent: a\nUser-agent: *\nDisallow: /x");
    expect(policy.rules).toEqual([{ type: "disallow", path: "/x" }]);
  });

  it("ignores comments and malformed lines", () => {
    const policy = parseRobots("# just a comment\ngarbage line\nUser-agent: *\nDisallow: /x");
    expect(policy.rules).toEqual([{ type: "disallow", path: "/x" }]);
  });
});

describe("isPathAllowed", () => {
  const policy = parseRobots("User-agent: *\nDisallow: /admin\nAllow: /admin/public\nDisallow: /*.json$");

  it("allows paths no rule matches", () => {
    expect(isPathAllowed(policy, "/pricing")).toBe(true);
  });

  it("blocks a disallowed prefix", () => {
    expect(isPathAllowed(policy, "/admin")).toBe(false);
    expect(isPathAllowed(policy, "/admin/secret")).toBe(false);
  });

  it("lets a longer Allow rule win", () => {
    expect(isPathAllowed(policy, "/admin/public")).toBe(true);
  });

  it("supports wildcard and end-anchor patterns", () => {
    expect(isPathAllowed(policy, "/data/export.json")).toBe(false);
    expect(isPathAllowed(policy, "/data/export.json.html")).toBe(true);
  });

  it("allows everything when robots.txt does not exist", () => {
    expect(isPathAllowed(parseRobots(""), "/anything")).toBe(true);
  });
});

describe("parseSitemap", () => {
  it("extracts urlset locations", () => {
    const document = parseSitemap(
      `<urlset><url><loc>https://acme.test/a</loc></url><url><loc>https://acme.test/b</loc></url></urlset>`,
      100,
    );
    expect(document.kind).toBe("urlset");
    expect(document.urls).toEqual(["https://acme.test/a", "https://acme.test/b"]);
  });

  it("recognises a sitemap index", () => {
    const document = parseSitemap(`<sitemapindex><sitemap><loc>https://acme.test/s1.xml</loc></sitemap></sitemapindex>`, 100);
    expect(document.kind).toBe("sitemapindex");
  });

  it("unwraps CDATA", () => {
    const document = parseSitemap(`<urlset><url><loc><![CDATA[https://acme.test/a]]></loc></url></urlset>`, 100);
    expect(document.urls).toEqual(["https://acme.test/a"]);
  });

  it("truncates at the URL budget", () => {
    const entries = Array.from({ length: 50 }, (_, index) => `<url><loc>https://acme.test/${index}</loc></url>`).join("");
    const document = parseSitemap(`<urlset>${entries}</urlset>`, 10);
    expect(document.urls).toHaveLength(10);
    expect(document.truncated).toBe(true);
  });

  it("returns nothing useful for junk input rather than throwing", () => {
    expect(() => parseSitemap("not xml at all", 10)).not.toThrow();
    expect(parseSitemap("not xml at all", 10).urls).toEqual([]);
  });
});

describe("snapshot freshness", () => {
  const now = Date.parse("2026-08-10T12:00:00.000Z");

  it("treats a recent snapshot as fresh", () => {
    expect(isSnapshotFresh("2026-08-10T11:00:00.000Z", now)).toBe(true);
  });

  it("treats a snapshot older than the window as stale", () => {
    expect(isSnapshotFresh(new Date(now - SNAPSHOT_FRESHNESS_MS - 1000).toISOString(), now)).toBe(false);
  });

  it("treats a missing or unparseable timestamp as stale", () => {
    expect(isSnapshotFresh(null, now)).toBe(false);
    expect(isSnapshotFresh("not a date", now)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { generateSeoFoundations } from "./generators/nextjs-seo-foundations";
import { checkWritePath, checkWritePaths } from "./paths";
import { FIXTURE_ROUTES, fakeRoute } from "./test-support";

/**
 * Path safety and the deterministic generator (Sprint 9 §11, §13, §32, §41).
 *
 * The property under test is that a repository path cannot come from anywhere
 * except capability code. The generator half proves paths are composed, not
 * accepted; the allowlist half proves that even a hostile path would be
 * refused if it somehow arrived.
 */

const CAPABILITY = "nextjs_seo_foundations_v2" as const;

describe("write path allowlist (§13)", () => {
  it("allows exactly the two files this capability creates", () => {
    expect(checkWritePath("src/app/robots.ts", CAPABILITY)).toEqual({ ok: true });
    expect(checkWritePath("app/sitemap.ts", CAPABILITY)).toEqual({ ok: true });
  });

  it.each([
    ".github/workflows/deploy.yml",
    "src/app/../../.github/workflows/deploy.yml",
    ".env",
    ".env.local",
    "package.json",
    "pnpm-lock.yaml",
    "next.config.ts",
    "src/proxy.ts",
    "supabase/migrations/0001_drop.sql",
  ])("refuses %s", (path) => {
    expect(checkWritePath(path, CAPABILITY).ok).toBe(false);
  });

  it.each([
    ["an absolute path", "/etc/passwd"],
    ["a windows path", "C:\\windows\\system32"],
    ["a backslash path", "src\\app\\robots.ts"],
    ["parent traversal", "src/app/../../../secrets.ts"],
    ["a bare traversal", "../robots.ts"],
    ["an empty segment", "src//app/robots.ts"],
  ])("refuses %s", (_label, path) => {
    expect(checkWritePath(path, CAPABILITY).ok).toBe(false);
  });

  it("refuses a file this capability does not own, even in the right place", () => {
    expect(checkWritePath("src/app/page.tsx", CAPABILITY)).toEqual({
      ok: false,
      reason: "not_allowed_for_capability",
    });
    expect(checkWritePath("src/app/layout.tsx", CAPABILITY).ok).toBe(false);
  });

  it("refuses an allowed basename outside an app directory", () => {
    // The capability writes App Router metadata routes. `robots.ts` in a
    // library folder is the Sprint 8 false positive wearing a different hat.
    expect(checkWritePath("src/modules/live-product-intelligence/robots.ts", CAPABILITY).ok).toBe(false);
    expect(checkWritePath("robots.ts", CAPABILITY).ok).toBe(false);
  });

  it("fails a whole change when any single path is rejected", () => {
    const result = checkWritePaths(["src/app/robots.ts", ".github/workflows/x.yml"], CAPABILITY);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.path).toBe(".github/workflows/x.yml");
  });
});

describe("deterministic generator (§10, §11)", () => {
  const files = generateSeoFoundations({ origin: "https://acme.com", appRoot: "src/app/", routes: FIXTURE_ROUTES });

  it("produces exactly the two supported files", () => {
    expect(files.map((file) => file.path)).toEqual(["src/app/robots.ts", "src/app/sitemap.ts"]);
  });

  it("produces byte-identical output for identical input", () => {
    // This is what makes post-write verification meaningful: a changed hash
    // means the repository disagrees with us, not that we are nondeterministic.
    const again = generateSeoFoundations({ origin: "https://acme.com", appRoot: "src/app/", routes: FIXTURE_ROUTES });

    expect(again.map((file) => file.contentHash)).toEqual(files.map((file) => file.contentHash));
  });

  it("writes the verified production origin, never a placeholder", () => {
    const source = files.map((file) => file.content).join("\n");

    expect(source).toContain("https://acme.com/sitemap.xml");
    expect(source).not.toMatch(/example\.com|acme\.test|TODO|PLACEHOLDER/i);
  });

  it("normalizes a trailing slash rather than emitting a double slash", () => {
    const [robots] = generateSeoFoundations({ origin: "https://acme.com/", appRoot: "src/app", routes: [] });

    expect(robots.content).toContain("https://acme.com/sitemap.xml");
    expect(robots.content).not.toContain("acme.com//");
  });

  it("keeps authenticated and internal routes out of the sitemap (§11)", () => {
    const sitemap = files[1].content;

    expect(sitemap).not.toContain("/app");
    expect(sitemap).not.toContain("/api");
    expect(sitemap).not.toContain("/admin");
  });

  it("disallows private prefixes in robots", () => {
    expect(files[0].content).toContain('"/app/"');
    expect(files[0].content).toContain('"/api/"');
  });

  it("adds no dependencies and touches no manifest", () => {
    const source = files.map((file) => file.content).join("\n");

    expect(source).not.toContain("package.json");
    expect(source).not.toMatch(/\bnpm install\b|\bpnpm add\b/);
    // The only import is the framework's own type.
    expect(source.match(/^import /gm)).toEqual(['import ', 'import '].map(() => "import "));
  });

  it("emits paths the allowlist accepts", () => {
    expect(checkWritePaths(files.map((file) => file.path), CAPABILITY)).toEqual({ ok: true });
  });

  it("publishes only classified public routes (§3, §11)", () => {
    // FIXTURE_ROUTES is a typical SaaS shape: marketing pages plus the auth,
    // app, API and dynamic surfaces that must never reach a sitemap.
    const sitemap = files[1].content;

    expect(sitemap).toContain('url: "https://acme.com"');
    expect(sitemap).toContain('url: "https://acme.com/pricing"');
    expect(sitemap).toContain('url: "https://acme.com/blog"');

    for (const excluded of ["/login", "/signup", "/app", "/api", "[slug]", "[projectId]"]) {
      expect(sitemap).not.toContain(excluded);
    }
  });

  it("emits only the site root when no public routes are evidenced (§6)", () => {
    // The Vibe Business shape: a marketing root, then nothing but auth and the
    // signed-in product. A one-entry sitemap is the correct answer, not a bug.
    const [, sitemap] = generateSeoFoundations({
      origin: "https://acme.com",
      appRoot: "src/app/",
      routes: [
        fakeRoute("/"),
        fakeRoute("/login"),
        fakeRoute("/signup"),
        fakeRoute("/app"),
        fakeRoute("/app/projects/[projectId]", { dynamic: true }),
        fakeRoute("/api/webhook", { kind: "api" }),
      ],
    });

    expect(sitemap.content.match(/url: "/g)).toHaveLength(1);
    expect(sitemap.content).toContain('url: "https://acme.com"');
  });

  it("is deterministic in route order", () => {
    const forward = generateSeoFoundations({
      origin: "https://acme.com",
      appRoot: "src/app/",
      routes: FIXTURE_ROUTES,
    });
    const reversed = generateSeoFoundations({
      origin: "https://acme.com",
      appRoot: "src/app/",
      routes: [...FIXTURE_ROUTES].reverse(),
    });

    expect(reversed[1].contentHash).toBe(forward[1].contentHash);
  });

  it("emits valid Next.js sitemap change frequencies", () => {
    // Checked against the 16.3.0 metadata-route documentation: the allowed set
    // is always|hourly|daily|weekly|monthly|yearly|never.
    const frequencies = [...files[1].content.matchAll(/changeFrequency: "([^"]+)"/g)].map((m) => m[1]);

    expect(frequencies.length).toBeGreaterThan(0);
    for (const frequency of frequencies) {
      expect(["always", "hourly", "daily", "weekly", "monthly", "yearly", "never"]).toContain(frequency);
    }
  });

  it("does not disallow authentication routes in robots (§10)", () => {
    // Omitted from the sitemap is not the same claim as blocked from crawling.
    // Conflating them is how a generator quietly breaks a customer's site.
    expect(files[0].content).not.toContain("/login");
    expect(files[0].content).not.toContain("/signup");
  });

  it("respects a resolved monorepo app root", () => {
    const workspace = generateSeoFoundations({ origin: "https://acme.com", appRoot: "apps/web/app/", routes: [] });

    expect(workspace.map((file) => file.path)).toEqual([
      "apps/web/app/robots.ts",
      "apps/web/app/sitemap.ts",
    ]);
    expect(checkWritePaths(workspace.map((file) => file.path), CAPABILITY)).toEqual({ ok: true });
  });
});

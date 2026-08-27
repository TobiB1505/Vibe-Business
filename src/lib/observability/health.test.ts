import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { config as proxyConfig } from "@/proxy";
import { buildIdentity } from "./health";

/**
 * VB-034 — the health endpoint says which build is serving and nothing else.
 *
 * The tests are about what is *absent*. An unauthenticated public route is one
 * of the few places in this application where a stray field is a disclosure
 * rather than a bug, so the interesting assertions are the negative ones.
 */

describe("what it reports", () => {
  it("names the deployed commit in short form", () => {
    const identity = buildIdentity({
      VERCEL_GIT_COMMIT_SHA: "8a6fc8ce584552bb36352f2a0cada39de2b35a0f",
      VERCEL_ENV: "production",
    });

    expect(identity).toEqual({ commit: "8a6fc8c", environment: "production" });
  });

  it("says so plainly when the build is unknown, rather than inventing one", () => {
    expect(buildIdentity({ VERCEL_ENV: "preview" }).commit).toBeNull();
  });

  it("accepts a non-Vercel runner's variable", () => {
    const identity = buildIdentity({ GIT_COMMIT_SHA: "abcdef1234567" });
    expect(identity.commit).toBe("abcdef1");
  });

  it("treats an empty variable as absent rather than as an empty build", () => {
    expect(buildIdentity({ VERCEL_GIT_COMMIT_SHA: "   " }).commit).toBeNull();
  });
});

describe("what it must never report", () => {
  /**
   * The failure this shape exists to prevent: somebody spreads an env object
   * or a config into the response and a key nobody looked at goes public.
   */
  it("carries exactly two fields, whatever is in the environment", () => {
    const identity = buildIdentity({
      VERCEL_GIT_COMMIT_SHA: "abc1234",
      VERCEL_ENV: "production",
      SUPABASE_SERVICE_ROLE_KEY: "eyJhbGciOiJIUzI1NiJ9.body.sig",
      ANTHROPIC_API_KEY: "sk-ant-api03-AAAAAAAAAAAAAAAA",
      STRIPE_SECRET_KEY: "sk_live_ABCDEFGHIJKL",
      NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
    });

    expect(Object.keys(identity).sort()).toEqual(["commit", "environment"]);
    expect(JSON.stringify(identity)).not.toContain("supabase.co");
    expect(JSON.stringify(identity)).not.toMatch(/sk-ant|sk_live|eyJ/);
  });

  it("reports the tier, never the hostname it is reachable at", () => {
    const identity = buildIdentity({
      NEXT_PUBLIC_APP_URL: "https://internal-staging.vibe.business",
    });

    expect(identity.environment).toBe("production");
    expect(JSON.stringify(identity)).not.toContain("internal-staging");
  });
});

describe("the route", () => {
  const source = readFileSync(
    join(process.cwd(), "src", "app", "api", "health", "route.ts"),
    "utf8",
  );

  /**
   * The route must not grow its own reader of the environment — that is the
   * path by which the closed set above stops being closed.
   */
  it("builds its body only from the identity helper", () => {
    expect(source).toContain("buildIdentity()");
    expect(source).not.toMatch(/process\.env/);
  });

  /**
   * Rule 53, restated where it would be tempting to break: an unauthenticated
   * public route is the worst possible home for an RLS-bypassing client.
   */
  it("obtains no database client at all", () => {
    expect(source).not.toContain("createServiceClient");
    expect(source).not.toContain("@/lib/supabase");
  });

  it("is not cached, because a cached liveness answer is about the past", () => {
    expect(source).toContain('dynamic = "force-dynamic"');
    expect(source).toContain("no-store");
  });
});

describe("the probe is reachable without auth", () => {
  /**
   * A liveness endpoint behind a session refresh reports the auth provider's
   * health, not the application's — and pays a third-party round trip on every
   * probe. The exclusion is in a regex, so it is asserted rather than read.
   */
  const matcher = new RegExp(`^${proxyConfig.matcher[0]}$`);

  it("does not run the session proxy for the health route", () => {
    expect(matcher.test("/api/health")).toBe(false);
  });

  it("still runs it for the pages that need a session", () => {
    expect(matcher.test("/app")).toBe(true);
    expect(matcher.test("/app/projects/abc")).toBe(true);
    expect(matcher.test("/login")).toBe(true);
  });

  it("still runs it for the other API routes, which are not liveness probes", () => {
    expect(matcher.test("/api/billing/stripe/webhook")).toBe(true);
  });
});

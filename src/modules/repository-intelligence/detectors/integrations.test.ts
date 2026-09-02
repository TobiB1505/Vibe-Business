import { describe, expect, it } from "vitest";
import { detectIntegrationSignals } from "./integrations";
import { contextFrom, packageJson } from "../test-support";

function ids(signals: { id: string }[]): string[] {
  return signals.map((signal) => signal.id);
}

describe("detectIntegrationSignals", () => {
  it("detects Supabase from dependency and config", () => {
    const context = contextFrom([
      {
        path: "package.json",
        content: packageJson({
          dependencies: { "@supabase/supabase-js": "2", "@supabase/ssr": "0.12" },
        }),
      },
      { path: "supabase/config.toml" },
    ]);

    const supabase = detectIntegrationSignals(context).find((signal) => signal.id === "supabase");
    expect(supabase?.category).toBe("database");
    expect(supabase?.confidence).toBe("high");
    expect(supabase?.evidence).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "supabase/config.toml" })]),
    );
  });

  it("detects Vercel from vercel.json alone with medium confidence", () => {
    const context = contextFrom([{ path: "vercel.json" }]);
    const vercel = detectIntegrationSignals(context).find((signal) => signal.id === "vercel");
    expect(vercel?.category).toBe("deployment");
    expect(vercel?.confidence).toBe("medium");
  });

  it("detects Stripe from a dependency", () => {
    const context = contextFrom([
      { path: "package.json", content: packageJson({ dependencies: { stripe: "16" } }) },
    ]);

    const stripe = detectIntegrationSignals(context).find((signal) => signal.id === "stripe");
    expect(stripe?.category).toBe("payments");
    expect(stripe?.evidence[0]).toMatchObject({ kind: "manifest_dependency", detail: "stripe" });
  });

  it("detects analytics integrations", () => {
    const context = contextFrom([
      {
        path: "package.json",
        content: packageJson({ dependencies: { "posthog-js": "1", "@vercel/analytics": "1" } }),
      },
    ]);

    expect(ids(detectIntegrationSignals(context))).toEqual(
      expect.arrayContaining(["posthog", "vercel_analytics"]),
    );
  });

  it("detects Sentry monitoring", () => {
    const context = contextFrom([
      { path: "package.json", content: packageJson({ dependencies: { "@sentry/nextjs": "8" } }) },
    ]);
    expect(ids(detectIntegrationSignals(context))).toContain("sentry");
  });

  // Regression: @supabase/ssr is the cookie-session helper, so a project
  // using it has Supabase Auth even without an auth-helpers package.
  it("detects Supabase Auth from @supabase/ssr", () => {
    const context = contextFrom([
      {
        path: "package.json",
        content: packageJson({
          dependencies: { "@supabase/ssr": "0.12.4", "@supabase/supabase-js": "2" },
        }),
      },
    ]);

    const signals = detectIntegrationSignals(context);
    const auth = signals.find((signal) => signal.id === "supabase_auth");
    expect(auth?.category).toBe("auth");
    expect(auth?.confidence).toBe("high");
  });

  it("detects auth providers distinctly", () => {
    const context = contextFrom([
      { path: "package.json", content: packageJson({ dependencies: { "@clerk/nextjs": "5" } }) },
    ]);

    const signals = detectIntegrationSignals(context);
    expect(ids(signals)).toContain("clerk");
    expect(ids(signals)).not.toContain("authjs");
  });

  it("produces no false positives for an unrelated repository", () => {
    const context = contextFrom([
      { path: "package.json", content: packageJson({ dependencies: { lodash: "4" } }) },
      { path: "README.md" },
    ]);

    expect(detectIntegrationSignals(context)).toEqual([]);
  });

  it("does not detect Stripe merely because prose mentions it", () => {
    const context = contextFrom([
      { path: "README.md", content: "We plan to add Stripe billing next quarter." },
      { path: "package.json", content: packageJson({ dependencies: {} }) },
    ]);

    expect(ids(detectIntegrationSignals(context))).not.toContain("stripe");
  });

  it("detects Python-side integrations from a requirements manifest", () => {
    const context = contextFrom([
      { path: "requirements.txt", content: "stripe==10.0\nsentry-sdk\n" },
    ]);
    expect(ids(detectIntegrationSignals(context))).toEqual(
      expect.arrayContaining(["stripe", "sentry"]),
    );
  });

  it("attaches every signal to a category", () => {
    const context = contextFrom([
      {
        path: "package.json",
        content: packageJson({
          dependencies: { stripe: "16", "@supabase/supabase-js": "2", "posthog-js": "1" },
        }),
      },
    ]);

    for (const signal of detectIntegrationSignals(context)) {
      expect(["deployment", "database", "auth", "payments", "analytics", "monitoring"]).toContain(
        signal.category,
      );
      expect(signal.evidence.length).toBeGreaterThan(0);
    }
  });
});

/* ---------------------------------------------------------------------------
 * Sprint 0081 — the four categories the analyzer could not see
 * ------------------------------------------------------------------------ */

describe("test tooling", () => {
  it("detects Vitest from its dependency and its config together", () => {
    const context = contextFrom([
      { path: "package.json", content: packageJson({ devDependencies: { vitest: "4" } }) },
      { path: "vitest.config.mts" },
    ]);

    const vitest = detectIntegrationSignals(context).find((signal) => signal.id === "vitest");
    expect(vitest?.category).toBe("testing");
    expect(vitest?.confidence).toBe("high");
  });

  it("detects pytest from a Python manifest, where no package.json exists", () => {
    const context = contextFrom([
      { path: "pyproject.toml", content: "[tool.pytest.ini_options]\ntestpaths = ['tests']\n" },
    ]);

    expect(ids(detectIntegrationSignals(context))).toContain("pytest");
  });

  it("says nothing about testing for a repository that has none", () => {
    const context = contextFrom([
      { path: "package.json", content: packageJson({ dependencies: { next: "16" } }) },
    ]);

    const testing = detectIntegrationSignals(context).filter(
      (signal) => signal.category === "testing",
    );
    expect(testing).toEqual([]);
  });
});

describe("continuous integration", () => {
  it("detects GitHub Actions from a directory no basename rule could match", () => {
    const context = contextFrom([
      { path: ".github/workflows/ci.yml" },
      { path: ".github/workflows/release.yaml" },
    ]);

    const actions = detectIntegrationSignals(context).find(
      (signal) => signal.id === "github_actions",
    );
    expect(actions?.category).toBe("ci");
    expect(actions?.evidence.map((entry) => entry.path)).toEqual([
      ".github/workflows/ci.yml",
      ".github/workflows/release.yaml",
    ]);
  });

  it("caps and sorts workflow evidence, so tree order cannot change a snapshot", () => {
    const paths = ["d.yml", "b.yml", "e.yml", "a.yml", "c.yml"].map((name) => ({
      path: `.github/workflows/${name}`,
    }));

    const actions = detectIntegrationSignals(contextFrom(paths)).find(
      (signal) => signal.id === "github_actions",
    );
    expect(actions?.evidence.map((entry) => entry.path)).toEqual([
      ".github/workflows/a.yml",
      ".github/workflows/b.yml",
      ".github/workflows/c.yml",
    ]);
  });

  it("does not mistake a workflow-shaped path outside the workflows directory", () => {
    const context = contextFrom([
      { path: "docs/.github/workflows/example.yml" },
      { path: ".github/ISSUE_TEMPLATE/bug.yml" },
    ]);

    expect(ids(detectIntegrationSignals(context))).not.toContain("github_actions");
  });

  it("detects the single-file providers from their basenames", () => {
    const context = contextFrom([
      { path: ".gitlab-ci.yml" },
      { path: "Jenkinsfile" },
      { path: ".circleci/config.yml" },
    ]);

    const found = ids(detectIntegrationSignals(context));
    expect(found).toContain("gitlab_ci");
    expect(found).toContain("jenkins");
    expect(found).toContain("circleci");
  });
});

describe("e-mail sending and feature flagging", () => {
  it("detects Resend and LaunchDarkly from their dependencies", () => {
    const context = contextFrom([
      {
        path: "package.json",
        content: packageJson({
          dependencies: { resend: "4", "launchdarkly-node-server-sdk": "9" },
        }),
      },
    ]);

    const signals = detectIntegrationSignals(context);
    expect(signals.find((signal) => signal.id === "resend")?.category).toBe("email");
    expect(signals.find((signal) => signal.id === "launchdarkly")?.category).toBe("feature_flags");
  });
});

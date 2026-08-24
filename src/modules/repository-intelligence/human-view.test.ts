import { describe, expect, it } from "vitest";
import { buildRepositoryHumanView, type RepositoryCapability } from "./human-view";
import type {
  BusinessSurfaceId,
  IntegrationSignal,
  RepositoryIntelligenceSnapshot,
  RouteIntelligence,
  SignalCategory,
} from "./schema";

/**
 * The human-facing repository view (Sprint UI-3.6).
 *
 * Three properties, and the second is the one this sprint exists for:
 *
 * 1. **It is a translation, not a generator.** Every sentence is derived from
 *    the snapshot.
 * 2. **Code is never presented as runtime truth.** A `stripe` dependency does
 *    not mean anyone can pay. The strongest thing this view may say is
 *    "likely", and the wording has to carry that too.
 * 3. **Nothing technical is lost.** Every detection, evidence path and scan
 *    metric survives into the technical layer with its exact value.
 */

function signal(
  id: string,
  category: SignalCategory,
  path = "package.json",
  detail = id,
): IntegrationSignal {
  return {
    id,
    name: id,
    category,
    confidence: "high",
    evidence: [{ kind: "manifest_dependency", path, detail }],
  };
}

function surfaces(detected: Partial<Record<BusinessSurfaceId, boolean>>) {
  const all: BusinessSurfaceId[] = [
    "authentication",
    "payments",
    "pricing_page",
    "checkout_billing",
    "analytics",
    "seo_metadata",
    "sitemap",
    "robots",
    "blog_content",
    "contact",
    "docs_help",
    "legal",
    "onboarding",
    "dashboard_app",
  ];

  return all.map((id) => ({
    id,
    name: id,
    detected: detected[id] === true,
    confidence: "high" as const,
    evidence: detected[id] === true ? [{ kind: "file_path" as const, path: `src/app/${id}/page.tsx` }] : [],
  }));
}

function routes(paths: string[], mode: RouteIntelligence["mode"] = "app_router"): RouteIntelligence {
  return {
    mode,
    routes: paths.map((path) => ({
      path,
      kind: "page" as const,
      dynamic: false,
      sourcePath: `src/app${path === "/" ? "" : path}/page.tsx`,
    })),
    truncated: false,
  };
}

function snapshot(overrides: Partial<RepositoryIntelligenceSnapshot> = {}) {
  return {
    schemaVersion: "repository_intelligence.v1",
    source: {
      commitSha: "a".repeat(40),
      branch: "main",
      analyzerVersion: "repo-intelligence-v2",
      treeComplete: true,
    },
    repository: { fullName: "acme/product", defaultBranch: "main", private: true },
    completeness: { status: "complete", reasons: [] },
    projectStructure: {
      totalTreeEntries: 812,
      sourceFileCount: 431,
      topLevelDirectories: ["src", "public"],
      monorepo: { detected: false, tool: null, apps: [], packages: [], evidence: [], ambiguous: false },
    },
    languages: [{ id: "typescript", name: "TypeScript", confidence: "high", evidence: [] }],
    frameworks: [{ id: "nextjs", name: "Next.js", confidence: "high", evidence: [] }],
    packageManager: "pnpm",
    runtime: [],
    integrationSignals: [
      signal("supabase_auth", "auth", "package.json", "@supabase/ssr"),
      signal("stripe", "payments", "package.json", "stripe"),
      signal("supabase", "database", "package.json", "@supabase/supabase-js"),
    ],
    routes: routes(["/", "/login", "/signup"]),
    businessSurfaces: surfaces({ authentication: true, payments: true }),
    metrics: {
      treeEntriesConsidered: 812,
      candidatesSelected: 12,
      filesFetched: 4,
      bytesFetched: 27_264,
      durationMs: 1081,
    },
    warnings: [],
    ...overrides,
  } as unknown as RepositoryIntelligenceSnapshot;
}

function capability(view: ReturnType<typeof buildRepositoryHumanView>, id: string): RepositoryCapability {
  const found = view.capabilities.find((item) => item.id === id);
  if (!found) throw new Error(`no capability ${id}`);
  return found;
}

describe("the summary answers a business question", () => {
  it("opens with what Vibe understood, not with what it counted", () => {
    const view = buildRepositoryHumanView(snapshot());

    expect(view.headline).toMatch(/^Vibe understands/);
    // The repository's own vocabulary must not lead.
    for (const jargon of ["repository", "route", "dependency", "framework", "file", "package"]) {
      expect(view.headline.toLowerCase()).not.toContain(jargon);
    }
  });

  it("keeps scan counts out of the headline and the subhead", () => {
    const view = buildRepositoryHumanView(snapshot());
    const leading = `${view.headline} ${view.subhead}`;

    for (const count of ["431", "812", "27264", "1081", "4"]) {
      expect(leading).not.toContain(count);
    }
  });

  it("counts only capabilities it actually derived", () => {
    const view = buildRepositoryHumanView(snapshot());
    const total = view.counts.exists + view.counts.needsChecking + view.counts.notFound;

    expect(total).toBe(view.capabilities.length);
    expect(view.counts.exists).toBe(
      view.capabilities.filter((item) => item.status === "likely").length,
    );
  });

  it("groups what exists before what needs checking before what is missing", () => {
    const view = buildRepositoryHumanView(snapshot());

    expect(view.groups.map((group) => group.id)).toEqual(["exists", "needs-checking", "not-found"]);
    for (const group of view.groups) {
      expect(group.capabilities.length).toBeGreaterThan(0);
    }
  });

  it("counts what needs attention in the headline, not what the tally counts", () => {
    // The tally beside the headline counts statuses; the headline counts
    // problems. A headline that repeated the tally with a different number
    // would read as the screen contradicting itself.
    const view = buildRepositoryHumanView(snapshot());
    const attention = view.capabilities.filter((item) => item.tone === "attention").length;

    expect(view.headline).toContain(`${attention} thing`);
    expect(view.headline).toContain("your attention");
    expect(attention).not.toBe(view.counts.notFound);
  });

  it("says plainly when it recognised nothing rather than inventing understanding", () => {
    const view = buildRepositoryHumanView(
      snapshot({
        integrationSignals: [],
        businessSurfaces: surfaces({}),
        routes: routes([]),
      } as unknown as Partial<RepositoryIntelligenceSnapshot>),
    );

    expect(view.headline).toContain("couldn't recognise");
    expect(view.tone).toBe("attention");
  });

  it("never flatters, even with nothing to report", () => {
    const view = buildRepositoryHumanView(snapshot());

    for (const forbidden of ["great", "awesome", "perfect", "all good", "well done"]) {
      expect(view.headline.toLowerCase()).not.toContain(forbidden);
    }
  });
});

describe("accounts", () => {
  it("maps auth code plus both pages to one readable conclusion", () => {
    const accounts = capability(buildRepositoryHumanView(snapshot()), "accounts");

    expect(accounts.title).toBe("Customers can create an account and sign in.");
    expect(accounts.status).toBe("likely");
    expect(accounts.found).toContain("A sign-up page");
    // The raw signal must not surface as the conclusion.
    expect(accounts.found.join(" ")).not.toContain("@supabase/ssr");
    expect(accounts.found.join(" ")).not.toContain("supabase_auth");
  });

  it("never claims accounts work — only that the code exists", () => {
    const accounts = capability(buildRepositoryHumanView(snapshot()), "accounts");

    for (const overclaim of ["works", "is working", "verified", "confirmed"]) {
      expect(accounts.title.toLowerCase()).not.toContain(overclaim);
    }
    expect(accounts.status).not.toBe("confirmed");
  });

  it("does not turn auth code alone into a complete flow", () => {
    const view = buildRepositoryHumanView(
      snapshot({ routes: routes(["/"]) } as unknown as Partial<RepositoryIntelligenceSnapshot>),
    );
    const accounts = capability(view, "accounts");

    expect(accounts.status).toBe("partial");
    expect(accounts.title).toContain("couldn't confirm");
    expect(accounts.nextStep?.target).toBe("live-product");
  });

  it("says pages are unclear, not absent, when routes could not be read", () => {
    const view = buildRepositoryHumanView(
      snapshot({
        routes: { mode: "limited", routes: [], truncated: false },
      } as unknown as Partial<RepositoryIntelligenceSnapshot>),
    );
    const accounts = capability(view, "accounts");

    // Claiming "not found: a sign-up page" for pages that were never looked
    // at is the overclaim this guard exists for.
    expect(accounts.missing).not.toContain("a sign-up page");
    expect(accounts.basis).toContain("couldn't work out this project's pages");
  });
});

describe("getting paid", () => {
  it("does not let a payment dependency claim customers can buy", () => {
    const paid = capability(buildRepositoryHumanView(snapshot()), "getting-paid");

    expect(paid.status).toBe("partial");
    expect(paid.title).toContain("isn't clear yet");
    for (const overclaim of ["your payment system works", "customers can pay", "payments work"]) {
      expect(paid.title.toLowerCase()).not.toContain(overclaim);
    }
  });

  it("says a payment flow exists only when a buying page exists too", () => {
    const view = buildRepositoryHumanView(
      snapshot({
        businessSurfaces: surfaces({ payments: true, pricing_page: true, checkout_billing: true }),
      } as unknown as Partial<RepositoryIntelligenceSnapshot>),
    );
    const paid = capability(view, "getting-paid");

    expect(paid.status).toBe("likely");
    expect(paid.title).toBe("Your product contains a payment flow.");
    // Even at its strongest, it points at the check that could confirm it.
    expect(paid.nextStep?.target).toBe("live-product");
  });

  it("states the business consequence when there is no way to pay", () => {
    const view = buildRepositoryHumanView(
      snapshot({
        integrationSignals: [],
        businessSurfaces: surfaces({}),
      } as unknown as Partial<RepositoryIntelligenceSnapshot>),
    );
    const paid = capability(view, "getting-paid");

    expect(paid.status).toBe("not_found");
    expect(paid.title).toBe("Vibe couldn't find a way for customers to pay you yet.");
    expect(paid.whyItMatters).toContain("cannot make money");
    expect(paid.tone).toBe("attention");
    expect(paid.nextStep?.target).toBe("next-moves");
  });
});

describe("analytics", () => {
  it("says Vibe couldn't find it rather than that it does not exist", () => {
    const analytics = capability(buildRepositoryHumanView(snapshot()), "understanding-customers");

    expect(analytics.status).toBe("not_found");
    expect(analytics.basis).toContain("couldn't find");
    // "You don't have analytics" is a claim about the product; this is a
    // claim about what Vibe saw.
    expect(analytics.basis).not.toMatch(/you (do not|don't) have/i);
    expect(analytics.title).toContain("may not know");
  });

  it("explains why it matters for the business", () => {
    const analytics = capability(buildRepositoryHumanView(snapshot()), "understanding-customers");

    expect(analytics.whyItMatters).toBeTruthy();
    expect(analytics.whyItMatters).toContain("give up");
  });

  it("reports analytics code as code, not as measurement that is happening", () => {
    const view = buildRepositoryHumanView(
      snapshot({
        integrationSignals: [signal("posthog", "analytics", "package.json", "posthog-js")],
      } as unknown as Partial<RepositoryIntelligenceSnapshot>),
    );
    const analytics = capability(view, "understanding-customers");

    expect(analytics.title).toContain("found code");
    expect(analytics.status).toBe("likely");
  });
});

describe("no capability overclaims", () => {
  it("never reports a runtime fact from repository evidence", () => {
    const view = buildRepositoryHumanView(snapshot());

    for (const item of view.capabilities) {
      expect(["likely", "partial", "unclear", "not_found"]).toContain(item.status);
      for (const claim of ["is working", "works correctly", "verified", "guaranteed"]) {
        expect(`${item.title} ${item.basis}`.toLowerCase()).not.toContain(claim);
      }
    }
  });

  it("explains missing deployment configuration might just live elsewhere", () => {
    const shipping = capability(buildRepositoryHumanView(snapshot()), "shipping");

    expect(shipping.status).toBe("not_found");
    expect(shipping.whyItMatters).toContain("outside the code");
    // Not an alarm: hosting configured in a provider dashboard is normal.
    expect(shipping.tone).toBe("neutral");
  });

  it("does not treat a missing database as a failure", () => {
    const view = buildRepositoryHumanView(
      snapshot({ integrationSignals: [] } as unknown as Partial<RepositoryIntelligenceSnapshot>),
    );

    expect(capability(view, "customer-data").tone).toBe("neutral");
  });
});

describe("nothing technical is lost", () => {
  it("carries every detection id and its confidence into the technical layer", () => {
    const view = buildRepositoryHumanView(snapshot());
    const keys = view.technical.map((entry) => entry.key);

    expect(keys).toContain("framework.nextjs");
    expect(keys).toContain("language.typescript");
    expect(keys).toContain("signal.payments.stripe");
    expect(keys).toContain("signal.auth.supabase_auth");
    expect(keys).toContain("surface.pricing_page");
    expect(keys).toContain("commitSha");
    expect(keys).toContain("sourceFileCount");
  });

  it("preserves exact scan values rather than rounding them for display", () => {
    const view = buildRepositoryHumanView(snapshot());
    const byKey = new Map(view.technical.map((entry) => [entry.key, entry.value]));

    expect(byKey.get("bytesFetched")).toBe(27_264);
    expect(byKey.get("durationMs")).toBe(1081);
    expect(byKey.get("sourceFileCount")).toBe(431);
    expect(byKey.get("monorepoTool")).toBeNull();
  });

  it("gives every technical entry a unique key", () => {
    // `payments` is both an integration category and a business surface;
    // unprefixed, one would silently render where the other was expected.
    const view = buildRepositoryHumanView(snapshot());
    const keys = view.technical.map((entry) => entry.key);

    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keeps evidence paths and dependency names under each capability", () => {
    const view = buildRepositoryHumanView(snapshot());
    const paid = capability(view, "getting-paid");

    expect(paid.evidence.some((item) => item.path === "package.json" && item.detail === "stripe")).toBe(
      true,
    );
  });

  it("deduplicates evidence that cites the same manifest repeatedly", () => {
    const view = buildRepositoryHumanView(
      snapshot({
        integrationSignals: [
          signal("stripe", "payments", "package.json", "stripe"),
          signal("stripe_js", "payments", "package.json", "stripe"),
        ],
      } as unknown as Partial<RepositoryIntelligenceSnapshot>),
    );

    const evidence = capability(view, "getting-paid").evidence;
    expect(evidence.filter((item) => item.detail === "stripe")).toHaveLength(1);
  });

  it("keeps routes and stack names available but out of the conclusions", () => {
    const view = buildRepositoryHumanView(snapshot());

    expect(view.routePaths).toContain("/login");
    expect(view.stackNames).toEqual(["Next.js", "TypeScript"]);
    expect(view.stackSummary).not.toContain("Next.js");
  });
});

describe("an unfinished analysis says so", () => {
  it("reports partial completeness before its results are read", () => {
    const view = buildRepositoryHumanView(
      snapshot({
        completeness: { status: "partial", reasons: ["tree_truncated"] },
      } as unknown as Partial<RepositoryIntelligenceSnapshot>),
    );

    expect(view.incompleteReason).toContain("did not finish");
    expect(view.incompleteReason).toContain("tree_truncated");
  });

  it("is silent when the analysis finished", () => {
    expect(buildRepositoryHumanView(snapshot()).incompleteReason).toBeNull();
  });
});

describe("it is deterministic", () => {
  it("produces identical output for identical input", () => {
    expect(buildRepositoryHumanView(snapshot())).toEqual(buildRepositoryHumanView(snapshot()));
  });
});

/* ---------------------------------------------------------------------------
 * Sprint 0081 — catching mistakes before customers do
 * ------------------------------------------------------------------------ */

describe("the catching-mistakes capability", () => {
  it("reads as good when tooling and a test command are both there", () => {
    const view = buildRepositoryHumanView(
      snapshot({
        integrationSignals: [signal("vitest", "testing")],
        scripts: { declared: ["test", "build"], source: "package.json" },
      }),
    );

    const found = capability(view, "catching-mistakes");
    expect(found.status).toBe("likely");
    expect(found.tone).toBe("good");
    expect(found.found).toContain("A test command in package.json");
  });

  it("does not claim a passing suite — only that the tooling is declared", () => {
    const view = buildRepositoryHumanView(
      snapshot({ integrationSignals: [signal("vitest", "testing")] }),
    );

    const found = capability(view, "catching-mistakes");
    expect(`${found.title} ${found.basis}`).not.toMatch(/pass|passing|green|covered/i);
  });

  it("says CI alone is not a test suite", () => {
    const view = buildRepositoryHumanView(
      snapshot({
        integrationSignals: [signal("github_actions", "ci", ".github/workflows/ci.yml")],
        scripts: { declared: [], source: "package.json" },
      }),
    );

    const found = capability(view, "catching-mistakes");
    expect(found.status).toBe("unclear");
    expect(found.missing).toContain("a test suite");
    expect(found.missing).not.toContain("continuous integration");
  });

  it("warns plainly when a repository has neither", () => {
    const view = buildRepositoryHumanView(
      snapshot({ scripts: { declared: ["build"], source: "package.json" } }),
    );

    const found = capability(view, "catching-mistakes");
    expect(found.status).toBe("not_found");
    expect(found.tone).toBe("attention");
    expect(found.whyItMatters).toContain("nothing in the repository that can tell you");
  });

  it("does not claim a missing test script for a repository with no manifest", () => {
    // A Python project has not declined to declare a `test` script; it has
    // nowhere to declare one. Reported as tooling absent, never as a
    // manifest that omitted something.
    const view = buildRepositoryHumanView(
      snapshot({ scripts: { declared: [], source: null } }),
    );

    expect(capability(view, "catching-mistakes").found).toEqual([]);
  });

  it("renders a stored snapshot that predates the scripts field", () => {
    // `repository_intelligence_snapshots.result` holds whatever analyzer wrote
    // it, and the project page renders the newest successful row whatever
    // version that was. A v3 row reaching this function must not throw.
    const stored = snapshot({ integrationSignals: [signal("vitest", "testing")] });
    delete (stored as { scripts?: unknown }).scripts;

    expect(() => buildRepositoryHumanView(stored)).not.toThrow();
    expect(capability(buildRepositoryHumanView(stored), "catching-mistakes").status).toBe("partial");
  });
});

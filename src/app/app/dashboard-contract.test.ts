import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The dashboard's cost contract (Sprint UI-3).
 *
 * `/app` renders every project the user owns. That makes it the one screen
 * where an expensive per-project read turns into an N+1 the moment someone
 * adds a second project — and the failure is invisible with one project, which
 * is how it would ship.
 *
 * These assert the boundary at the source, the same way the workspace routes'
 * contract does. They are cheap, they run everywhere, and they fail on the
 * commit that introduces the problem rather than on the customer who has six
 * projects.
 */

/**
 * Where the account dashboard renders from.
 *
 * Constants rather than one filename, because the surface has a shell and a
 * composition either side of the page: the credit balance reads in the layout
 * and the screen is assembled in `account-home.tsx`. A test naming only
 * `page.tsx` would have gone quiet the moment either moved — every assertion
 * below would still pass, against a file that no longer performs the reads.
 * Same failure the workspace route contract had when it walked one directory
 * level.
 *
 * So the surface is *derived*: every render file that exists here is guarded,
 * and moving a read from one to another cannot escape the contract.
 */
const ACCOUNT_DIR = join(process.cwd(), "src/app/app/(account)");
const MODULES = join(process.cwd(), "src/modules");

/** Render files, in the order React composes them. */
const SURFACE_FILES = ["layout.tsx", "page.tsx"] as const;

/**
 * Everything else that renders every project the account owns.
 *
 * `account-home.tsx` is the composition `/app` renders — one directory up
 * because the browser harness renders it too. `products/page.tsx` is the full
 * index, which reaches the same read model by a route nobody would think to
 * check. Both are Server Components, so both can `await` anything the page
 * can, and a contract that stopped at one filename would be one `mv` away from
 * guarding nothing.
 */
const CROSS_PROJECT_FILES = [
  ["account-home.tsx", "src/app/app/account-home.tsx"],
  ["products/page.tsx", "src/app/app/(account)/products/page.tsx"],
] as const;

function source(path: string): string {
  return readFileSync(path, "utf8");
}

function accountSurface(): { name: string; source: string }[] {
  const found: { name: string; source: string }[] = SURFACE_FILES.flatMap((name) => {
    const path = join(ACCOUNT_DIR, name);
    return existsSync(path) ? [{ name, source: source(path) }] : [];
  });

  for (const [name, relative] of CROSS_PROJECT_FILES) {
    const path = join(process.cwd(), relative);
    if (!existsSync(path)) {
      throw new Error(
        `${relative} was not found. If it moved, move CROSS_PROJECT_FILES with it — ` +
          "do not delete the assertion.",
      );
    }
    found.push({ name, source: source(path) });
  }

  // A list that quietly came back empty would make every assertion below
  // vacuous. `page.tsx` is the one file that must always be here.
  if (!found.some((file) => file.name === "page.tsx")) {
    throw new Error(
      `the account dashboard's page was not found under ${ACCOUNT_DIR}. ` +
        "If the route moved, move ACCOUNT_DIR with it — do not delete the assertion.",
    );
  }

  return found;
}

const surface = accountSurface();
const readModel = source(join(MODULES, "projects/dashboard.ts"));
const attention = source(join(MODULES, "projects/attention.ts"));

/** Every guarded file: the render surface plus the read model behind it. */
const guarded = [...surface, { name: "dashboard.ts", source: readModel }];

describe("the dashboard is summary-only", () => {
  /**
   * Every one of these is correct and cheap for a single project, and a
   * disaster in a loop over all of them.
   */
  const FORBIDDEN = [
    "getPreparedChangeWorkspace",
    "getProjectImpact",
    "getProjectWorkspaceCounts",
    "buildDeepScanViewModel",
    "getDeepScanAccessStatus",
    "getPreviewCard",
    "getPreviewStatus",
    "getReviewCard",
    "getReviewImages",
    "getApprovalCard",
    "getMergeCard",
    "resolveMergeTarget",
    "getOutcomeCard",
    "getBusinessImpactCard",
    "getLatestSuccessfulAudit",
    "getLatestOpportunities",
    "buildValidationSummary",
  ];

  it("calls no per-project detail read from anywhere on the surface", () => {
    // Both the render files and the read model, because moving the loop one
    // file down would satisfy a page-only assertion while changing nothing
    // about the cost.
    for (const file of guarded) {
      for (const forbidden of FORBIDDEN) {
        expect(file.source, `${file.name} calls ${forbidden}`).not.toContain(`${forbidden}(`);
      }
    }
  });

  it("never reaches for a provider, a sandbox or GitHub", () => {
    for (const file of guarded) {
      expect(file.source, file.name).not.toContain("createVercelSandboxProvider");
      expect(file.source, file.name).not.toContain("createGithubMergePort");
      expect(file.source, file.name).not.toContain("checkInstallationStillAccessible");
      expect(file.source, file.name).not.toContain("VercelWorkflowExecutor");
    }
  });

  it("reads the Credit balance per account, never per project", () => {
    /*
     * BILLING CORE-2 §54, §100. The header balance renders on every signed-in
     * navigation, so its cost is the dashboard's cost.
     *
     * `getHeaderCreditBalance` is account-scoped: one wallet row plus that
     * wallet's active lots, whether the user has one project or sixty. The
     * per-project billing reads are the ones that would turn it into an N+1,
     * and none of them belongs on this page.
     */
    // On the surface, not on one named file: the balance renders in the shell,
    // and the shell is a layout as soon as the account has one.
    expect(
      surface.some((file) => file.source.includes("getHeaderCreditBalance")),
      "no account render file reads getHeaderCreditBalance",
    ).toBe(true);

    for (const file of surface) {
      for (const forbidden of [
        "getBillingOverview",
        "authorizeOperationCredits",
        "checkOperationAffordability",
        "listLedgerEntries",
        "sweepExpiredCredits",
      ]) {
        expect(file.source, `${file.name} calls ${forbidden}`).not.toContain(`${forbidden}(`);
      }
    }
  });

  it("moves no financial state on a page render", () => {
    // §99: a GET must never grant, expire, reserve or charge. The dashboard is
    // a Server Component, so this is that rule stated where it can fail.
    for (const file of guarded) {
      expect(file.source, file.name).not.toContain("ensureWelcomeGrant");
      expect(file.source, file.name).not.toContain("grantCreditLot");
      expect(file.source, file.name).not.toContain("settleOperationCredits");
    }
  });

  it("keeps the service-role client out", () => {
    // It bypasses RLS. A dashboard reading across every project is the last
    // place that should hold a key which ignores ownership.
    for (const file of guarded) {
      expect(file.source, file.name).not.toContain("createServiceRoleClient");
      expect(file.source, file.name).not.toContain("supabase-service");
    }
  });

  it("reads the score from its column, not from the audit document", () => {
    // The stored audit is a large JSONB document with dimensions, evidence and
    // findings. A dashboard needs one integer.
    expect(readModel).toContain("overall_score");
    expect(readModel).not.toContain("result->");
    expect(readModel).not.toContain('select("id, project_id, status, input_hash');
  });
});

describe("the dashboard does not scale its queries with its projects", () => {
  it("filters by a project id list rather than one project at a time", () => {
    expect(readModel).toContain('.in("project_id"');
  });

  it("has no await inside a loop over projects", () => {
    // The N+1 shape, asserted structurally: an `await` inside `for (const
    // … of projects)` is the exact thing this module exists to avoid.
    const loops = readModel.match(/for\s*\(const[^)]*\)\s*\{[\s\S]*?\n  \}/g) ?? [];
    for (const loop of loops) {
      expect(loop, "a loop in dashboard.ts awaits").not.toContain("await ");
    }
  });

  /**
   * An append-only log grows forever, so a dashboard query over one is fine on
   * day one and a full-table scan by month six. This used to be phrased as
   * "the `audit_events` read is bounded"; CORE-6 removed that read entirely
   * when the activity strip left the account dashboard, so the stronger and
   * simpler statement is now true and is what gets asserted.
   *
   * Should an event read ever come back, this fails and the bound has to be
   * argued for again rather than inherited.
   */
  it("reads no append-only event log at all", () => {
    expect(readModel).not.toContain('from("audit_events")');
  });

  /**
   * The audits read is deliberately *not* bounded, and that is not an
   * oversight worth "fixing".
   *
   * It is ordered newest-first across every project and reduced to the latest
   * per project. A `.limit()` on it would starve exactly the project the
   * `lastActivityAt` note in `dashboard.ts` describes: a quiet product whose
   * newest audit falls outside a window filled by a busy one would render as
   * never analysed. Correctness beats the ceiling here, and the row is one
   * integer plus four small columns.
   */
  it("does not truncate a cross-project latest-per-project read", () => {
    const auditsQuery = readModel.slice(
      readModel.indexOf('from("business_readiness_audits")'),
      readModel.indexOf('from("opportunity_sets")'),
    );

    expect(auditsQuery.length).toBeGreaterThan(0);
    expect(auditsQuery, "a limit here silently drops a quiet project's score").not.toContain(
      ".limit(",
    );
  });
});

describe("attention is presentation, not a new engine", () => {
  it("is a pure module with no data access at all", () => {
    for (const forbidden of ["supabase", "from(", "await ", "fetch(", "server-only"]) {
      expect(attention, `attention.ts contains ${forbidden}`).not.toContain(forbidden);
    }
  });

  /**
   * Asserted against imports rather than the whole file: the prose in this
   * module legitimately discusses prompts and models when explaining what it
   * deliberately does not do, and a substring match over comments would fail
   * on its own documentation.
   */
  it("imports nothing but its own types", () => {
    const imports = attention.match(/^import[\s\S]*?from\s+"[^"]+";$/gm) ?? [];
    const sources = imports.map((line) => line.match(/from\s+"([^"]+)"/)?.[1] ?? "");

    expect(sources.length).toBeGreaterThan(0);
    for (const from of sources) {
      expect(from, `attention.ts imports ${from}`).toBe("./dashboard");
    }
  });

  it("calls no provider, model or inference helper", () => {
    for (const forbidden of ["generateStructured(", "countInputTokens(", "AIProvider", "anthropic"]) {
      expect(attention, `attention.ts references ${forbidden}`).not.toContain(forbidden);
    }
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The first ten minutes, pinned where the browser cannot reach (UI-S1 §28, §29).
 *
 * ## What this is for
 *
 * Every defect this sprint fixed was a *wiring* defect — the components were
 * fine and the page asked them the wrong question. The browser suite renders
 * the components; these assertions cover the wiring between them, which is
 * exactly the layer the fixture harness cannot see because it supplies the
 * state itself.
 *
 * Each test names the regression it exists to catch. If one of them starts
 * failing, the question to ask is not "how do I make this pass" but "has the
 * founder been trapped again".
 */

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

/**
 * The file with its commentary removed.
 *
 * Banned-copy assertions are about what a founder reads. Comments are how these
 * files explain the defect they replaced — "Go to dashboard", "substitute
 * localhost" — and a file must be allowed to name the mistake it stopped
 * making without failing the test that stops it recurring.
 */
const copyOf = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** Rendered prose, with JSX line wrapping collapsed so a sentence is one string. */
const proseOf = (source: string) => copyOf(source).replace(/\s+/g, " ");

const PAGE = read("src/app/app/onboarding/[projectId]/page.tsx");
const ACTIONS = read("src/app/app/onboarding/[projectId]/actions.ts");
const PREREQUISITE = read("src/app/app/onboarding/[projectId]/audit-live-prerequisite.tsx");
const WATCHER = read("src/app/app/onboarding/[projectId]/operation-watcher.tsx");
const STATUS = read("src/app/app/onboarding/[projectId]/understanding-status.tsx");
const PRODUCT_SCAN_WORKFLOW = read("src/modules/operations/product-scan/workflow.ts");
const PRODUCT_SCAN_EXECUTION = read("src/modules/operations/product-scan/execution.ts");
const FAILURE_STATES = read("src/app/app/onboarding/[projectId]/operation-states.tsx");
const LOGO = read("src/components/brand/product-logo.tsx");
const ACCOUNTS = read("src/app/app/connect/github/accounts/page.tsx");
const REPOSITORIES = read("src/app/app/connect/github/repositories/page.tsx");

describe("a founder with no live product is not trapped", () => {
  /** Regression 1: the no-live-site founder becomes trapped again. */
  it("gives the audit step a parked shape, decided by the shared predicate", () => {
    expect(PAGE).toContain("auditSurface(");
    expect(PAGE).toContain('surface === "parked_no_live_product"');
    expect(PREREQUISITE).toContain('mode === "parked"');
  });

  it("offers a way to the workspace from the parked state", () => {
    expect(PREREQUISITE).toContain("completeOnboardingAction");
    expect(PREREQUISITE).toContain("Continue to your workspace");
  });

  it("lets a founder who said they are live change their mind without leaving", () => {
    expect(PREREQUISITE).toContain("parkLiveProductAction");
    expect(PREREQUISITE).toContain("I don&apos;t have a live product yet");
  });

  /**
   * Regression 5: a parked audit represented as one that ran.
   *
   * Parking writes one canonical fact and touches nothing about the audit. If
   * an audit row, a completion timestamp or a score ever gets written here, the
   * product has started lying about work it did not do.
   */
  it("parks by recording live-site intent and nothing about the audit", () => {
    const park = ACTIONS.slice(
      ACTIONS.indexOf("export async function parkLiveProductAction"),
      ACTIONS.indexOf("export async function retryProductScanAction"),
    );
    expect(park).toContain('status: "no_live_site_yet"');
    expect(park).not.toContain("startBusinessAuditOperation");
    expect(park).not.toContain("business_readiness_audits");
    expect(park).not.toContain("startProductUnderstandingOperation");
    expect(park).not.toContain("completeProjectOnboarding");
  });

  /**
   * Regression: Try again silently dropping half the scan.
   *
   * The retry used to re-run only the repository read. A founder whose live
   * check failed and who pressed Try again got an understanding built without
   * their site — reported as success — and nothing on screen said the live
   * half had been skipped. A retry of the Product Scan is the whole scan.
   */
  it("retries the live source as well as the repository", () => {
    const retry = ACTIONS.slice(
      ACTIONS.indexOf("export async function retryProductScanAction"),
      ACTIONS.indexOf("export type ConfirmAndAuditState"),
    );
    expect(retry).toContain("startDurableProductScan(projectId)");
    expect(PRODUCT_SCAN_WORKFLOW).toContain("scanRepository(operationId)");
    expect(PRODUCT_SCAN_WORKFLOW).toContain("scanLiveProduct(operationId)");
    expect(PRODUCT_SCAN_EXECUTION).toContain("inspectRepository(");
    expect(PRODUCT_SCAN_EXECUTION).toContain("inspectLiveProduct(");
    // Both source attempts now belong to the durable run rather than to the
    // browser request that happened to start it.
    expect(retry).not.toContain("inspectRepository(");
  });

  it("never invents, guesses or substitutes an address", () => {
    for (const [name, source] of [
      ["page", PAGE],
      ["actions", ACTIONS],
      ["prerequisite", PREREQUISITE],
    ] as const) {
      const copy = copyOf(source);
      expect(copy, name).not.toContain("localhost");
      expect(copy, name).not.toContain("example.com");
      expect(copy, name).not.toContain("127.0.0.1");
    }
  });

  it("says the audit is set aside rather than complete or failed", () => {
    expect(PREREQUISITE).toContain("it has not run");
    expect(PREREQUISITE).not.toContain("Your audit is complete");
  });
});

describe("a founder can see what is happening", () => {
  /**
   * Regression: the stage line freezes while the operation moves on.
   *
   * The watcher used to compare the polled operation against one thing only —
   * whether it had stopped. Everything in between was discarded.
   */
  it("refreshes when the stage moves, not only when the run ends", () => {
    expect(WATCHER).toContain("next.stage !== stage");
    expect(WATCHER).toContain("next.stalled !== stalled");

    /*
     * Compared against freshly rendered values rather than a stale closure.
     *
     * This used to be asserted as `stage` appearing in an effect's dependency
     * list, which was how the watcher re-armed itself when it owned its own
     * timer. It no longer owns one: the shared poll hook keeps the callback in
     * a ref it refreshes every render, so the comparison above reads this
     * render's props by construction. The assertion follows the mechanism —
     * the behaviour it protects is the two lines above.
     */
    expect(WATCHER).toContain("useOperationPoll");
  });

  /** Regression: "taking longer than expected" beside "Vibe will keep going". */
  it("stops promising the run continues once it has stopped being believable", () => {
    expect(STATUS).toContain("!operation.stalled && (");
    expect(STATUS).not.toContain("This is taking longer than expected");
  });

  it("gives the stalled state something to do", () => {
    expect(FAILURE_STATES).toContain("OnboardingStalled");
    expect(PAGE).toContain("onboarding.understandingOperation.stalled &&");
    expect(PAGE).toContain("onboarding.auditOperation.stalled &&");
  });
});

describe("a failed operation is reported, not hidden", () => {
  /** Regression 2: the failed audit silently resets to the start control. */
  it("reads the last attempt rather than only the live one", () => {
    expect(PAGE).toContain("getLastFailedOperation");
    expect(PAGE).toContain('operationType: "product_scan"');
    expect(PAGE).toContain('operationType: "business_audit"');
  });

  it("renders the failure with the start control inside it", () => {
    expect(PAGE).toContain("<OnboardingOperationFailure");
    expect(PAGE).toContain("understandingFailure ? (");
    expect(PAGE).toContain("auditFailure ? (");
    // The control is passed *into* the failure, so a button can never appear
    // on its own where a failure should be.
    expect(FAILURE_STATES).toContain("action?: ReactNode");
  });

  it("answers what happened, what changed and what next", () => {
    expect(FAILURE_STATES).toContain("OPERATION_FAILURE_MESSAGES");
    expect(FAILURE_STATES).toContain("are unchanged");
    expect(FAILURE_STATES).toContain("operation.retryAllowed");
  });

  it("exposes no provider internals or stack traces", () => {
    for (const banned of ["stack", "err.message", "error.message", "Anthropic", "Supabase"]) {
      expect(FAILURE_STATES, banned).not.toContain(banned);
    }
  });
});

describe("leaving and arriving are coherent", () => {
  /** Regression 6: `canLeave` removed from the veteran connect flow. */
  it("offers an exit from the connect screens a returning founder passes through", () => {
    for (const [name, source] of [
      ["accounts", ACCOUNTS],
      ["repositories", REPOSITORIES],
    ] as const) {
      expect(source, name).toContain("hasCompletedAnyOnboarding");
      expect(source, name).toContain("canLeave={canLeave}");
    }
  });

  /** Regression 8: a completed onboarding redirected back into onboarding. */
  it("sends a completed project to its workspace", () => {
    expect(PAGE).toContain(
      'onboarding.state === "complete") redirect(`/app/projects/${projectId}`)',
    );
  });

  it("names the final control after where it actually goes", () => {
    expect(PAGE).toContain("Go to your workspace");
    expect(copyOf(PAGE)).not.toContain("Go to dashboard");
  });
});

describe("the reveal does not depend on a remote image", () => {
  /** Regression 7: a broken logo renders the browser's broken-image glyph. */
  it("falls back to the Vibe mark when the browser cannot load it", () => {
    expect(LOGO).toContain("onError");
    expect(LOGO).toContain("setFailed(true)");

    // The claim, not the sentence: a failed load must leave the img behind,
    // and with nothing else asked for it must be the Vibe mark. This pinned
    // the exact line `if (failed) return <VibeMark` until the fallback became
    // overridable for the product list, where Vibe's own mark would read as a
    // claim about whose product a row is.
    expect(LOGO).toContain("if (failed) return");
    expect(LOGO).toContain("<VibeMark size={size} />");
  });

  it("is not what the reveal surfaces ask for — they take the default", () => {
    // Which is what keeps the assertion above true *of the reveal*. A surface
    // that passed its own fallback would leave this describing somewhere else.
    for (const [name, source] of [
      ["onboarding", PAGE],
      ["understanding-panel", read("src/app/app/projects/[projectId]/understanding-panel.tsx")],
    ] as const) {
      const elements = source.match(/<ProductLogo[\s\S]*?\/>/g) ?? [];
      expect(elements.length, name).toBeGreaterThan(0);
      for (const element of elements) expect(element, name).not.toContain("fallback");
    }
  });

  it("is what both reveal surfaces render", () => {
    expect(PAGE).toContain("<ProductLogo");
    expect(read("src/app/app/projects/[projectId]/understanding-panel.tsx")).toContain(
      "<ProductLogo",
    );
  });

  /**
   * The fallback only helps if nothing renders the URL directly.
   *
   * A second `<img>` added later — a favicon, a screenshot, a second reveal —
   * would reintroduce the broken glyph without touching `ProductLogo` at all,
   * so what is asserted is the absence of the raw element rather than the
   * presence of the wrapper.
   */
  it("leaves no raw remote img behind on either surface", () => {
    for (const [name, source] of [
      ["onboarding", PAGE],
      ["workspace", read("src/app/app/projects/[projectId]/understanding-panel.tsx")],
    ] as const) {
      expect(copyOf(source), name).not.toContain("<img");
    }
  });
});

describe("the first journey speaks to a founder", () => {
  it("carries no implementation commentary through the connect step", () => {
    const CONNECT_SURFACES: [string, string][] = [
      ["onboarding entry", read("src/app/app/onboarding/page.tsx")],
      ["project onboarding", PAGE],
      ["repositories", REPOSITORIES],
    ];
    for (const [name, source] of CONNECT_SURFACES) {
      const copy = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      for (const banned of [
        "onboarding lifecycle",
        "independent of the provider",
        "installation may have been suspended",
        "provider lifecycle",
      ]) {
        expect(copy, `${name} must not say "${banned}"`).not.toContain(banned);
      }
    }
  });

  it("says what GitHub is about to ask before handing over", () => {
    for (const [name, source] of [
      ["onboarding entry", read("src/app/app/onboarding/page.tsx")],
      ["project onboarding", PAGE],
    ] as const) {
      expect(proseOf(source), name).toContain("GitHub will ask which repositories Vibe may access");
    }
  });
});

/**
 * What the step costs to render (PERF-006).
 *
 * This route is polled every 2.5 seconds while a scan runs, so a round trip
 * here is paid over and over during the part of the product a founder sees
 * first. Every read the step needs is gated on the onboarding record that is
 * already in hand, and none depends on another — so they belong in one wave.
 *
 * Textual, because that is where the mistake lives: an `await` written into
 * the gate, which reads perfectly well on its own line and costs a round trip
 * that nothing was waiting for.
 */
describe("the onboarding step reads in one wave", () => {
  it("asks for the step's reads together", () => {
    expect(PAGE).toContain("] = await Promise.all([");
  });

  it("does not await inside a state gate", () => {
    const gatedAwaits = PAGE.match(/onboarding\.state === "[a-z_]+"\s*\?\s*await /g) ?? [];
    expect(gatedAwaits, "a conditional read was awaited on its own").toEqual([]);
  });

  /**
   * The exception, and it is a real one: `auditFailure` is gated on `surface`,
   * which is derived from `auditReadiness` in the wave above it. A read that
   * genuinely depends on an earlier answer stays sequential.
   */
  it("keeps the one genuinely dependent read after what it depends on", () => {
    expect(PAGE.indexOf("const surface =")).toBeLessThan(PAGE.indexOf("const auditFailure ="));
  });
});

/**
 * Onboarding ends on a decision (audit Slice 6).
 *
 * The last screen showed the founder the one Move Vibe would start with, its
 * problem and why it comes first — and then offered only a way out of the
 * flow. The whole of onboarding built to a recommendation nobody could act on
 * from the screen that made it.
 *
 * Asserted against the source, like the rest of this file: the control binds a
 * real Server Action and cannot be mounted in the fixture harness, so what a
 * browser could prove here is the markup and not the wiring.
 */
describe("the last screen offers the Move it just recommended", () => {
  const DECISION = read("src/app/app/onboarding/[projectId]/first-move-decision.tsx");

  it("offers planning as a priced control, not a sentence", () => {
    expect(PAGE).toContain("<FirstMoveDecision");
    expect(DECISION).toContain("startPlanAction");
    // The price rides on the control, from the rate card in force.
    expect(DECISION).toContain("<ActionBlock");
    expect(DECISION).toContain('operation="action_plan"');
  });

  it("never defaults a replan on", () => {
    // Rule 60: a paid re-run is an explicit request, never a default.
    expect(DECISION).toContain('name="force" value="false"');
    expect(DECISION).not.toContain('value="true"');
  });

  it("keeps leaving free, and keeps naming where it goes", () => {
    expect(PAGE).toContain("completeOnboardingAction");
    expect(PAGE).toContain("Go to your workspace");
    // Comments quote the phrase they explain, so the check reads the markup.
    expect(copyOf(PAGE)).not.toContain("Go to dashboard");
  });

  it("offers the plain exit when there is no Move to decide about", () => {
    // A screen with no recommendation has nothing to price.
    expect(PAGE).toContain("{firstOpportunity ? (");
  });
});

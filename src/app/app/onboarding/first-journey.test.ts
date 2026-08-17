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
    // Re-armed against freshly rendered values rather than a stale closure.
    expect(WATCHER).toMatch(/\[[^\]]*\bstage\b[^\]]*\]/);
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
    expect(PAGE).toContain('operationType: "product_understanding"');
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
    expect(PAGE).toContain('onboarding.state === "complete") redirect(`/app/projects/${projectId}`)');
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
    expect(LOGO).toContain("if (failed) return <VibeMark");
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
      expect(proseOf(source), name).toContain(
        "GitHub will ask which repositories Vibe may access",
      );
    }
  });
});

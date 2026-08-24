import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findCausalClaims } from "@/modules/business-measurement/causality";
import { actionLabelText } from "./test-support";

/**
 * The Command Center's language rules, asserted against the UI source (CORE-5).
 *
 * A source assertion; the browser-level proof is in `e2e/business-audit.spec.ts`
 * (the readings) and `e2e/merge-ui.spec.ts` (the folded build detail). This file
 * catches the class of regression that is a one-line change: a control that
 * promises to ship, a causal verb on a measured result, or a score printed
 * without going through the one function that knows an absent score is not a
 * zero.
 *
 * Every screen this sprint added is new, so every rule below is new here — but
 * none of the rules themselves are. They are the rules the rest of the product
 * already holds, applied to the surfaces that did not exist to break them yet.
 */

const DIR = join(process.cwd(), "src/app/app/projects/[projectId]");

function source(file: string): string {
  return readFileSync(join(DIR, file), "utf8");
}

/**
 * The file with its comments removed and whitespace collapsed.
 *
 * Comments in this codebase quote the very phrases the copy assertions forbid,
 * in order to explain why a screen never says them — so a raw-source assertion
 * would fail on its own rationale. JSX also wraps prose across lines, so an
 * un-collapsed `toContain` misses sentences that are on screen exactly as
 * written. Sprint 12A learned both of these the expensive way; this is the same
 * helper `business-impact-ui.test.ts` uses, for the same reasons.
 */
function renderedCopy(file: string): string {
  return source(file)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ")
    .replace(/\s+/g, " ");
}

describe("the agent surface promises nothing it does not do", () => {
  const AGENT_FILES = ["agent-panel.tsx", "home-status.tsx"];

  /**
   * The brief for this sprint ended its agent flow with "[Create Pull
   * Request]". Vibe does not open pull requests. An approved change reaches
   * the default branch by fast-forward to one exact human-approved commit, or
   * it refuses (CLAUDE.md rules 58, 67–74; ADR 0019). A control offering a PR
   * would be offering a mechanism that does not exist.
   *
   * The same sentence covers the rest of the family: nothing on these two
   * surfaces may offer to deploy, ship, publish or release, because none of
   * those is something Vibe does at all.
   */
  it("offers no pull request, deploy, ship, publish or release control", () => {
    for (const file of AGENT_FILES) {
      const labels = actionLabelText(source(file)).join(" ");
      expect(labels, `${file} offers one`).not.toMatch(
        /\b(pull request|pr|deploy|deployed|ship|shipped|publish|published|release|released|go live)\b/i,
      );
    }
  });

  /**
   * And it may not *say* it either. A card that reads "your engineer is
   * building this now" is a claim about work in flight, and this surface has
   * no way to know that — there is no project-scoped read of a running agent
   * run (see the Agent page's docblock).
   */
  it("never narrates work it cannot observe", () => {
    const copy = renderedCopy("agent-panel.tsx");
    expect(copy).not.toMatch(/\b(is building|is writing|is working on|currently building)\b/i);
  });

  /**
   * Rule 66: a sandbox validation pass means a profile's commands exited zero
   * in an isolated VM. It never means safe, correct, reviewed, mergeable or
   * production ready, and the agent card must not summarise it as any of them.
   */
  it("never summarises a check as safety or correctness", () => {
    const copy = renderedCopy("agent-panel.tsx");
    expect(copy).not.toMatch(/\b(safe to merge|verified safe|proven correct|production ready)\b/i);
  });
});

describe("experiments report observations, never causes", () => {
  const FILES = ["experiment-card.tsx", "experiments/page.tsx"];

  /**
   * The heart of it. This product runs no controlled experiments —
   * `business-measurement/causality.ts` says so in code and exports this
   * checker so a causal verb fails a build rather than a review. Naming the
   * section "Experiments" does not earn the right to claim causation; if
   * anything it raises the risk, which is why this runs over both files.
   */
  it.each(FILES)("makes no causal claim in %s", (file) => {
    expect(findCausalClaims(renderedCopy(file))).toEqual([]);
  });

  /**
   * No metric source is connected for any project, so every business result is
   * `waiting_for_source`. That is a missing connection on Vibe's side. Written
   * as "no impact" or "no change" it would read as a verdict on the founder's
   * change, which is the exact misreading the measurement layer's own copy
   * rules exist to prevent.
   */
  it("never renders a missing measurement as a bad result", () => {
    const copy = renderedCopy("experiment-card.tsx");
    expect(copy).not.toMatch(/\bno (impact|effect|improvement|change measured)\b/i);
  });

  /**
   * The two observations stay two. `outcome` is what Vibe saw in production,
   * `businessImpact` is what a metric says; merging them into one "result"
   * would assert a link neither establishes.
   */
  it("keeps the production observation and the business one apart", () => {
    const src = source("experiment-card.tsx");
    expect(src).toContain("entry.outcome.state");
    expect(src).toContain("entry.businessImpact.headline");
  });
});

describe("home tells the truth about what it does not know", () => {
  /**
   * Home's four answers are decided in `buildHomeView` and asserted in
   * `src/modules/projects/command-center.test.ts`. What this file adds is that
   * the component actually uses those states rather than re-deriving anything
   * from a raw value — a `?? 0` here would defeat the whole view model.
   */
  it("renders health from the view model's states, never from a raw number", () => {
    const src = source("home-status.tsx");

    for (const state of ['health.kind === "scored"', 'health.kind === "unscored"', 'health.kind === "not_analyzed"']) {
      expect(src, `home-status.tsx does not handle ${state}`).toContain(state);
    }
    // No coalescing a missing score into a printable one.
    expect(src).not.toMatch(/score\s*\?\?\s*0/);
  });

  it("distinguishes a Move that was never looked for from one that was not found", () => {
    const src = source("home-status.tsx");
    expect(src).toContain('nextMove.kind === "none_found"');
    expect(src).toContain('nextMove.kind === "not_identified"');
  });
});

describe("the audit lifecycle reaches the founder without a reload", () => {
  /**
   * The first lens-scored dogfood run found this: the audit paused on its
   * founder question (`needs_user`, confirmed in the database) and the screen
   * stayed on "Preparing" until the page was manually reloaded. The question,
   * the preparing→analyzing switch and the finished audit are all rendered by
   * the server — so the poller that observes those transitions must refresh
   * the route, exactly as onboarding's OperationWatcher does ("refreshes when
   * the stage moves, not only when the run ends"). A poller that stops
   * silently strands the founder on a state the server has already left.
   */
  it("refreshes the route when the polled operation moves", () => {
    const src = source("run-audit-button.tsx");
    expect(src).toContain("onReading:");
    // The transition rule, not the tick: refresh only when the poll names
    // something other than what the server rendered.
    expect(src).toMatch(/onReading[\s\S]{0,400}router\.refresh\(\)/);
  });

  it("shows a working control the moment the button is pressed", () => {
    // aria-busy alone is invisible. The pressed button must be visibly busy.
    const button = readFileSync(join(process.cwd(), "src/components/ui/button.tsx"), "utf8");
    expect(button).toContain("busy");
    expect(button).toMatch(/animate-spin/);
  });
});

describe("one Product Scan, in the founder's words", () => {
  /**
   * The two per-module controls ("Inspect repository" / "Inspect live
   * product") merge into one customer-facing scan. The words "repository
   * intelligence" and "live product check" are Vibe's names for its own
   * subsystems, and they leave every customer string with the merge — module
   * names, file paths and event names are unaffected.
   */
  it("offers one scan control for both sources, not one per module", () => {
    const page = source("product/page.tsx");
    expect(page).toContain("ProductScanButton");
    expect(page).not.toContain("InspectButton");
    expect(page).not.toContain("InspectLiveButton");
  });

  it("runs the live source from the same scan when a site is set", () => {
    const action = source("product-scan-action.ts");
    expect(action).toContain("inspectRepository(");
    expect(action).toContain("inspectLiveProduct(");
  });

  it("tells a founder when a source was read, partially read, or failed", () => {
    const src = source("product-overview.tsx");
    // Three honest states, not a boolean: a client-rendered site was visited
    // and partly unread, which is neither "ready" nor "not yet".
    expect(src).toContain('"partial"');
    expect(src).toContain('"failed"');
  });

  it("derives the partial wording from the one function that knows why", () => {
    // Not re-written per surface: describeIncompleteness is the sentence the
    // live summary already shows, and the source row must agree with it.
    expect(source("product/page.tsx")).toContain("describeIncompleteness");
  });

  it("never shows a founder the modules' own names", () => {
    for (const file of [
      "product/page.tsx",
      "product-scan-button.tsx",
      "intelligence-summary.tsx",
      "live-intelligence-summary.tsx",
      "health/content.tsx",
    ]) {
      const copy = renderedCopy(file);
      expect(copy, file).not.toContain("Repository intelligence");
      expect(copy, file).not.toContain("repository intelligence");
      expect(copy, file).not.toContain("Live product check");
      expect(copy, file).not.toContain("live product intelligence");
    }
  });
});

describe("the sources block leads somewhere from every state", () => {
  /**
   * Deep Scan and Settings are reachable from this block and, for Deep Scan,
   * from nowhere else in the navigation. A row that reported "not run yet" and
   * offered no way to run it is the dead end this codebase keeps finding — the
   * same one three bare fragments produced before this sprint.
   */
  it("gives every source row a link, not just the ready ones", () => {
    const src = source("product-overview.tsx");

    // The type requires it, and the component renders it unconditionally —
    // outside any `source.ready` branch.
    expect(src).toContain("href: string;");
    expect(src).toContain("href={source.href}");
    expect(src).not.toMatch(/source\.ready\s*&&\s*<Link/);
  });
});

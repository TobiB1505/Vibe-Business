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

describe("a score is never drawn as a zero it does not have", () => {
  /**
   * CLAUDE.md rule 44, at the one place in this sprint where a number becomes
   * a bar width. `scoreDisplay` is the only thing allowed to make that
   * conversion, because it is the only thing that knows `null` renders as an
   * empty track and the word "n/a" rather than as 0%.
   *
   * Asserted structurally rather than by copy: a component that read
   * `dimension.score` directly would compile, render, and be wrong only for
   * the projects whose evidence was thin — which is the population least
   * likely to be looking.
   */
  it("routes every dimension reading through scoreDisplay", () => {
    const src = source("business-health.tsx");

    expect(src).toContain("scoreDisplay(dimension.score)");
    // No second path: nothing else may touch the raw number.
    const rawReads = [...src.matchAll(/dimension\.score/g)];
    expect(rawReads).toHaveLength(1);
  });

  it("never prints a scale beside a value that is not a number", () => {
    const copy = renderedCopy("business-health.tsx");
    // The suffix is attached inside `!display.unscored`, so "n/a / 100" is
    // unreachable. This pins that the guard exists rather than trusting it.
    expect(copy).toContain("!display.unscored &&");
  });

  it("says why a reading is absent rather than leaving a blank", () => {
    const copy = renderedCopy("business-health.tsx");
    expect(copy).toMatch(/didn&apos;t find enough to judge this one/);
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

describe("the sources block leads somewhere from every state", () => {
  /**
   * Deep Scan and Settings are reachable from this block and, for Deep Scan,
   * from nowhere else in the navigation. A row that reported "not run yet" and
   * offered no way to run it is the dead end this codebase keeps finding — the
   * same one three bare fragments produced before this sprint.
   */
  it("gives every source row a link, not just the ready ones", () => {
    const src = source("understanding-panel.tsx");

    // The type requires it, and the component renders it unconditionally —
    // outside any `source.ready` branch.
    expect(src).toContain("href: string;");
    expect(src).toContain("href={source.href}");
    expect(src).not.toMatch(/source\.ready\s*&&\s*<Link/);
  });
});

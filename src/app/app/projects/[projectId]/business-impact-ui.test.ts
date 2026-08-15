import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findCausalClaims } from "@/modules/business-measurement/causality";

/**
 * The business impact trust boundary, asserted against the UI source
 * (Sprint 12B §21–§28, §36, §43, §45).
 *
 * A source assertion; the browser-level proof is in `e2e/business-impact.spec.ts`.
 * This file catches the class of regression that is a one-line change: a causal
 * verb, a "No impact" headline, a revert button, or a result state that quietly
 * stops carrying its disclaimer.
 */

const DIR = join(process.cwd(), "src/app/app/projects/[projectId]");

function source(file: string): string {
  return readFileSync(join(DIR, file), "utf8");
}

/**
 * The file with its comments removed and whitespace collapsed.
 *
 * Comments in this codebase quote the very phrases the copy assertions forbid,
 * in order to explain why the panel never says them — so a raw-source assertion
 * would fail on its own rationale. JSX also wraps prose across lines, so an
 * un-collapsed `toContain` misses sentences that are on screen exactly as
 * written. Sprint 12A learned both of these the expensive way.
 */
function renderedCopy(file: string): string {
  return source(file)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ")
    .replace(/\s+/g, " ");
}

function actionLabels(src: string): string[] {
  const inner = (tag: string) =>
    [...src.matchAll(new RegExp(`<${tag}\\b(?:=>|[^>])*?>([\\s\\S]*?)</${tag}>`, "g"))].map(
      (match) => match[1],
    );

  return [...inner("button"), ...inner("a")];
}

describe("the panel offers only what this sprint implements (§28, §34)", () => {
  const src = source("business-impact-panel.tsx");

  it("offers exactly two actions", () => {
    const labels = actionLabels(src)
      .map((label) => label.replace(/\{[\s\S]*?\}/g, " ").trim())
      .filter(Boolean);

    for (const label of labels) {
      expect(["Plan measurement", "Start measuring"]).toContain(label);
    }
  });

  it("offers no revert, rollback or redeploy after a degraded result (§28)", () => {
    // A bad outcome is information, not a trigger. The consequential response
    // belongs to a human and to a later sprint.
    const labels = actionLabels(src).join(" ");

    for (const forbidden of [
      "Revert",
      "Roll back",
      "Rollback",
      "Undo",
      "Redeploy",
      "Re-merge",
      "Remerge",
      "Deploy",
    ]) {
      expect(labels).not.toContain(forbidden);
    }
  });

  it("offers no connect action, because no connector exists (§34, §49)", () => {
    expect(actionLabels(src).join(" ")).not.toContain("Connect analytics");
    expect(source("business-impact-actions.ts")).not.toContain("connectAnalytics");
  });
});

describe("the sentence that must never appear (§21, §48)", () => {
  const copy = renderedCopy("business-impact-panel.tsx");

  it("never says 'No impact'", () => {
    expect(copy.toLowerCase()).not.toContain("no impact");
  });

  it("never says 'Unknown impact' as if unknown were a negative result", () => {
    expect(copy.toLowerCase()).not.toContain("unknown impact");
  });

  it("frames a missing source as a missing connection, in the dogfood's words (§48)", () => {
    expect(copy).toContain(
      "Production behavior was verified, but Vibe does not yet have a connected data source to measure search or traffic impact.",
    );
  });
});

describe("causality is never asserted (§10, §24, §43)", () => {
  it("contains no causal claim anywhere in the rendered copy", () => {
    // The mutation this kills is a single verb: "observed" → "caused".
    expect(findCausalClaims(renderedCopy("business-impact-panel.tsx"))).toEqual([]);
  });

  it("labels the number as an observed change, never an impact or an uplift", () => {
    const copy = renderedCopy("business-impact-panel.tsx");

    expect(copy).toContain("Observed change");
    expect(copy).not.toContain("Uplift");
    expect(copy).not.toContain("Impact of this change");
  });

  it("renders the disclaimer from the card rather than writing its own", () => {
    // A field on the server's card, so a redesign cannot drop it and the
    // wording cannot drift from the constant the domain tests pin.
    expect(source("business-impact-panel.tsx")).toContain("card.observedChangeDisclaimer");
  });
});

describe("negative results are never hidden (§25)", () => {
  const src = source("business-impact-panel.tsx");

  it("renders degraded through the same branch as improved", () => {
    // One branch for all three results means a redesign cannot accidentally
    // give the bad news less room than the good news.
    const resultBranch = src.slice(src.indexOf("improved / degraded / neutral"));
    expect(resultBranch).toContain("<BeforeAfter card={card} />");
  });

  it("renders the values unconditionally, never behind a state test", () => {
    // The mutation this kills is one conditional: `{card.state !== "degraded" &&
    // <BeforeAfter …>}`. It leaves the component still *containing* the element,
    // so a `toContain` assertion passes while the bad news vanishes from the
    // screen — which is precisely the omission §25 forbids.
    expect(src).not.toMatch(/card\.state\s*!==\s*"(degraded|improved|neutral)"/);
    expect(src).not.toMatch(/\{[^}]*degraded[^}]*&&\s*<BeforeAfter/);
  });

  it("signs the observed change, so a fall reads as a fall", () => {
    expect(src).toMatch(/percent < 0 \? "−"/);
  });

  it("gives degraded its own tone rather than rendering it as success", () => {
    const tones = src.slice(src.indexOf("const RESULT_TONE"), src.indexOf("function BeforeAfter"));
    expect(tones).toMatch(/improved: "text-emerald-400"/);
    expect(tones).toMatch(/degraded: "text-amber-300"/);
  });
});

describe("progress is factual (§22, §23)", () => {
  const src = source("business-impact-panel.tsx");

  it("counts complete days rather than inventing a percentage", () => {
    expect(src).toContain("complete days observed");
    expect(src).not.toContain("<progress");
    expect(renderedCopy("business-impact-panel.tsx")).not.toMatch(/\d+\s*%/);
  });

  it("never previews a verdict before the window closes", () => {
    const copy = renderedCopy("business-impact-panel.tsx").toLowerCase();
    for (const forbidden of ["looking good", "trending up", "on track", "so far so"]) {
      expect(copy).not.toContain(forbidden);
    }
  });

  it("shows both windows and when a result becomes available", () => {
    expect(src).toContain("Baseline");
    expect(src).toContain("Measurement window");
    expect(src).toContain("Result available after");
  });

  it("shows the timezone the windows were counted in (§32)", () => {
    expect(src).toContain("window.timezone");
  });
});

describe("insufficient data says what was needed (§26)", () => {
  const src = source("business-impact-panel.tsx");

  it("shows the requirement alongside what was observed", () => {
    expect(src).toContain("Needed each period");
    expect(src).toContain("Observed before");
    expect(src).toContain("Observed after");
  });

  it("does not present it as a result", () => {
    const copy = renderedCopy("business-impact-panel.tsx");
    expect(copy).toContain("Not enough traffic was observed to make a meaningful comparison.");
  });
});

describe("the panel decides nothing (§44)", () => {
  const src = source("business-impact-panel.tsx");

  it("renders the server's card rather than classifying", () => {
    expect(src).toContain("card.state");
    expect(src).not.toMatch(/observedValue\s*>\s*baselineValue/);
    expect(src).not.toContain("classifyMeasurement");
  });

  it("cannot name a metric, a window or a source", () => {
    const signature = source("business-impact-actions.ts");
    const head = signature.slice(
      signature.indexOf("export async function startMeasurementAction"),
    );

    for (const forbidden of ["metric", "window", "baseline", "source", "timezone"]) {
      expect(head.slice(0, head.indexOf(")")).toLowerCase()).not.toContain(forbidden);
    }
  });

  it("resolves the session and never trusts a client-supplied user id", () => {
    expect(source("business-impact-actions.ts")).toContain("requireSession()");
  });
});

describe("opening a project page measures nothing (§36, §45)", () => {
  const src = source("page.tsx");

  it("reads the card and never starts a measurement or creates a plan", () => {
    expect(src).toContain("getBusinessImpactCard(supabase");
    expect(src).not.toContain("startBusinessMeasurement");
    expect(src).not.toContain("ensureMeasurementPlan");
  });

  it("says in the code why that read is free", () => {
    expect(src).toContain("zero provider calls");
  });
});

describe("the three levels stay separate, and business impact is last (§33)", () => {
  const src = source("prepared-changes-section.tsx");

  it("renders business impact after the production outcome", () => {
    expect(src.indexOf("<BusinessImpactPanel")).toBeGreaterThan(src.indexOf("<OutcomePanel"));
  });

  it("feeds the measurement's own answer into the outcome ladder", () => {
    // So the ladder stops saying "Not measured" once something has been.
    expect(src).toContain("businessImpactLabel={change.businessImpact.ladderLabel}");
  });

  it("passes only ids and the server's card", () => {
    const usage = src.slice(src.indexOf("<BusinessImpactPanel"), src.indexOf("<BusinessImpactPanel") + 300);
    expect(usage).toContain("card={change.businessImpact}");
    expect(usage).not.toMatch(/metric|window|baseline/i);
  });
});

describe("a business result never rewrites delivery or product outcome (§27)", () => {
  it("the outcome ladder still states all three levels independently", () => {
    const outcome = renderedCopy("outcome-panel.tsx");

    expect(outcome).toContain("Merged");
    expect(outcome).toContain("Production outcome");
    expect(outcome).toContain("Business impact");
  });

  it("the business panel writes nothing about the merge or the outcome", () => {
    const src = source("business-impact-panel.tsx");
    expect(src).not.toContain("mergeCard");
    expect(src).not.toContain("outcomeCard");
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { actionLabels } from "./test-support";
import { STATUS_GLYPHS } from "@/components/ui/status-pill";

/**
 * The outcome trust boundary, asserted against the UI source
 * (Sprint 12A §29–§34, §43, §45).
 *
 * ## What this is, and what it is not
 *
 * A **source** assertion. The browser-level proof lives in `e2e/outcome-ui.spec.ts`,
 * which renders these exact panels in a real Chromium against fixture cards.
 * This file catches the class of regression that is a one-line change and that a
 * rendering test would only catch if somebody remembered to write the scenario:
 * a "Deployed" badge appearing, a success state losing its "does not measure
 * business impact" line, or the panel deciding for itself that something is
 * verifiable.
 *
 * ## The sentence this whole file protects
 *
 * *Observing the intended public behaviour is not a deployment, and is not a
 * business result.* Every assertion below is a way of that sentence being
 * removed.
 */

const DIR = join(process.cwd(), "src/app/app/projects/[projectId]");

function source(file: string): string {
  return readFileSync(join(DIR, file), "utf8");
}

/**
 * The file with its comments removed and its whitespace collapsed.
 *
 * Both halves matter. Comments in this codebase quote the very phrases the
 * copy assertions forbid — explaining *why* the panel never says them — so an
 * assertion run over the raw source would fail on its own rationale. And JSX
 * wraps prose across lines, so `toContain("only that Vibe could not observe it")`
 * would miss a sentence that is on screen exactly as written.
 */
function renderedCopy(file: string): string {
  return source(file)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ")
    .replace(/\s+/g, " ");
}

describe("the outcome panel offers checking and nothing more (§25, §32)", () => {
  const src = source("outcome-panel.tsx");

  it("offers exactly the one action this sprint implements", () => {
    const labels = actionLabels(src)
      .map((label) => label.replace(/\{[\s\S]*?\}/g, " ").trim())
      .filter(Boolean);

    for (const label of labels) {
      expect(["Check production outcome"]).toContain(label);
    }
  });

  it("offers no hidden recovery after a not-observed result (§32)", () => {
    // Re-merging, re-validating, rebuilding and redeploying all cost provider
    // time, and starting them on the user's behalf is what CLAUDE.md rule 60
    // forbids. None of them exist here — and none of them exist at all.
    for (const forbidden of [
      "Deploy",
      "Redeploy",
      "Ship",
      "Publish",
      "Re-merge",
      "Remerge",
      "Rebuild",
      "Revalidate",
      "Retry deployment",
    ]) {
      expect(actionLabels(src).join(" ")).not.toContain(forbidden);
    }
  });

  it("never renders a Deployed badge (§34)", () => {
    expect(src).not.toMatch(/Deployed\s*(?:✅|<)/);
    expect(src).not.toMatch(/>\s*Deployed\b/);
    expect(src.toLowerCase()).not.toContain("is live");
    expect(src.toLowerCase()).not.toContain("shipped");
  });

  it("never invents a percentage for somebody else's deployment (§29)", () => {
    // Nobody knows how long a customer's deployment takes, and a bar sitting at
    // 60% teaches people to distrust the number.
    expect(src).not.toContain("<progress");
    expect(src).not.toMatch(/style=\{\{\s*width/);
    expect(renderedCopy("outcome-panel.tsx")).not.toMatch(/\d+\s*%/);
  });
});

describe("the three levels stay separate on screen (§33)", () => {
  const src = source("outcome-panel.tsx");

  it("renders delivery, product outcome and business impact together", () => {
    // Asserted over the rendered copy, not the raw source. The panel's own
    // header comment draws this exact ladder to explain why it exists, so a
    // raw-source assertion passes even after the row is deleted from the JSX —
    // which is precisely what a mutation removing "Not measured" proved.
    const copy = renderedCopy("outcome-panel.tsx");

    expect(copy).toContain("Merged");
    expect(copy).toContain("Production outcome");
    expect(copy).toContain("Business impact");
    expect(copy).toContain("Not measured");
  });

  it("never replaces the unmeasured row with a claim", () => {
    const copy = renderedCopy("outcome-panel.tsx");

    for (const claim of ["Improved", "Positive", "Increased", "No impact"]) {
      expect(copy).not.toContain(`>${claim}<`);
    }
  });

  it("shows the ladder on every terminal product answer, not only success", () => {
    // A user needs the "nobody measured whether this helped" row on a partial
    // as much as on a verified.
    const ladderUses = [...src.matchAll(/<OutcomeLadder\b/g)];
    expect(ladderUses.length).toBeGreaterThanOrEqual(3);
  });

  it("says explicitly that a verified outcome is not business impact (§30)", () => {
    expect(renderedCopy("outcome-panel.tsx")).toContain("It does not measure business impact");
  });

  it("never equates the product outcome with a business result", () => {
    for (const word of ["revenue", "conversion rate", "signups increased", "growth"]) {
      expect(src.toLowerCase()).not.toContain(word);
    }
  });
});

describe("the four outcome states read differently (§30, §31, §32, §23)", () => {
  const src = source("outcome-panel.tsx");

  it("has distinct copy for verified, partial, not observed and could-not-check", () => {
    expect(src).toContain("Production outcome verified");
    expect(src).toContain("Partially observed");
    expect(src).toContain("Not observed within verification window");
    expect(src).toContain("Vibe could not check the production outcome");
  });

  it("never says a deployment failed (§22, §32)", () => {
    const copy = renderedCopy("outcome-panel.tsx");

    // Every occurrence must be the denial, never the claim. Said explicitly
    // because it is the conclusion a user will otherwise reach on their own.
    expect(copy).toContain("This does not mean a deployment failed");
    for (const match of copy.matchAll(/deployment failed/gi)) {
      expect(copy.slice(Math.max(0, match.index - 30), match.index)).toContain("does not mean");
    }
  });

  it("distinguishes 'we could not look' from 'it was not there' (§23)", () => {
    expect(renderedCopy("outcome-panel.tsx")).toContain("only that Vibe could not observe it");
  });

  it("renders every check, including the ones that did not pass (§31)", () => {
    // A card that showed only its green lines would turn a partial into a
    // verified by omission.
    const partialBranch = src.slice(src.indexOf('current.state === "partial"'));
    expect(partialBranch).toContain("<CheckList checks={current.checks} />");
  });

  it("marks a not-observed check as neither a tick nor a cross (§22)", () => {
    // Two halves, because the glyphs moved into the shared vocabulary
    // (UI-6 §2). The panel says which mark each state gets; `STATUS_GLYPHS`
    // says what each mark is. Together they still prove that a check nobody
    // observed renders as a dash — and additionally that the whole product
    // draws its ticks and crosses from one table rather than three.
    const marks = src.slice(src.indexOf("const CHECK_MARK"), src.indexOf("const CHECK_TONE"));
    expect(marks).toMatch(/not_observed:\s*STATUS_GLYPHS\.unseen/);
    expect(marks).toMatch(/passed:\s*STATUS_GLYPHS\.confirmed/);
    expect(marks).toMatch(/failed:\s*STATUS_GLYPHS\.refused/);

    expect(STATUS_GLYPHS.unseen).toBe("–");
    expect(STATUS_GLYPHS.confirmed).toBe("✓");
    expect(STATUS_GLYPHS.refused).toBe("✕");
    expect(STATUS_GLYPHS.unseen).not.toBe(STATUS_GLYPHS.confirmed);
    expect(STATUS_GLYPHS.unseen).not.toBe(STATUS_GLYPHS.refused);
  });

  it("tells the user they can leave the page while it observes (§29)", () => {
    expect(src).toContain("You can leave this page");
  });
});

describe("a dead end says what still holds (UI-5 §8)", () => {
  const src = source("outcome-panel.tsx");
  const copy = renderedCopy("outcome-panel.tsx");

  /** The two terminal answers with nothing to click, sliced from the JSX. */
  const notObserved = src.slice(
    src.indexOf('current.state === "not_observed"'),
    src.indexOf('current.state === "failed"'),
  );
  const failed = src.slice(src.indexOf('current.state === "failed"'));

  it("tells the user the merge is untouched and the window has closed", () => {
    // Both states are read as "something came undone" unless the screen says
    // otherwise, and neither offers a control that could settle it: once a
    // verification row exists, `canVerify` is false for every state.
    expect(copy).toContain("Your change is still in your repository");
    expect(copy).toContain("Vibe is no longer looking");
  });

  it("says it on both dead ends, not only the one about the product", () => {
    expect(notObserved).toContain("<WindowClosed");
    expect(failed).toContain("<WindowClosed");
  });

  it("keeps the four state headlines exactly as they were", () => {
    // Package 8 adds sentences; it does not reword the four lines the outcome
    // states are recognised by, here or in the browser suite.
    expect(src).toContain("Production outcome verified");
    expect(src).toContain("Partially observed");
    expect(src).toContain("Not observed within verification window");
    expect(src).toContain("Vibe could not check the production outcome");
  });

  it("gives a could-not-check the same ladder as every other terminal state", () => {
    // It was the one terminal answer that ended without it — so "Business
    // impact: Not measured" went missing on exactly the state that leaves a
    // user least certain what is true.
    expect(failed).toContain("<OutcomeLadder");
  });

  it("adds no control to either dead end (§32, rule 60)", () => {
    // Looking again costs provider time. Explaining a dead end must never
    // become a button that starts paid work on the user's behalf.
    expect(notObserved).not.toContain("<button");
    expect(failed).not.toContain("<button");
  });
});

describe("the panel decides nothing (§11, §29)", () => {
  const src = source("outcome-panel.tsx");

  it("renders the server's card rather than deriving eligibility", () => {
    // Every branch reads `current`, which is the server's card (or the server's
    // answer to the poll) — never a state the component worked out for itself.
    expect(src).toContain("const current = live ?? card;");
    expect(src).toContain("current.state");
    expect(src).toContain("current.canVerify");
    // No client-side reconstruction of whether something was merged, verified
    // or verifiable.
    expect(src).not.toMatch(/status === ['"]merged['"]/);
  });

  it("cannot name an origin, a path or an endpoint", () => {
    // The client has no parameter to put them in (§11). The origin it renders
    // is one the server resolved and handed back.
    expect(src).not.toContain("robots.txt\"");
    expect(src).not.toContain("sitemap.xml\"");
    expect(src).not.toMatch(/https?:\/\//);
  });
});

describe("the server action's surface is two identifiers (§11)", () => {
  const src = source("outcome-actions.ts");

  it("takes only a project id and a prepared change id", () => {
    expect(src).toMatch(
      /checkProductionOutcomeAction\(\s*projectId: string,\s*preparedChangeId: string,\s*\)/,
    );
  });

  it("has no parameter for a URL, origin, host, path or endpoint", () => {
    const signature = src.slice(src.indexOf("export async function checkProductionOutcomeAction"));
    const head = signature.slice(0, signature.indexOf(")"));

    for (const forbidden of ["url", "origin", "host", "path", "endpoint", "target"]) {
      expect(head.toLowerCase()).not.toContain(forbidden);
    }
  });

  it("resolves the session and never trusts a client-supplied user id", () => {
    expect(src).toContain("requireSession()");
    expect(src).not.toMatch(/userId: string/);
  });
});

describe("opening a project page starts nothing (§43)", () => {
  // The prepared-change assembly moved out of `page.tsx` into the workspace
  // read model (Sprint UI-2 Phase B), so the read now lives there. The rule is
  // unchanged and is asserted across *both* files: whichever one performs the
  // read, neither may start a verification.
  const page = source("page.tsx");
  const workspace = readFileSync(
    join(process.cwd(), "src/modules/execution/workspace.ts"),
    "utf8",
  );

  it("reads the outcome card", () => {
    // Batched for the whole list since VB-023; still a read, still no
    // observation started.
    expect(workspace).toContain("getOutcomeCards(supabase");
  });

  it("never starts a verification, from either the page or the read model", () => {
    expect(page).not.toContain("startOutcomeVerification");
    expect(workspace).not.toContain("startOutcomeVerification");
  });

  it("says in the code why that read is free", () => {
    // Load-bearing enough to be written down: a page render must never contact
    // a customer's production website.
    expect(workspace).toContain("no outbound HTTP at all");
  });
});

describe("the outcome panel sits after merge and offers no gate beyond it", () => {
  const src = source("agent/change-gates.tsx");

  it("renders the outcome panel last", () => {
    expect(src.indexOf("<OutcomePanel")).toBeGreaterThan(src.indexOf("<MergePanel"));
  });

  it("passes only ids and the server's card", () => {
    const usage = src.slice(src.indexOf("<OutcomePanel"), src.indexOf("<OutcomePanel") + 300);
    expect(usage).toContain("card={change.outcome}");
    expect(usage).not.toMatch(/origin|url/i);
  });
});

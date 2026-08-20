import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { actionLabels } from "./test-support";

/**
 * The merge trust boundary, asserted against the UI source (Sprint 11C §15, §25, §26, §29, §30).
 *
 * ## What this is, and what it is not
 *
 * A **source** assertion, not a rendering one. This project still has no React
 * testing tooling and no browser harness — Sprint 11A.1, the harness sprint,
 * was never implemented, and this machine has no container runtime, so
 * `supabase start` cannot run and there is no isolated database to seed
 * fixtures into. Pointing Playwright at production was ruled out and stays
 * ruled out.
 *
 * So nothing here proves what a user sees. It proves what the component can
 * possibly offer them and what copy it can possibly render. That is a real
 * limitation and the sprint brief asked for browser-level proof; this is the
 * closest available substitute, and the real dogfood remains the acceptance
 * mechanism.
 *
 * ## Why it is worth having anyway
 *
 * Because the regressions it catches are the expensive ones and each is a
 * one-line change: a Deploy button next to a merge, a success state that omits
 * "not deployed by Vibe", a confirmation that quietly stops mentioning that the
 * customer's own CI may react, or a panel that decides for itself that
 * something is mergeable.
 */

const DIR = join(process.cwd(), "src/app/app/projects/[projectId]");

function source(file: string): string {
  return readFileSync(join(DIR, file), "utf8");
}

describe("the merge panel offers merging and nothing more (§15, §25)", () => {
  const src = source("merge-panel.tsx");

  it("offers exactly the actions this sprint implements", () => {
    const labels = actionLabels(src)
      .map((label) => label.replace(/\{[\s\S]*?\}/g, " ").trim())
      .filter(Boolean);

    for (const label of labels) {
      expect(["Merge approved change", "Cancel"]).toContain(label);
    }
  });

  it("has no deploy, publish, ship or rollback control", () => {
    // None of these exist in the product. A disabled version would be the same
    // promise with a delay on it.
    expect(src).not.toMatch(/>\s*(Deploy|Publish|Ship|Roll ?back|Undo merge)\b/i);
  });

  it("never renders a merge as a deployment (§25)", () => {
    expect(src).toContain("Not deployed by Vibe");
    expect(src).toMatch(/no deployment has been\s*\n?\s*verified/i);
  });

  it("states the deployment boundary wherever a merge outcome is shown", () => {
    // `NotDeployed` is rendered on the success path, which is the one place a
    // reader is most likely to assume more happened than did.
    const mergedBranch = src.slice(src.indexOf('card.state === "merged"'));
    expect(mergedBranch).toContain("<NotDeployed />");
  });

  it("takes the deployment claim from the server card rather than asserting it", () => {
    // `deploymentVerified` is a field on the card precisely so the disclaimer
    // survives a redesign of this file. When a deployment gate exists it
    // becomes a real value instead of a constant.
    expect(source("../../../../modules/merge/view.ts")).toMatch(/deploymentVerified: false/);
  });
});

describe("the confirmation says what will and will not happen (§15, §26)", () => {
  const src = source("merge-panel.tsx");
  const dialog = src.slice(src.indexOf("function MergeDialog"), src.indexOf("function localTime"));

  it("names the branch and both commits before the click", () => {
    // A person authorizing a write to a default branch should be able to check
    // it rather than trust it.
    expect(dialog).toMatch(/defaultBranch/);
    expect(dialog).toMatch(/shortSha\(fromSha\)/);
    expect(dialog).toMatch(/shortSha\(toSha\)/);
  });

  it("says the merge stops if the repository changed", () => {
    expect(dialog).toMatch(/stop without modifying the default branch/i);
  });

  it("says Vibe will not call a deployment provider", () => {
    expect(dialog).toMatch(/not call a deployment provider/i);
  });

  it("warns that the repository's own CI may still react (§26)", () => {
    // The honest half. "No production effect" would be false: moving a default
    // branch routinely triggers somebody's existing pipeline, and the user
    // needs that sentence *before* the click, not after.
    expect(dialog).toMatch(/may trigger your repository/i);
    expect(dialog).toMatch(/CI\/CD|hosting automation/i);
  });

  it("never claims the merge deploys, ships or publishes anything", () => {
    expect(dialog).not.toMatch(/\b(will deploy|deploys your|ship|publish(?!ing)|go live)\b/i);
  });

  it("sends an explicit confirmation to the server rather than relying on the dialog", () => {
    // The dialog closing is a fact about a browser. The boolean is the thing
    // the server refuses without, before it reads any state (§16).
    expect(src).toMatch(/mergeApprovedChangeAction\([^)]*true\)/);
  });
});

describe("the panel never decides mergeability for itself (§17)", () => {
  const src = source("merge-panel.tsx");

  it("renders the server's state rather than deriving one", () => {
    expect(src).toMatch(/card\.state === "merged"/);
    expect(src).toMatch(/card\.state === "ready"/);
    // The specific mistake: treating "an approval exists" as "this can merge".
    expect(src).not.toMatch(/card\.changeApprovalId\s*(!==|===)\s*null\s*\?\s*["']ready/);
  });

  it("only offers the action when the server said it may", () => {
    expect(src).toMatch(/disabled=\{[^}]*!card\.canMerge/);
  });

  it("says plainly that a blocked merge changed nothing (§29)", () => {
    expect(src).toContain("Vibe did not modify the repository.");
  });

  it("does not offer to refresh, re-prepare or regenerate after a refusal (§29)", () => {
    // Every one of those costs provider time, and starting it on the user's
    // behalf is what CLAUDE.md rule 60 forbids.
    for (const label of actionLabels(src)) {
      expect(label).not.toMatch(/refresh|re-?prepare|re-?analyz|regenerate|re-?scan/i);
    }
  });
});

describe("the refusal copy is safe (§28, §29, §30)", () => {
  const messages = readFileSync(
    join(process.cwd(), "src/modules/merge/messages.ts"),
    "utf8",
  );

  it("never blames the user for branch protection (§30)", () => {
    expect(messages).toMatch(/did not bypass the repository's protection rules/i);
    expect(messages).not.toMatch(/you must (disable|remove|turn off)/i);
  });

  it("never suggests granting broader permissions to bypass protection", () => {
    // Asking for Administration to get around a protection rule is the one
    // response this product will never offer (§10, §30).
    expect(messages).not.toMatch(/admin(istration)? permission|grant.*admin/i);
  });

  it("does not promise an untouched repository where it cannot know (§19)", () => {
    const ambiguous = messages.slice(messages.indexOf("merge_ambiguous_write:"));
    const firstMessage = ambiguous.slice(0, ambiguous.indexOf('",') + 1);
    expect(firstMessage).not.toMatch(/nothing was changed|did not modify/i);
  });

  it("does promise it where it does know", () => {
    // `blocked` is database-enforced to mean no write was attempted, so the
    // reassurance is true there.
    expect(messages).toMatch(/merge_repository_changed:[\s\S]*did not modify the repository/);
  });
});

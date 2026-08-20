import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { actionLabels } from "./test-support";

/**
 * The trust boundary, asserted against the UI source (Sprint 11B §7, §11, §22, §23).
 *
 * ## What this is, and what it is not
 *
 * This is a **source** assertion, not a rendering one. The project has no React
 * testing tooling and no browser harness, so nothing here proves what a user
 * sees — only what the component can possibly offer them. That is a real
 * limitation and it is stated plainly rather than dressed up: the sprint brief
 * asked for browser-level proof of the approval UI, and this is the closest
 * available substitute until an E2E layer exists.
 *
 * ## Why it is worth having anyway
 *
 * Because the specific regression it catches is catastrophic and cheap to
 * introduce. Sprint 11B implements approval and nothing else — no merge, no
 * deploy, no ship. A button carrying one of those words is a promise the
 * product cannot keep, and a user who presses it has been misled about what
 * their click did. A greyed-out **Merge** would be the same promise with a
 * delay on it.
 */

const DIR = join(process.cwd(), "src/app/app/projects/[projectId]");

function source(file: string): string {
  return readFileSync(join(DIR, file), "utf8");
}

/**
 * The inner text of every button and link the component can render.
 *
 * The `=>` alternative is load-bearing: an arrow function in an attribute —
 * `onClick={() => setConfirming("revoke")}` — contains a `>`, and a naive tag
 * scan ends the opening tag there and reads half the attributes as the label.
 */
/**
 * Words that would each claim an authority this product does not have.
 *
 * `ready` and `live` are here for the same reason as the rest: §22 forbids
 * them because a reader acts on them, not because they are rude.
 */
const FORBIDDEN = /\b(merge|merged|deploy|deployed|ship|shipped|publish|published|live)\b/i;

/**
 * The same list, minus merging — for the one panel where merging is real.
 *
 * Sprint 11C implemented merge, so a **Merge approved change** button is now an
 * honest control rather than a promise the product cannot keep. Nothing else on
 * this list became true: Vibe still deploys nothing, ships nothing, publishes
 * nothing, and nothing it does is live.
 *
 * Kept as a separate constant rather than by loosening `FORBIDDEN` so the
 * exemption is visible and scoped. Every other panel is still held to the
 * original list, including the word merge — a Merge button in the *validation*
 * panel would be exactly as wrong today as it was last sprint.
 */
const FORBIDDEN_EXCEPT_MERGE = /\b(deploy|deployed|ship|shipped|publish|published|live)\b/i;

describe("the approval panel offers approval and nothing more", () => {
  const src = source("approval-panel.tsx");

  it("has no action claiming merge, deploy, ship or publish authority", () => {
    for (const label of actionLabels(src)) {
      expect(label).not.toMatch(FORBIDDEN);
    }
  });

  it("offers exactly the actions this sprint implements", () => {
    const labels = actionLabels(src)
      .map((label) => label.replace(/\{[\s\S]*?\}/g, " ").trim())
      .filter(Boolean);

    // Approve, revoke, and the two dialogs' cancels. Nothing else has a button.
    for (const label of labels) {
      expect(["Approve change", "Cancel", "Revoke approval"]).toContain(label);
    }
  });

  it("states what approval is not, wherever approval is shown", () => {
    // The place a user is most likely to assume more happened than did: they
    // just pressed a button called Approve.
    expect(src).toContain("Nothing has been merged or deployed.");
  });

  it("sends an explicit confirmation to the server rather than relying on the dialog", () => {
    // The dialog closing is a fact about a browser. The boolean is the thing
    // the server refuses without (§8).
    expect(src).toMatch(/approveChangeAction\([^)]*true\)/);
    expect(src).toMatch(/revokeApprovalAction\([^)]*true\)/);
  });

  it("never decides approval state for itself", () => {
    // Whether something is approved is a comparison between an approval's bound
    // artifact and the artifact on screen. A component holding props cannot
    // make it honestly, so it renders the server's answer (§24).
    expect(src).not.toMatch(/card\.approvalId\s*(!==|===)\s*null\s*\?\s*["']approved/);
    expect(src).toMatch(/card\.state === "approved"/);
  });
});

describe("no deploy affordance exists anywhere in the project page", () => {
  const files = [
    "approval-panel.tsx",
    "review-panel.tsx",
    "preview-panel.tsx",
    "validation-panel.tsx",
    "prepared-changes-section.tsx",
  ];

  it("has no approve-and-merge, merge, deploy or ship control outside the merge panel", () => {
    // Merging exists now, and exactly one panel may offer it. A Merge button in
    // the validation or review panel would still be a control that claims an
    // authority its own section has not established.
    for (const file of files) {
      for (const label of actionLabels(source(file))) {
        expect(label, `${file} renders a forbidden action`).not.toMatch(FORBIDDEN);
      }
    }
  });

  it("has no deploy, ship or publish control in the merge panel either", () => {
    // The one place the temptation is real: a user who just merged is one
    // button away from expecting a deploy, and Vibe has no deployment gate.
    for (const label of actionLabels(source("merge-panel.tsx"))) {
      expect(label, "merge-panel.tsx renders a forbidden action").not.toMatch(
        FORBIDDEN_EXCEPT_MERGE,
      );
    }
  });

  it("renders the gates in the order they must be passed", () => {
    // Validation → preview → review → approval → merge. The order on screen is
    // the order of the gates, and merge is last because it is the only one that
    // writes somewhere a user's product runs from.
    const section = source("prepared-changes-section.tsx");
    expect(section.indexOf("<ReviewPanel")).toBeLessThan(section.indexOf("<ApprovalPanel"));
    expect(section.indexOf("<ApprovalPanel")).toBeLessThan(section.indexOf("<MergePanel"));
  });
});

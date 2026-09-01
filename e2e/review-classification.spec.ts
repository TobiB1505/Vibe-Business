import { expect, test, type Page } from "@playwright/test";

/**
 * Which review a change actually gets, in a real browser (Sprint 0055, ADR 0063).
 *
 * ## Why this suite exists
 *
 * Because the change it covers is a change to what a screen *offers*, and this
 * project's own rule 69 names the failure mode it keeps paying for: the domain
 * tested, the SQL tested, and the screen untested.
 *
 * The domain says a code-only change may be approved without a comparison. What
 * a founder has to see is narrower and only a browser can prove it: the Approve
 * control is there, the preview and comparison panels are **not**, and the card
 * says why — because a missing panel with no sentence beside it reads as a bug,
 * not as a decision.
 *
 * ## What it does not prove
 *
 * The wiring in `agent/page.tsx` that produces these states, or RLS. The states
 * come from fixtures; that gap is real and is the same one `merge-ui.spec.ts`
 * records.
 */

/** The card, scoped so a heading elsewhere on the page cannot answer for it. */
function card(page: Page) {
  return page.locator('[data-testid="prepared-change"]');
}

/** One panel, by its own direct-child heading. Same scoping as the merge suite. */
function panel(page: Page, heading: string) {
  return page.locator(`section:has(> h4:text-is("${heading}"))`);
}

test.describe("a change with nothing to look at", () => {
  test("offers approval with no comparison, and says why", async ({ page }) => {
    await page.goto("/e2e/change_code_review_ready");

    await expect(card(page)).toBeVisible();

    // The classification, in Vibe's own words. Without this line the absence
    // below is indistinguishable from Vibe having forgotten.
    await expect(panel(page, "What changed")).toContainText("Code diff");
    await expect(panel(page, "What changed")).toContainText(
      "This change does not alter a rendered page. Reading the diff is the review.",
    );

    // The panels that would have blocked this change are gone, not disabled.
    // Offering to photograph a page that did not change is offering to spend a
    // founder's money on two identical images.
    await expect(panel(page, "Preview")).toHaveCount(0);
    await expect(panel(page, "Review")).toHaveCount(0);

    // And the decision is available, which before this sprint it was not.
    await expect(page.getByRole("button", { name: "Approve change" })).toBeVisible();
  });

  test("does not claim it was previewed or reviewed", async ({ page }) => {
    await page.goto("/e2e/change_code_review_ready");

    // The false-status-line class of defect UI-5 exists to remove. This change
    // was never previewed and never photographed.
    await expect(card(page)).not.toContainText("Checked, previewed and approved");
  });

  test("never offers to start a preview or a comparison", async ({ page }) => {
    await page.goto("/e2e/change_code_review_ready");

    for (const forbidden of ["Start temporary preview", "Generate comparison"]) {
      await expect(page.getByRole("button", { name: forbidden })).toHaveCount(0);
    }
  });
});

test.describe("a change that alters a page", () => {
  test("still asks to be looked at", async ({ page }) => {
    // The other half of the property. Removing one gate must not remove both,
    // and `visual_and_code` deliberately keeps the visual one: half a change
    // being visible is a whole reason to look at it.
    //
    // What it asks for is the preview itself since Sprint 0114. The comparison
    // panel renders only for a change that has a historical artifact, which
    // this fixture still does — nothing creates a new one (ADR 0065).
    await page.goto("/e2e/change_awaiting_approval");

    await expect(panel(page, "Preview")).toBeVisible();
    await expect(panel(page, "What changed")).toContainText("Preview and code diff");
  });
});

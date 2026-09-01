import { expect, test, type Page } from "@playwright/test";

/**
 * The preview, before the check and instead of the screenshots (Sprint 0114).
 *
 * ## Why this suite exists
 *
 * Because both halves of this sprint are changes to what a screen *offers*, and
 * neither is provable anywhere else. The domain says a preview may start before
 * validation and that a visual approval binds to it; the SQL says a row may
 * exist. What a founder actually meets is a button that is there or is not, and
 * a sentence that is true or is not — rule 69's third question, and the one this
 * project keeps paying for.
 *
 * ## What it does not prove
 *
 * That `next dev` starts under `deny_all` with an exposed port, or that the
 * first-request compile fits the health budget. Those are sandbox facts and only
 * a dogfood run answers them; the states here come from fixtures, the same gap
 * `merge-ui.spec.ts` records.
 */

/** The card, scoped so a heading elsewhere on the page cannot answer for it. */
function card(page: Page) {
  return page.locator('[data-testid="prepared-change"]');
}

/** One panel, by its own direct-child heading. Same scoping as the merge suite. */
function panel(page: Page, heading: string) {
  return page.locator(`section:has(> h4:text-is("${heading}"))`);
}

test.describe("a preview offered while the check is still running", () => {
  test("offers the preview before validation has finished", async ({ page }) => {
    await page.goto("/e2e/preview_before_validation");

    await expect(card(page)).toBeVisible();

    // The whole sprint, as one assertion. This button was disabled until a
    // build existed, which is roughly five minutes after the code was written.
    await expect(page.getByRole("button", { name: "Start temporary preview" })).toBeEnabled();
  });

  test("never calls the preview checked", async ({ page }) => {
    await page.goto("/e2e/preview_before_validation");

    // The claim `next dev` cannot support, and the reason ADR 0016 §7 had to be
    // superseded openly rather than quietly reversed: this is the prepared code
    // running, not the application that passed a check.
    await expect(panel(page, "Preview")).toContainText(
      "It is the prepared code running, not a checked build.",
    );
  });

  test("still refuses to let anyone approve it yet", async ({ page }) => {
    await page.goto("/e2e/preview_before_validation");

    // A preview lets somebody look earlier. It never lets them decide earlier —
    // validation stays a hard gate on approval (ADR 0064).
    await expect(page.getByRole("button", { name: "Approve change" })).toHaveCount(0);
  });
});

test.describe("the before half", () => {
  test("links the live site as it is now", async ({ page }) => {
    await page.goto("/e2e/change_visual_preview_ready");

    const live = page.getByRole("link", { name: "Open your live site now" });
    await expect(live).toHaveAttribute("href", "https://vibe-e2e.example");
    // Someone else's origin, in someone else's tab. Never embedded in Vibe's.
    await expect(live).toHaveAttribute("target", "_blank");
  });
});

test.describe("a visual change approved on its preview", () => {
  test("offers approval with no comparison anywhere", async ({ page }) => {
    await page.goto("/e2e/change_visual_preview_ready");

    // The panel that used to stand between a preview and a decision is gone —
    // not empty, not disabled, absent. Nothing creates a comparison any more.
    await expect(panel(page, "Review")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Approve change" })).toBeVisible();
  });

  test("never offers to generate a comparison", async ({ page }) => {
    for (const scenario of ["change_visual_preview_ready", "preview_before_validation"]) {
      await page.goto(`/e2e/${scenario}`);
      await expect(page.getByRole("button", { name: "Generate comparison" })).toHaveCount(0);
    }
  });
});

test.describe("a visual change nobody has previewed", () => {
  test("asks for a preview rather than for a comparison", async ({ page }) => {
    await page.goto("/e2e/change_agentic_review_required");

    // The sentence a person can act on. "Generate a comparison" pointed at a
    // panel that itself required a preview nobody had started.
    await expect(card(page)).toContainText("Start a preview and look at the change first");
    await expect(page.getByRole("button", { name: "Approve change" })).toHaveCount(0);
  });
});

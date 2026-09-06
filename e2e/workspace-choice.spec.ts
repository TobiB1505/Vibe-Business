import { expect, test, type Page } from "@playwright/test";

/**
 * "Which app should Vibe work on?", in a real browser (Stufe 4).
 *
 * ## Why this suite exists
 *
 * Two things live here that no unit test can reach, and rule 69 names both.
 *
 * The first is **an absence**. A workspace root becomes the directory a sandbox
 * runs a customer's build in, and the guarantee is that a founder answers by
 * picking from a list Vibe derived from tree entries it read itself — never by
 * typing a path. `selectValidationTarget` enforces that by matching against its
 * own candidates, and `workspace.test.ts` asserts the mechanism. What only a
 * rendered DOM can say is that the screen offers no field to type into. An
 * absence is only an absence once something has looked.
 *
 * The second is whether a founder can **tell the applications apart**. A list
 * that renders `apps/web` and `apps/marketing` identically passes every
 * assertion about its data and still asks a question nobody can answer.
 *
 * ## What it does not prove
 *
 * The wiring in `agent/page.tsx` that produces this state, the server action, or
 * RLS. The candidates come from the real resolver through a fixture; the
 * remaining gap is the same one `review-classification.spec.ts` records, and the
 * SQL suite covers the ownership half separately.
 */

async function open(page: Page, scenario: string) {
  await page.goto(`/e2e/${scenario}`);
  await expect(page.getByTestId("agent-workspace-choice")).toBeVisible();
}

test.describe("a repository with more than one application", () => {
  test("asks which one, and offers exactly the ones Vibe found", async ({ page }) => {
    await open(page, "workspace-choice");

    const candidates = page.getByTestId("agent-workspace-candidate");
    await expect(candidates).toHaveCount(2);

    // Told apart by the only thing that distinguishes them — the directory.
    await expect(candidates.filter({ hasText: "apps/marketing" })).toBeVisible();
    await expect(candidates.filter({ hasText: "apps/web" })).toBeVisible();
  });

  /*
   * The assertion this file exists for.
   *
   * A text field would be a way to name a directory Vibe never offered. The
   * resolver would still refuse it — the safety does not rest here — but a
   * screen that invites an answer it will then reject is a screen that lies
   * about what the founder is choosing between.
   */
  test("offers no way to type a path", async ({ page }) => {
    await open(page, "workspace-choice");

    await expect(page.locator("input")).toHaveCount(0);
    await expect(page.locator("textarea")).toHaveCount(0);
    await expect(page.locator("[contenteditable]")).toHaveCount(0);
  });

  test("says choosing is free and starts nothing", async ({ page }) => {
    // The screen's subject is what Vibe is about to do, so a control that
    // quietly began a priced run would be the worst possible surprise on it.
    await open(page, "workspace-choice");

    const question = page.getByTestId("agent-workspace-choice");
    await expect(question).toContainText("free");
    await expect(question).toContainText("Nothing starts running");
  });

  test("gives every application its own control", async ({ page }) => {
    await open(page, "workspace-choice");

    const controls = page.getByTestId("agent-workspace-choose");
    await expect(controls).toHaveCount(2);
    await expect(controls.first()).toBeEnabled();
  });

  test("does not scroll sideways at 375px", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await open(page, "workspace-choice");

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe("once somebody has answered", () => {
  test("says which application Vibe works on", async ({ page }) => {
    await open(page, "workspace-choice-answered");

    const chosen = page
      .getByTestId("agent-workspace-candidate")
      .filter({ has: page.locator('[data-chosen="true"]') })
      .or(page.locator('[data-testid="agent-workspace-candidate"][data-chosen="true"]'));

    await expect(chosen).toHaveCount(1);
    await expect(chosen).toContainText("apps/web");
  });

  test("keeps the other application choosable, because this is reversible", async ({ page }) => {
    // The copy promises the choice can change. A screen that then disabled every
    // control would have made that sentence false.
    await open(page, "workspace-choice-answered");

    const other = page.locator(
      '[data-testid="agent-workspace-choose"][data-workspace-root="apps/marketing"]',
    );
    await expect(other).toBeEnabled();

    const current = page.locator(
      '[data-testid="agent-workspace-choose"][data-workspace-root="apps/web"]',
    );
    await expect(current).toBeDisabled();
    await expect(current).toContainText("Working on this");
  });
});

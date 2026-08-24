import { expect, test } from "@playwright/test";

/**
 * The audit's lifecycle states, in a real browser (AUDIT UI-1 §28–§37).
 *
 * ## Why these are their own suite
 *
 * Because the failure mode is a screen that *claims* something. A running
 * audit that says "5 of 9 lenses" when the backend produces all nine at once
 * is a lie the code cannot detect and a unit test cannot see; so is a
 * preparing state that shows last week's health values as if they were this
 * run's. Both look completely reasonable in a screenshot.
 *
 * So most of what follows asserts the **absence** of a claim.
 *
 * ## What these do not cover
 *
 * That a paused audit spends no tokens, and that answering resumes exactly
 * once. Those are properties of the durable pipeline, not of a screen — they
 * are guarded by the status-matched writes in `store.ts` and their unit tests.
 * The browser's share is narrower: that the page does not *say* work is
 * happening while the audit is waiting.
 */

const PREPARING = "/e2e/audit-preparing";
const ANALYZING = "/e2e/audit-analyzing";
const WAITING = "/e2e/audit-waiting";
const COMPLETED = "/e2e/audit-synthesis";

test.describe("preparing claims nothing about the business (§31, §35, §36)", () => {
  test("names the nine areas without judging any of them", async ({ page }) => {
    await page.goto(PREPARING);

    await expect(page.getByText("Revenue & Economics").filter({ visible: true })).toBeVisible();
    await expect(page.getByText("Business Readiness").filter({ visible: true })).toBeVisible();
  });

  /**
   * The stale-as-current defect. A dimmed version of the previous audit's
   * verdicts here would be the most natural thing to build and would tell a
   * founder that Vibe has already decided.
   */
  test("shows no health and no priority anywhere", async ({ page }) => {
    await page.goto(PREPARING);

    await expect(page.getByText(/\b(strong|adequate|weak)\b/i)).toHaveCount(0);
    await expect(page.getByText(/needs attention now/i)).toHaveCount(0);
  });

  test("says plainly that nothing has been judged", async ({ page }) => {
    await page.goto(PREPARING);
    await expect(page.getByText(/nothing has been judged yet/i)).toBeVisible();
  });
});

test.describe("analyzing invents no progress (§29, §30)", () => {
  /**
   * The one thing the 1b mockup does that this architecture cannot honestly
   * reproduce. All nine lenses arrive from a single inference call, so there
   * is no moment at which five are finished.
   */
  test("claims no per-lens completion", async ({ page }) => {
    await page.goto(ANALYZING);

    await expect(page.getByText(/\d\s*\/\s*9/)).toHaveCount(0);
    await expect(page.getByText(/\bcomplete[d]?\b/i)).toHaveCount(0);
    await expect(page.getByText(/%/)).toHaveCount(0);
  });

  test("says what is actually true — all nine judged together", async ({ page }) => {
    await page.goto(ANALYZING);

    await expect(page.getByText(/reading the whole business/i)).toBeVisible();
    await expect(page.getByText(/judged together, so there is no order to watch/i)).toBeVisible();
  });

  /** Still no verdicts: analyzing is not a preview of the result. */
  test("shows no health or priority while thinking", async ({ page }) => {
    await page.goto(ANALYZING);

    await expect(page.getByText(/\b(strong|adequate|weak)\b/i)).toHaveCount(0);
  });

  /**
   * Scoped to `main`, because Next renders its own route announcer with
   * `aria-live="assertive"` on every page. Asserting against the document
   * catches the framework — the same mistake the needs-user suite made with
   * `role="alert"`.
   */
  test("announces itself to assistive technology without shouting", async ({ page }) => {
    await page.goto(ANALYZING);

    await expect(page.locator("main [aria-live='polite']")).toHaveCount(1);
    await expect(page.locator("main [aria-live='assertive']")).toHaveCount(0);
  });
});

test.describe("waiting is paused, not running (§33, §34)", () => {
  /**
   * The mockup's one factual error, and the one worth correcting loudest: it
   * says "the scan keeps running". It does not — the audit has stopped and has
   * spent nothing, which is also a better thing to tell someone who is about
   * to take their time over an answer.
   */
  test("never claims the audit is still working", async ({ page }) => {
    await page.goto(WAITING);

    await expect(page.getByText(/keeps running/i)).toHaveCount(0);
    await expect(page.getByText(/reading the whole business/i)).toHaveCount(0);
    await expect(page.getByText(/analyzing/i)).toHaveCount(0);
  });

  test("says the audit is waiting and that nothing has been spent", async ({ page }) => {
    await page.goto(WAITING);

    await expect(page.getByRole("heading", { name: /waiting for you/i })).toBeVisible();
    await expect(page.getByText(/nothing has been spent while it waits/i)).toBeVisible();
  });

  /** §34 — a collaboration state, never a failed scan. */
  test("uses no failure language", async ({ page }) => {
    await page.goto(WAITING);

    await expect(page.getByText(/failed|error|problem|couldn.t complete/i)).toHaveCount(0);
  });

  test("puts the question inside the audit, with its own heading above it", async ({ page }) => {
    await page.goto(WAITING);

    const waiting = await page
      .getByRole("heading", { name: /waiting for you/i })
      .boundingBox();
    const question = await page.getByRole("heading", { level: 3 }).first().boundingBox();

    expect(waiting!.y).toBeLessThan(question!.y);
  });
});

test.describe("completed is the only state with verdicts (§37)", () => {
  test("resolves into real health and priority values", async ({ page }) => {
    await page.goto(COMPLETED);

    /*
     * Scoped to the map: since UI-1.2 a lens name also appears on the priority
     * that spans it, and the health/priority words are the map node's claim.
     */
    const revenue = page
      .getByTestId("audit-map-panel")
      .getByRole("button", { name: /revenue & economics/i });

    await expect(revenue).toContainText(/weak/i);
    await expect(revenue).toHaveAttribute("data-priority", "soon");
  });

  /** And carries none of the in-progress language with it. */
  test("no longer says it is preparing or reading", async ({ page }) => {
    await page.goto(COMPLETED);

    await expect(page.getByText(/nothing has been judged yet/i)).toHaveCount(0);
    await expect(page.getByText(/reading the whole business/i)).toHaveCount(0);
  });
});

test.describe("375px", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("every lifecycle state fits a phone", async ({ page }) => {
    for (const url of [PREPARING, ANALYZING, WAITING]) {
      await page.goto(url);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `${url} scrolls sideways`).toBeLessThanOrEqual(0);
    }
  });
});

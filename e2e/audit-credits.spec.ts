import { expect, test } from "@playwright/test";

/**
 * The spent-entitlement gate, in a real browser (BILLING CORE-2 §39, §43).
 *
 * ## The defect this exists to prevent
 *
 * A founder opened the Business score page on a project whose free audit was
 * spent, with 6,080 Credits in the account, and saw all three of these at once:
 *
 * ```
 * [ Re-run business audit ]  (disabled)   35 Credits
 * KEEP VIBE WORKING — … they aren't available yet.
 * ```
 *
 * Every layer beneath it was right. `startBusinessAudit` had been routing
 * `credits_required` into a reservation since Core-2, the price was correct,
 * the balance was correct. The page was the only thing that was wrong, and no
 * test in the repository could see a page (CLAUDE.md rule 69).
 *
 * ## What only a browser proves here
 *
 * That the three elements **agree**. Any one of them can be asserted in a unit
 * test; their mutual consistency is a property of a render, and the failure was
 * exactly a disagreement between them.
 */

const PAYABLE = "/e2e/audit-credits-payable";
const SHORT = "/e2e/audit-credits-short";
const EXACT = "/e2e/audit-credits-exact";

const RUN_AUDIT = /re-run business audit/i;

test.describe("a spent entitlement the customer can pay past", () => {
  test("leaves the button usable rather than presenting a wall", async ({ page }) => {
    await page.goto(PAYABLE);

    await expect(page.getByRole("button", { name: RUN_AUDIT })).toBeEnabled();
  });

  /**
   * The literal sentence from the screenshot. Kept as a test rather than only
   * deleted, so nothing reintroduces it while the balance is sufficient.
   */
  test("never claims Credits are unavailable while the account holds them", async ({ page }) => {
    await page.goto(PAYABLE);

    await expect(page.getByText(/aren.t available yet/i)).toHaveCount(0);
    await expect(page.getByText(/not enough credits/i)).toHaveCount(0);
  });

  test("states the price and the balance in the same sentence", async ({ page }) => {
    await page.goto(PAYABLE);

    const notice = page.getByText(/running another one costs/i);
    await expect(notice).toContainText("35 Credits");
    await expect(notice).toContainText("6,080");
  });

  /**
   * The price beside the button and the price in the sentence are rendered by
   * different components from the same policy. If they ever disagree, the
   * screen is once again arguing with itself.
   */
  test("shows one price, not two different ones", async ({ page }) => {
    await page.goto(PAYABLE);

    await expect(page.getByText("35 Credits").first()).toBeVisible();
    await expect(page.getByText(/\b(?!35\b)\d+ Credits\b/)).toHaveCount(0);
  });

  test("treats an exactly sufficient balance as payable", async ({ page }) => {
    await page.goto(EXACT);

    await expect(page.getByRole("button", { name: RUN_AUDIT })).toBeEnabled();
  });
});

test.describe("a spent entitlement the customer cannot pay past", () => {
  test("disables the button — the one state where that is honest", async ({ page }) => {
    await page.goto(SHORT);

    await expect(page.getByRole("button", { name: RUN_AUDIT })).toBeDisabled();
  });

  /**
   * §43: "you need 35, you have 20", not an unexplained refusal. A customer who
   * is told only that they cannot proceed has no way to work out what to do.
   */
  test("names both numbers rather than refusing in the abstract", async ({ page }) => {
    await page.goto(SHORT);

    const notice = page.getByText(/another business audit costs/i);
    await expect(notice).toContainText("35 Credits");
    await expect(notice).toContainText("20");
  });

  test("offers the way out, and it goes to billing", async ({ page }) => {
    await page.goto(SHORT);

    await expect(page.getByRole("link", { name: /top up/i })).toHaveAttribute(
      "href",
      "/app/billing",
    );
  });
});

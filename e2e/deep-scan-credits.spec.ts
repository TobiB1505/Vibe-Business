import { expect, test } from "@playwright/test";

/**
 * The Deep Scan panel under `launch-v1`.
 *
 * PRODUCT.md §12.1 has said additional Deep Scans are credit-gated since Sprint
 * 5, and until now the panel's answer was a disabled "Coming with Vibe Credits".
 * `launch-v1` puts a button there that spends 25 Credits.
 *
 * A domain test proves the entitlement resolves to `credits` and that only a
 * persisted snapshot settles the hold. Only a browser proves the person is told
 * the price — and told what happens when a scan comes back with nothing —
 * before they click ([CLAUDE.md](../CLAUDE.md) rule 69).
 */

test.describe("an additional Deep Scan, priced", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/e2e/deep-scan-additional-available");
  });

  test("states the price before the click, not after it", async ({ page }) => {
    await expect(page.getByText("Another one costs 25 Credits.")).toBeVisible();
  });

  test("puts the price on the control that spends it", async ({ page }) => {
    // A cost revealed after the click is a surprise, and a surprise is what a
    // Credit system exists to avoid.
    await expect(page.getByRole("button", { name: /Run Deep Scan · 25 Credits/ })).toBeEnabled();
  });

  test("says that a scan which finds nothing is not charged", async ({ page }) => {
    // The hold is released on every outcome that does not persist a snapshot.
    // Somebody deciding whether to spend deserves to know that while deciding.
    await expect(page.getByText("You're only charged if Vibe comes back with a result.")).toBeVisible();
  });

  test("offers no checkout it cannot honour", async ({ page }) => {
    await expect(page.getByRole("link", { name: "Top up Credits" })).toHaveCount(0);
  });
});

test.describe("an additional Deep Scan the balance cannot cover", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/e2e/deep-scan-insufficient-credits");
  });

  test("names the price and says the balance is short", async ({ page }) => {
    await expect(
      page.getByText(/Another Deep Scan costs 25 Credits, and your balance doesn.t cover it yet\./),
    ).toBeVisible();
  });

  test("sends the customer somewhere that can fix it", async ({ page }) => {
    // The difference between this state and `credits_required`: this one has a
    // checkout behind it.
    await expect(page.getByRole("link", { name: "Top up Credits" })).toHaveAttribute(
      "href",
      "/app/billing",
    );
  });

  test("does not offer a start it would refuse", async ({ page }) => {
    await expect(page.getByRole("button", { name: /Run Deep Scan/ })).toHaveCount(0);
  });
});

test.describe("an additional Deep Scan that is not for sale", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/e2e/deep-scan-credits-required");
  });

  test("explains rather than sells, and invents no price", async ({ page }) => {
    // Reachable only when no policy prices an additional scan. The honest
    // terminal answer, and not a route into a checkout that cannot help.
    await expect(page.getByText(/aren.t available right now/)).toBeVisible();

    const text = await page.locator("body").innerText();
    expect(text).not.toContain("Credits");
  });

  test("offers no control at all", async ({ page }) => {
    await expect(page.getByRole("button", { name: /Run Deep Scan/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Top up Credits" })).toHaveCount(0);
  });
});

/*
 * Slice 3: a finished scan says what it could not check, behind a disclosure.
 * The snapshot has carried these warnings since it existed and the view model
 * dropped them, so "Check finished: only partly" was the entire account of a
 * scan that had specific things to report.
 */
test.describe("what a finished scan could not check", () => {
  test("keeps the caveats behind a label that counts them", async ({ page }) => {
    await page.goto("/e2e/deep-scan-completed-with-warnings");

    // The result leads. The caveats are not above it.
    await expect(page.getByText("Pages Vibe looked at")).toBeVisible();

    const disclosure = page.getByText("2 things Vibe could not check");
    await expect(disclosure).toBeVisible();

    // Counted before it is opened, so the label is the size of what is behind it.
    await expect(page.getByText(/took too long to load/i)).toBeHidden();
    await disclosure.click();
    await expect(page.getByText(/took too long to load/i)).toBeVisible();
    await expect(page.getByText(/could not tell two settings pages apart/i)).toBeVisible();
  });
});

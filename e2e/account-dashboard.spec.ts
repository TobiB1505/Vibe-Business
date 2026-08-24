import { expect, test } from "@playwright/test";

/**
 * The account dashboard's density budget (CORE-6).
 *
 * ## Why a browser test rather than a review note
 *
 * Because "the account level must feel calmer than the project level" is a
 * claim about pixels, and a target nothing enforces erodes on the next commit.
 * Every section anyone adds here will be defensible on its own — a usage strip,
 * a recent-activity list, a repository count, a plan nudge — and the sum is the
 * admin panel this screen was rebuilt to stop being.
 *
 * ## What the numbers are
 *
 * CORE-6 removed the attention list and the activity feed from `/app`. The
 * reference-led pass that followed adds useful structure inside the same four
 * objects — signal, next move, products and connect — without bringing either
 * feed back.
 *
 * The ceiling below is 36, so a couple of small additions still fit and a
 * fourth section (five elements or more) does not. It is measured against
 * `AccountHome`, the same component `/app` renders — a composition this file
 * assembled itself would measure a screen that exists nowhere.
 */

const THREE = "/e2e/account-three-products";
const UNSCORED = "/e2e/account-unscored";

/**
 * One element per discrete thing a person has to read or decide about: a mono
 * label, a heading, a sentence, a link, a button. Deliberately not every DOM
 * node — the count has to mean something a designer would recognise.
 */
const ELEMENTS = "[data-mono-label], h1, h2, h3, p, a, button";

/** Measured at three products, plus room for two small additions. */
const BUDGET = 36;

test.describe("the account dashboard stays calmer than the project workspace", () => {
  test("keeps the whole screen inside its element budget at three products", async ({ page }) => {
    await page.goto(THREE);

    const count = await page.getByTestId("account-home").locator(ELEMENTS).count();

    expect(
      count,
      `Home renders ${count} elements at three products, over the ${BUDGET} budget. ` +
        "Something was added to the calmest screen in the product — take something off, " +
        "or argue for a new ceiling in the sprint record.",
    ).toBeLessThanOrEqual(BUDGET);
  });

  /**
 * The reference gives every card three useful `label: value` rows. Those rows
 * are now present, but the card still gets exactly one action — three ways out
 * of one card would turn a summary into a miniature workspace.
 */
  test("gives a product card three facts and one action", async ({ page }) => {
    await page.goto(THREE);

    const cards = page.getByTestId("product-card");
    await expect(cards).toHaveCount(3);

    for (const card of await cards.all()) {
      await expect(card.locator("dt")).toHaveCount(3);
      expect(await card.locator("a, button").count()).toBeLessThanOrEqual(1);
    }
  });

  test("keeps the reference hierarchy without inventing a time filter", async ({ page }) => {
    await page.goto(THREE);

    await expect(page.getByRole("heading", { name: "Business signal" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Next move" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Your products" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Connect a new product" })).toBeVisible();
    await expect(page.getByRole("button", { name: /last 7 days/i })).toHaveCount(0);
  });

  test("reveals account actions from the profile control", async ({ page }) => {
    await page.goto(THREE);

    const menu = page.getByTestId("account-menu");
    await expect(menu.getByRole("link", { name: /profile/i })).toBeHidden();

    await menu.locator("summary").click();

    await expect(menu.getByRole("link", { name: /profile/i })).toBeVisible();
    await expect(menu.getByRole("link", { name: /settings/i })).toBeVisible();
    await expect(menu.getByRole("link", { name: /billing/i })).toBeVisible();
    await expect(menu.getByRole("button", { name: /sign out/i })).toBeVisible();
  });

  /**
   * Both sections left in CORE-6 and neither may come back here. The attention
   * list said per-product what each card's single action already says; the
   * activity feed was eight rows of metadata with no action at all.
   */
  test("renders no attention list and no activity feed", async ({ page }) => {
    await page.goto(THREE);

    await expect(page.getByTestId("attention-list")).toHaveCount(0);
    await expect(page.getByTestId("dashboard-activity")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /recent activity/i })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /needs your attention/i })).toHaveCount(0);
  });
});

test.describe("the hero is about one named product", () => {
  test("names the product that needs attention, not the account", async ({ page }) => {
    await page.goto(THREE);

    // "Needs You Now" is the only fixture with a failed validation, so it is
    // first by attention tier — and the hero must be that one rather than the
    // newest or the highest-scoring.
    const hero = page.getByRole("region", { name: "Needs You Now" });
    await expect(hero.getByRole("link", { name: "Needs You Now" })).toBeVisible();
    // Scoped to the hero: the same product's card below shows 46 too, and a
    // page-wide match would pass on the card alone while the hero was blank.
    await expect(hero.getByText("46")).toBeVisible();

    // No invented account-level figure anywhere on the screen.
    await expect(page.getByText(/overall score/i)).toHaveCount(0);
    await expect(page.getByText(/average/i)).toHaveCount(0);
  });

  test("explains a broken line instead of drawing a trend through it", async ({ page }) => {
    await page.goto(THREE);

    await expect(page.getByText(/changed how it scores/i)).toBeVisible();
    await expect(page.getByText(/not comparable/i)).toBeVisible();
  });

  test("shows a sentence rather than a zero for a product with no audit", async ({ page }) => {
    await page.goto(UNSCORED);

    await expect(page.getByText("Vibe hasn't analysed this product yet.")).toBeVisible();
    // Rule 44 in the place it would actually break: the ring must not render.
    await expect(page.getByText("/ 100")).toHaveCount(0);
    await expect(page.getByText("0", { exact: true })).toHaveCount(0);
  });
});

for (const width of [1440, 1024, 768, 375]) {
  test(`the dashboard and account rail fit at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(THREE);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

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
 * CORE-6 removed the attention list and the activity feed from `/app`, and the
 * ceiling was 36: room for a couple of small additions and not for a fourth
 * section.
 *
 * **The attention model came back, and the ceiling moved with it.** The
 * argument is in `attention-stack.tsx` and the short form is that a product
 * raises more than one item — `attention.ts` says in its own comment that
 * hiding the second behind the first means the user never sees it — and a card
 * has one action. Measured on the three-product fixture, a blocked validation
 * was reachable from nowhere on this screen.
 *
 * What the budget exists to stop is a screen that grows unrelated strips, and
 * the *object* count is unchanged at four: the signal and the next move are
 * one card, the stack takes the column beside it, and connect moved into that
 * column. Measured today: 31, of which the stack is 7. Its worst case is four
 * rows rather than two, which is 37, so the ceiling is 40 — the same three or
 * four elements of headroom the old number left.
 *
 * It is measured against `AccountHome`, the same component `/app` renders — a
 * composition this file assembled itself would measure a screen that exists
 * nowhere.
 */

const THREE = "/e2e/account-three-products";
const UNSCORED = "/e2e/account-unscored";

/**
 * One element per discrete thing a person has to read or decide about: a mono
 * label, a heading, a sentence, a link, a button. Deliberately not every DOM
 * node — the count has to mean something a designer would recognise.
 */
const ELEMENTS = "[data-mono-label], h1, h2, h3, p, a, button";

/** Measured at three products with a full attention stack, plus headroom. */
const BUDGET = 40;

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
   * The activity feed stays gone. It was eight rows of metadata with no action
   * at all, and nothing about it has changed.
   *
   * The attention list is the half that came back, and it came back as a
   * ranked stack beside the hero rather than as a strip above the grid —
   * because what it uniquely carries is the *tier* and the second item a
   * product raises, neither of which fits on a card with one action.
   */
  test("renders no activity feed, and no second copy of the ranking", async ({ page }) => {
    await page.goto(THREE);

    await expect(page.getByTestId("dashboard-activity")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /recent activity/i })).toHaveCount(0);

    // One stack, not one per section.
    await expect(page.getByRole("heading", { name: "Also waiting" })).toHaveCount(1);
  });

  /**
   * The row the old screen could not show anywhere.
   *
   * Payflow raises two items — a failed validation and waiting moves. The hero
   * answers the moves; the card below says "Review change", which is the
   * *waiting* change, not the failed one. So before this stack existed, the
   * word "failed" appeared nowhere on the dashboard for a product whose
   * validation had failed.
   */
  test("shows a second item from a product the hero already covers", async ({ page }) => {
    await page.goto(THREE);

    const stack = page.getByRole("region", { name: "Also waiting" });
    await expect(stack).toContainText("Payflow");
    await expect(stack).toContainText(/failed validation/i);
    await expect(stack).toContainText("Blocked");

    // And it does not repeat what the hero's own control already offers.
    await expect(stack).not.toContainText(/View action plan/i);
  });
});

test.describe("the hero is about one named product", () => {
  test("names the product that needs attention, not the account", async ({ page }) => {
    await page.goto(THREE);

    // The "Needs You Now" project is the only fixture with a failed validation,
    // so it is first by attention tier — and the hero must be that one rather
    // than the newest or the highest-scoring. It is named by its *product*
    // name, Payflow, which is what every surface on this screen calls it.
    //
    // The region's accessible name was exactly "Payflow", from an `sr-only`
    // heading that carried the product name and nothing else. It now carries
    // what the region is as well — "Business signal Payflow" — because a
    // screen-reader user landing on a region named only for a product has to
    // read on to find out it is a score. The assertion this test exists to
    // make is unchanged: the hero is about one named product, and that
    // product is the one attention ranked first.
    const hero = page.getByRole("region", { name: /Payflow/ });
    await expect(hero).toHaveAccessibleName(/Business signal/);
    await expect(hero.getByRole("link", { name: "Payflow" })).toBeVisible();
    // Scoped to the hero: the same product's card below shows 46 too, and a
    // page-wide match would pass on the card alone while the hero was blank.
    await expect(hero.getByText("46")).toBeVisible();

    // No invented account-level figure anywhere on the screen.
    await expect(page.getByText(/overall score/i)).toHaveCount(0);
    await expect(page.getByText(/average/i)).toHaveCount(0);
  });

  test("calls one product by one name, hero and card alike", async ({ page }) => {
    // The seam this closes: the hero read the project label while the card
    // below it read the product name, so a founder saw one product introduced
    // twice under two names on a single screen.
    await page.goto(THREE);

    await expect(page.getByText("Needs You Now")).toHaveCount(0);

    const card = page.getByTestId("product-card").filter({ hasText: "Payflow" });
    await expect(card.getByRole("heading", { name: "Payflow" })).toBeVisible();
    // The repository is this card's anchor back to the project, and stays.
    await expect(card).toContainText("founder/product");
  });

  test("shows the product's logo where it has one", async ({ page }) => {
    await page.goto(THREE);

    const withLogo = page.getByTestId("product-card").filter({ hasText: "Quietly Fine" });
    await expect(withLogo.getByTestId("product-logo")).toBeVisible();

    const withoutLogo = page.getByTestId("product-card").filter({ hasText: "Payflow" });
    await expect(withoutLogo.getByTestId("product-logo")).toHaveCount(0);
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

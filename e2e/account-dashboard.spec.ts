import { expect, test } from "@playwright/test";

/**
 * The account dashboard, as a ranked desk.
 *
 * ## What the screen is
 *
 * One column, most urgent first. The first entry opens into the decision
 * itself; everything else is a row. It replaced a signal card, a grid of
 * product cards and a connect band — a screen organised by *object* rather than
 * by what a founder has to do. See `src/app/app/desk.ts`.
 *
 * ## Why a density budget still exists
 *
 * Because "the account level must feel calmer than the project level" is a
 * claim about pixels, and a target nothing enforces erodes on the next commit.
 * Every section anyone adds here will be defensible on its own — a usage strip,
 * a recent-activity list, a repository count, a plan nudge — and the sum is the
 * admin panel this screen keeps being rebuilt to stop being.
 *
 * The number moved *down*, not up. The old grid measured 31 at three products
 * against a 36 ceiling; the desk measures 12, because a row carries a title and
 * a sentence where a card carried three labelled facts and its own action. The
 * ceiling is 24: room for the fourth and fifth row a real account has, and not
 * room for a second section.
 */

const THREE = "/e2e/account-three-products";
const UNSCORED = "/e2e/account-unscored";
const EMPTY = "/e2e/account-empty";

/**
 * The desk's own list.
 *
 * Scoped, because the account rail is a `<ul>` of navigation items and a
 * page-wide `listitem` query counts those too — which is how a row assertion
 * quietly starts measuring the sidebar.
 */
const desk = (page: import("@playwright/test").Page) =>
  page.getByRole("list", { name: "Everything else on your desk" }).getByRole("listitem");

/**
 * One element per discrete thing a person has to read or decide about: a mono
 * label, a heading, a sentence, a link, a button. Deliberately not every DOM
 * node — the count has to mean something a designer would recognise.
 */
const ELEMENTS = "[data-mono-label], h1, h2, h3, p, a, button";

/** Measured at three products with four entries, plus headroom. */
const BUDGET = 24;

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
   * The head is the only card, and there is one of it.
   *
   * `Surface` level 3 is "one primary object per view". A second card would put
   * two things at the top of the hierarchy, which is the "equally weighted
   * doors on arrival" the audit named as the failure to fix.
   */
  test("has exactly one primary object", async ({ page }) => {
    await page.goto(THREE);

    const home = page.getByTestId("account-home");
    await expect(home.locator(".vibe-surface-card")).toHaveCount(1);
  });

  test("renders no activity feed and no invented account figure", async ({ page }) => {
    await page.goto(THREE);

    await expect(page.getByTestId("dashboard-activity")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /recent activity/i })).toHaveCount(0);
    // An average across products of different maturity is a number Vibe cannot
    // stand behind, and rule 44 forbids a null becoming part of one.
    await expect(page.getByText(/overall score/i)).toHaveCount(0);
    await expect(page.getByText(/average/i)).toHaveCount(0);
    await expect(page.getByRole("button", { name: /last 7 days/i })).toHaveCount(0);
  });

  /**
   * The control is the `<summary>`, and it is addressed as one.
   *
   * `getByRole("button")` does not find it: ARIA in HTML gives `summary` no
   * corresponding role, so Playwright's tree shows the `<details>` as a
   * `group` with text inside and no interactive descendant. That is a property
   * of the role mapping rather than of the markup — a native disclosure is
   * operable by keyboard and announced as one by real assistive technology —
   * so this drives the element and proves the keyboard path explicitly rather
   * than asserting a role the spec does not define.
   */
  test("reveals account actions from the profile control", async ({ page }) => {
    await page.goto(THREE);

    const menu = page.getByTestId("account-menu");
    const control = menu.locator("summary");
    await expect(menu.getByRole("link", { name: /profile/i })).toBeHidden();

    await control.focus();
    await page.keyboard.press("Enter");

    await expect(menu.getByRole("link", { name: /profile/i })).toBeVisible();
    await expect(menu.getByRole("link", { name: /settings/i })).toBeVisible();
    await expect(menu.getByRole("link", { name: /billing/i })).toBeVisible();
    await expect(menu.getByRole("button", { name: /sign out/i })).toBeVisible();
  });
});

test.describe("the head is the most urgent decision", () => {
  /**
   * The row the old screen could not show anywhere.
   *
   * Payflow raises two items — a failed validation and waiting moves. The old
   * hero offered the moves and the card below said "Review change", which is
   * the *waiting* change; the word "failed" appeared nowhere. Ranking blocked
   * above ready puts it at the top of the screen instead.
   */
  test("opens the blocked decision, not the highest score", async ({ page }) => {
    await page.goto(THREE);

    const head = page.getByRole("region", { name: /prepared change failed validation/i });
    await expect(head).toBeVisible();
    await expect(head).toContainText("Blocked");
    await expect(head).toContainText("Payflow");
    await expect(head.getByRole("link", { name: /Review change/ })).toBeVisible();
  });

  test("carries the product's reading as context, not as the subject", async ({ page }) => {
    await page.goto(THREE);

    const head = page.getByRole("region", { name: /prepared change failed validation/i });
    // The decision is the heading; the score is beside it.
    await expect(head.getByRole("heading")).toContainText("1 prepared change failed validation");
    await expect(head.locator("[data-score-ring]")).toBeVisible();
    await expect(head).toContainText("46");
    await expect(head).toContainText("+3 since previous audit");
  });

  test("explains a broken line instead of drawing a trend through it", async ({ page }) => {
    await page.goto(THREE);

    await expect(page.getByText(/changed how it scores/i)).toBeVisible();
    await expect(page.getByText(/not comparable/i)).toBeVisible();
  });

  test("shows a sentence rather than a zero for a product with no audit", async ({ page }) => {
    await page.goto(UNSCORED);

    await expect(page.getByText("No score yet.")).toBeVisible();
    // Rule 44 in the place it would actually break: the ring must not render.
    await expect(page.locator("[data-score-ring]")).toHaveCount(0);
    await expect(page.getByText("/ 100")).toHaveCount(0);
    await expect(page.getByText("0", { exact: true })).toHaveCount(0);
  });
});

test.describe("the rest of the desk is rows", () => {
  test("ranks every entry, and never repeats the head's own decision", async ({ page }) => {
    await page.goto(THREE);

    const rows = desk(page);
    // Two remaining items, one settled product, and the connect route.
    await expect(rows).toHaveCount(4);

    // Ready sorts below blocked, and the settled product sorts below both.
    const text = await rows.allInnerTexts();
    expect(text[0]).toContain("Ready");
    expect(text[2]).toContain("Settled");
    expect(text[3]).toContain("Connect another product");

    // The head's decision appears once, in the head.
    await expect(page.getByText(/prepared change failed validation/)).toHaveCount(1);
  });

  test("keeps a product with nothing waiting on the desk", async ({ page }) => {
    await page.goto(THREE);

    const settled = desk(page).filter({ hasText: "Quietly Fine" });
    await expect(settled).toContainText("Nothing waiting");
    await expect(settled).toContainText("71");
  });

  test("gives one row one destination", async ({ page }) => {
    await page.goto(THREE);

    for (const row of await desk(page).all()) {
      expect(await row.locator("a").count()).toBe(1);
    }
  });

  test("says what Vibe does when there is nothing at all", async ({ page }) => {
    await page.goto(EMPTY);

    await expect(page.getByText("Turn what you built into a business.")).toBeVisible();
    await expect(page.getByRole("link", { name: /Connect GitHub/ })).toBeVisible();
    await expect(desk(page)).toHaveCount(0);
  });
});

test.describe("the desk arrives without moving under a reader", () => {
  /**
   * Obligation 3: reserved geometry.
   *
   * The entrance is `vibe-reveal`, whose keyframes interpolate opacity and
   * transform and have no layout property in them. This measures that claim
   * where it would break — the box a row occupies must be identical mid-flight
   * and settled, or the list reflows under somebody reading it.
   */
  test("reserves every row's geometry through the entrance", async ({ page }) => {
    await page.goto(THREE);

    /*
     * Layout values, not `boundingBox()`.
     *
     * The first version of this used the rendered box and failed by 2.07px —
     * correctly, and against the wrong claim. `vibe-reveal` *translates* the
     * arriving element, so its painted box is meant to move; what must not
     * move is everything around it. `offsetTop` and `offsetHeight` are
     * pre-transform, so they measure exactly that: the space the row occupies
     * in the flow, which is what a reader below it is standing on.
     */
    const layout = () =>
      desk(page)
        .first()
        .evaluate((node) => ({
          top: (node as HTMLElement).offsetTop,
          height: (node as HTMLElement).offsetHeight,
        }));

    const during = await layout();
    await page.waitForTimeout(1500);
    const settled = await layout();

    expect(during).toEqual(settled);

    // And the page below it is where it was: the list did not grow into place.
    const height = await page.evaluate(() => document.body.scrollHeight);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => document.body.scrollHeight)).toBe(height);
  });

  test("arrives settled and complete under reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(THREE);

    // Not a degraded experience: the same information, without the movement.
    const rows = desk(page);
    await expect(rows).toHaveCount(4);
    for (const row of await rows.all()) {
      await expect(row).toBeVisible();
      expect(await row.evaluate((node) => Number(getComputedStyle(node).opacity))).toBe(1);
    }
    // The score ring's arc is at its true length rather than animating to it.
    await expect(page.locator("[data-score-ring]")).toBeVisible();
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

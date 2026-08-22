import { expect, test } from "@playwright/test";

/**
 * The dashboard's project cards, in a real browser (UI-8).
 *
 * ## Why this exists
 *
 * CLAUDE.md rule 69: the domain being right and the screen being right are
 * separate questions, and this project keeps paying for the second one. The
 * card is where an absent score becomes pixels — and "unknown is not bad" is a
 * rule that can be perfectly enforced in `dashboard.ts` and still broken by a
 * `?? 0` in a component.
 *
 * Every assertion below is about a claim the card must **not** make: a zero
 * that was never measured, a flat trend line beside a single measurement, a
 * collapse drawn from a coverage gap.
 */

const scenario = (name: string) => `/e2e/${name}`;

test.describe("a score that was never produced is never a number", () => {
  test("a project that was never analysed says so", async ({ page }) => {
    await page.goto(scenario("dashboard-never-analysed"));

    await expect(page.getByText("Not analysed")).toBeVisible();
    // The failure this catches: `score ?? 0` anywhere in the chain.
    await expect(page.getByText("0", { exact: true })).toHaveCount(0);
    await expect(page.getByText("/ 100")).toHaveCount(0);
  });

  test("an audit with too little evidence says that, not a low score", async ({ page }) => {
    await page.goto(scenario("dashboard-insufficient-coverage"));

    await expect(page.getByText("Not enough evidence")).toBeVisible();
    await expect(page.getByText("/ 100")).toHaveCount(0);
    // And no trend: the card is not showing a score, so a change beside it
    // would be describing a number that is not on screen.
    await expect(page.getByText(/since the last audit/)).toHaveCount(0);
  });

  test("an unconnected project offers setup rather than a score", async ({ page }) => {
    await page.goto(scenario("dashboard-no-repository"));

    await expect(page.getByText("No repository connected")).toBeVisible();
    await expect(page.getByRole("link", { name: /Finish setup/ })).toBeVisible();
  });
});

test.describe("a trend is only drawn where there is one", () => {
  test("one audit shows the score and no direction", async ({ page }) => {
    await page.goto(scenario("dashboard-single-audit"));

    await expect(page.getByText("72")).toBeVisible();
    // The claim being prevented: "unchanged" from a project measured once.
    await expect(page.getByText(/since the last audit/)).toHaveCount(0);
    await expect(page.locator("svg polyline")).toHaveCount(0);
  });

  test("a rising score states the change in words, not only in a line", async ({ page }) => {
    await page.goto(scenario("dashboard-rising"));

    await expect(page.getByText("+6 since the last audit")).toBeVisible();
    await expect(page.locator("svg polyline")).toHaveCount(1);
  });

  test("a falling score is stated, and is not the failure colour", async ({ page }) => {
    await page.goto(scenario("dashboard-falling"));

    const trend = page.getByText("-15 since the last audit");
    await expect(trend).toBeVisible();

    /*
     * Coral is failure across this product — a validation that did not pass, a
     * merge that was refused. A business score that went down is amber. If the
     * two ever became the same colour, the one screen showing both would stop
     * distinguishing them.
     */
    const colour = await trend.evaluate((node) => getComputedStyle(node).color);
    expect(colour).toBe("rgb(232, 181, 74)");
  });

  test("measured twice and unchanged reads differently from never compared", async ({ page }) => {
    await page.goto(scenario("dashboard-unchanged"));

    await expect(page.getByText("Unchanged since the last audit")).toBeVisible();
    // A real comparison, so the line is drawn — flat, which is what happened.
    await expect(page.locator("svg polyline")).toHaveCount(1);
  });

  test("a coverage gap does not draw a collapse", async ({ page }) => {
    await page.goto(scenario("dashboard-coverage-gap"));

    // 78 latest, an unscored audit before it, 72 before that. The change the
    // card reports is 72 → 78, joining the two real scores.
    await expect(page.getByText("+6 since the last audit")).toBeVisible();

    /*
     * The series must contain two points, not three. A `null` folded in as `0`
     * would add a third and send the line to the bottom of the box and back —
     * a business collapsing and recovering, drawn from a measurement gap.
     */
    const points = await page.locator("svg polyline").getAttribute("points");
    expect(points?.split(" ")).toHaveLength(2);
  });
});

test.describe("the grid", () => {
  test("renders one card per project, each with its own action", async ({ page }) => {
    await page.goto(scenario("dashboard-portfolio"));

    await expect(page.getByRole("article")).toHaveCount(3);
    await expect(page.getByRole("heading", { name: "Rising Product" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Falling Product" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Never Analysed" })).toBeVisible();

    // The action follows the state: prepared changes outrank moves, and a
    // project with neither offers the audit that would produce them.
    await expect(page.getByRole("link", { name: /Review moves — Rising Product/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Review change — Falling Product/ })).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Analyse project — Never Analysed/ }),
    ).toBeVisible();
  });

  test("shows counts only where there is something to count", async ({ page }) => {
    await page.goto(scenario("dashboard-portfolio"));

    await expect(page.getByText("3 moves")).toBeVisible();
    await expect(page.getByText("2 prepared")).toBeVisible();
    // "0 moves" reads as a problem, and is indistinguishable from a count that
    // failed to load.
    await expect(page.getByText(/^0 (moves|prepared)$/)).toHaveCount(0);
    await expect(page.getByText("Nothing pending")).toBeVisible();
  });
});

/**
 * The rail (UI-8).
 *
 * What it can prove: that the frame renders, that every account destination is
 * reachable from every signed-in screen, and that the account controls exist
 * exactly once at each width. What it cannot: which item is current — this
 * route is `/e2e/…` and no account section matches it. That rule is asserted
 * against the real `ACCOUNT_SECTIONS` in `nav-active.test.ts`.
 */
test.describe("the account rail", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(scenario("dashboard-portfolio"));
  });

  test("names itself and offers every account destination", async ({ page }) => {
    const rail = page.getByRole("navigation", { name: "Account sections" });

    await expect(rail).toBeVisible();
    await expect(rail.getByRole("link", { name: "Dashboard", exact: true })).toBeVisible();
    // Exact: the balance link in the same rail is also named "… Credits", and
    // a substring match would find two.
    await expect(rail.getByRole("link", { name: "Credits", exact: true })).toBeVisible();
    await expect(rail.getByRole("link", { name: "Connect project", exact: true })).toBeVisible();
  });

  test("marks nothing as current when nothing matches", async ({ page }) => {
    // A rail that guessed would light up "Dashboard" here, because `/app` is a
    // prefix of everything. Two current sections, or a wrong one, is worse
    // than none.
    await expect(page.locator('[aria-current="page"]')).toHaveCount(0);
  });

  test("states the Credit balance as a number and a word, once", async ({ page }) => {
    // BILLING CORE-2 §54: no pill, no colour, no bar. And exactly one of the
    // two responsive copies is ever rendered.
    const balance = page.getByRole("link", { name: /2,480\s*Credits/ });

    await expect(balance).toHaveCount(1);
    await expect(balance).toHaveAttribute("href", "/app/billing");
  });

  test("offers exactly one Sign out at any width", async ({ page }) => {
    await expect(page.getByRole("button", { name: "Sign out" })).toHaveCount(1);

    await page.setViewportSize({ width: 375, height: 800 });
    await expect(page.getByRole("button", { name: "Sign out" })).toHaveCount(1);
  });
});

for (const width of [1440, 1024, 768, 375]) {
  test(`does not scroll sideways at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(scenario("dashboard-portfolio"));

    // The rail becomes a top strip below `lg`. If it did not, a 240px column
    // beside the grid would push the page wider than the viewport.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

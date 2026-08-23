import { expect, test } from "@playwright/test";

/**
 * The Command Center in a real browser (CORE-5).
 *
 * `src/modules/projects/command-center.test.ts` asserts what the view models
 * decide. This asserts what a browser then shows — which is a different claim,
 * and the one that matters, because every failure this suite exists to catch is
 * a screen saying something the data did not.
 *
 * Every scenario is a project *missing* something. That is deliberate: a demo
 * project has an audit, a profile and three moves, so the states where a
 * confident zero or an invented sentence appears are exactly the states nobody
 * looks at.
 */

const COMPLETE = "/e2e/home-complete";
const NOTHING = "/e2e/home-nothing-yet";
const UNSCORED = "/e2e/home-unscored";
const NO_MOVES = "/e2e/home-no-moves-found";

test.describe("Home says what it knows", () => {
  test("leads with the product and the business, then the move", async ({ page }) => {
    await page.goto(COMPLETE);

    await expect(page.getByRole("heading", { name: "Acme" })).toBeVisible();
    await expect(page.getByText("64")).toBeVisible();
    await expect(page.getByText("You have a real product, but nobody can pay for it.")).toBeVisible();
    await expect(page.getByText("Give people a way to pay")).toBeVisible();
    await expect(page.getByRole("link", { name: "Review this move" })).toBeVisible();
  });

  test("offers the prepared work only when there is some", async ({ page }) => {
    await page.goto(COMPLETE);
    await expect(page.getByRole("link", { name: "See what Vibe prepared" })).toBeVisible();

    await page.goto(NO_MOVES);
    // A control leading to an empty page is worse than no control.
    await expect(page.getByRole("link", { name: "See what Vibe prepared" })).toHaveCount(0);
  });
});

test.describe("Home never invents a number (CLAUDE.md rule 44)", () => {
  /**
   * The single most important assertion on this screen. A project that has
   * never been audited has no score — not zero, not "0 / 100", not an empty
   * meter reading 0%. Rendering one tells a founder their business scored
   * nothing when Vibe simply never looked.
   */
  test("shows no score at all before an audit has run", async ({ page }) => {
    await page.goto(NOTHING);

    await expect(page.getByText(/\/ 100/)).toHaveCount(0);
    await expect(page.getByText(/\b0\b/)).toHaveCount(0);
    await expect(page.getByText(/hasn.t judged this as a business yet/i)).toBeVisible();
  });

  /**
   * And the third state: an audit that ran and could not say. It must read as a
   * limit on the evidence, carrying the audit's own reason — not as a zero, and
   * not as the same sentence as "never analyzed".
   */
  test("separates 'could not be scored' from 'never analyzed'", async ({ page }) => {
    await page.goto(UNSCORED);

    await expect(page.getByText("Not enough to score yet")).toBeVisible();
    await expect(page.getByText("Vibe could only assess one of five areas.")).toBeVisible();
    await expect(page.getByText(/\/ 100/)).toHaveCount(0);
    await expect(page.getByText(/hasn.t judged this as a business yet/i)).toHaveCount(0);
  });

  /**
   * "We looked and found nothing worth prioritising" and "we have not looked"
   * are different sentences on your own dashboard, and only one of them implies
   * there is nothing worth doing.
   */
  test("distinguishes having found no move from never having looked", async ({ page }) => {
    await page.goto(NO_MOVES);
    await expect(page.getByText(/looked and didn.t find a move/i)).toBeVisible();

    await page.goto(NOTHING);
    await expect(page.getByText(/hasn.t worked out what to do next yet/i)).toBeVisible();
    await expect(page.getByText(/looked and didn.t find a move/i)).toHaveCount(0);
  });

  test("claims nothing about a product it has not understood", async ({ page }) => {
    await page.goto(NOTHING);

    await expect(page.getByText(/hasn.t worked out what you built yet/i)).toBeVisible();
    await expect(page.getByRole("link", { name: "Start there" })).toHaveAttribute(
      "href",
      "/app/projects/project_e2e/product",
    );
  });
});

test.describe("the agent reads as a colleague, not a build tool", () => {
  test("states its readiness in words, not by colour alone", async ({ page }) => {
    await page.goto("/e2e/agent-ready");

    await expect(page.getByRole("heading", { name: "Ready" })).toBeVisible();
    await expect(page.getByText("Knows what you built")).toBeVisible();
    await expect(page.getByText("Knows what the business needs next")).toBeVisible();
  });

  /**
   * Vibe's own vocabulary for its own subsystems is what every other surface
   * reaches for by default, and it is what makes this screen read as
   * machinery. The unit test pins the strings; this pins that they reach the
   * page.
   */
  test("never shows internal state names on screen", async ({ page }) => {
    await page.goto("/e2e/agent-partial");

    const body = await page.locator("body").innerText();
    for (const jargon of ["snapshot", "profile", "opportunity set", "null", "undefined"]) {
      expect(body.toLowerCase(), `agent card says "${jargon}"`).not.toContain(jargon);
    }
  });

  test("says what is missing rather than claiming to be ready", async ({ page }) => {
    await page.goto("/e2e/agent-partial");
    await expect(page.getByRole("heading", { name: "Getting up to speed" })).toBeVisible();
    await expect(page.getByRole("link", { name: "My Product" })).toBeVisible();

    await page.goto("/e2e/agent-not-briefed");
    await expect(page.getByRole("heading", { name: "Not briefed yet" })).toBeVisible();
  });

  /**
   * The card describes readiness. It does not start work: preparing a change is
   * priced and confirmed, and happens on the Action Plan beside the Move.
   */
  test("offers no control that starts anything", async ({ page }) => {
    await page.goto("/e2e/agent-ready");

    await expect(page.getByRole("button")).toHaveCount(0);
    for (const label of [/build/i, /run now/i, /start/i, /pull request/i, /deploy/i]) {
      await expect(page.getByRole("link", { name: label })).toHaveCount(0);
    }
  });

  test("does not scroll sideways on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 780 });
    await page.goto("/e2e/agent-ready");

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

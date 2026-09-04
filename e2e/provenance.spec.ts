import { expect, test } from "@playwright/test";

/**
 * What somebody about to spend 35 Credits can actually see.
 *
 * The panel exists because a founder paid for four documents built on a live
 * scan Vibe had already corrected. Every screen along the way was internally
 * consistent, every test was green, and nothing said "this rests on a reading
 * that has since changed". So the claim under test here is not a string — it is
 * that the gap is *visible*, that it names the reader that produced it and the
 * one running now, and that the free way out is offered once.
 */

const CURRENT = "/e2e/provenance-current";
const STALE = "/e2e/provenance-stale-scan";
const EMPTY = "/e2e/provenance-nothing-yet";

test.describe("a chain with nothing wrong with it", () => {
  test("still shows what the audit will be built on", async ({ page }) => {
    await page.goto(CURRENT);

    const panel = page.getByTestId("provenance-panel");
    await expect(panel).toBeVisible();
    await expect(panel.getByText(/what this will be built on/i)).toBeVisible();
    await expect(panel.getByText("Your website")).toBeVisible();
    await expect(panel.getByText("Your code")).toBeVisible();
  });

  /* Provenance, not an alarm: nothing to press when nothing is behind. */
  test("offers nothing to fix", async ({ page }) => {
    await page.goto(CURRENT);

    await expect(page.getByTestId("provenance-remedy")).toHaveCount(0);
  });

  /** The Move set is a real link and is not this button's business. */
  test("says nothing about the Moves below the audit", async ({ page }) => {
    await page.goto(CURRENT);

    await expect(page.getByTestId("provenance-panel").getByText("Your Moves")).toHaveCount(0);
  });
});

test.describe("the incident, on screen", () => {
  test("marks the scan Vibe has since corrected", async ({ page }) => {
    await page.goto(STALE);

    const live = page.locator('[data-provenance-link="live_scan"]');
    await expect(live).toHaveAttribute("data-provenance-state", "outdated");
    await expect(live.getByText(/corrected how it reads this/i)).toBeVisible();
  });

  /* The checkable fact, rather than a badge asserting it. */
  test("shows the reader that produced it and the one running now", async ({ page }) => {
    await page.goto(STALE);

    const live = page.locator('[data-provenance-link="live_scan"]');
    await expect(live.getByText(/live-product-analyzer-v3/)).toBeVisible();
    await expect(live.getByText(/→/)).toBeVisible();
  });

  /**
   * The link that reported itself current while resting on a corrected scan.
   * This is the row whose absence let the whole chain read green.
   */
  test("carries the outdated reading down to what was built on it", async ({ page }) => {
    await page.goto(STALE);

    const profile = page.locator('[data-provenance-link="product_profile"]');
    await expect(profile).toHaveAttribute("data-provenance-state", "outdated");
    await expect(profile.getByText(/rests on a reading vibe has since corrected/i)).toBeVisible();
  });

  test("offers the free fix once, at the top of the chain", async ({ page }) => {
    await page.goto(STALE);

    const remedy = page.getByTestId("provenance-remedy");
    await expect(remedy).toHaveCount(1);
    await expect(remedy).toHaveText(/product scan/i);
    await expect(page.getByTestId("provenance-panel").getByText(/^free$/i)).toBeVisible();
  });

  test("the whole panel reports the chain as not current", async ({ page }) => {
    await page.goto(STALE);

    await expect(page.getByTestId("provenance-panel")).toHaveAttribute(
      "data-provenance-current",
      "false",
    );
  });
});

test.describe("a project at the very beginning", () => {
  test("says Vibe has not produced these yet, rather than that they are old", async ({ page }) => {
    await page.goto(EMPTY);

    await expect(page.locator('[data-provenance-link="live_scan"]')).toHaveAttribute(
      "data-provenance-state",
      "missing",
    );
    await expect(page.getByText(/has not produced this yet/i).first()).toBeVisible();
    await expect(page.getByText(/rests on a reading/i)).toHaveCount(0);
  });

  /** A dash rather than an invented date. */
  test("shows no date for something that was never produced", async ({ page }) => {
    await page.goto(EMPTY);

    await expect(
      page.locator('[data-provenance-link="repository_scan"]').getByText("—"),
    ).toBeVisible();
  });
});

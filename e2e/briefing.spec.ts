import { expect, test } from "@playwright/test";

/**
 * The briefing, as a founder reads it after a week away.
 *
 * ## Why this needs a browser
 *
 * The unit tests decide what the briefing *contains*. What they cannot see is
 * whether the panel says one thing or appears to say two — and that is the
 * failure the whole module is shaped around. A briefing that reported a
 * corrected analyzer *and* a stale date leaves a founder with two problems
 * where there is one, and reads as noise rather than as a read.
 *
 * So the claims here are properties of a rendered page: Nova says it as one
 * paragraph rather than a table, exactly one row is marked behind it, exactly
 * one thing is offered, the age is in words while the date is a date, and
 * Nova's account of her own limits is on screen whatever the state.
 */

const AGEING = "/e2e/briefing-audit-ageing";
const CORRECTED = "/e2e/briefing-corrected-analyzer";
const MOVE = "/e2e/briefing-move-ready";
const EMPTY = "/e2e/briefing-nothing-yet";
const SETTLED = "/e2e/briefing-settled";
const WAITING = "/e2e/briefing-waiting-above";

test.describe("the founder's own example: nothing wrong, and it has been sitting", () => {
  test("names the audit, its age in words, and the run that would replace it", async ({ page }) => {
    await page.goto(AGEING);

    const panel = page.getByTestId("briefing-panel");
    await expect(panel).toHaveAttribute("data-briefing-read", "age");
    await expect(
      panel.getByText(/your business audit was last produced about a week ago/i),
    ).toBeVisible();
    await expect(page.getByTestId("briefing-remedy")).toHaveText(/run a new business audit/i);
  });

  /**
   * Advice, not a push. Nova cannot see whether the product moved, so the
   * sentence after an age is conditional — and it says nothing is wrong first.
   */
  test("offers rather than instructs", async ({ page }) => {
    await page.goto(AGEING);

    const paragraph = page.getByTestId("briefing-paragraph");
    await expect(paragraph).toContainText("Nothing about it is wrong");
    await expect(paragraph).toContainText("if your product has moved since");
  });

  /**
   * The facts are behind the answer, not instead of it: the paragraph is the
   * surface, and the chain opens for anyone who wants to check her.
   *
   * The bucket is the words; the exact day is rendered from the timestamp.
   */
  test("shows a real date beside the words, once the evidence is opened", async ({ page }) => {
    await page.goto(AGEING);

    await expect(page.locator('[data-briefing-link="business_audit"]')).toBeHidden();
    await page.getByText(/what nova is reading/i).click();

    const audit = page.locator('[data-briefing-link="business_audit"]');
    await expect(audit).toBeVisible();
    await expect(audit).toContainText("1 Sep 2026");
    await expect(audit).toContainText("about a week ago");
  });
});

test.describe("the incident, on screen", () => {
  test("marks the corrected scan and only the corrected scan", async ({ page }) => {
    await page.goto(CORRECTED);

    await expect(page.getByTestId("briefing-panel")).toHaveAttribute(
      "data-briefing-read",
      "repair",
    );
    await expect(page.locator("[data-briefing-subject]")).toHaveCount(1);
    await expect(page.locator('[data-briefing-link="live_scan"]')).toHaveAttribute(
      "data-briefing-subject",
      "",
    );
  });

  /**
   * One problem, not two. The audit and the Moves below the corrected scan are
   * outdated too — the chain says so on their own rows — but the read is about
   * the top of the chain, and nothing is offered for the links beneath it.
   */
  test("offers exactly one thing to do, at the top of the chain", async ({ page }) => {
    await page.goto(CORRECTED);

    const remedy = page.getByTestId("briefing-remedy");
    await expect(remedy).toHaveCount(1);
    await expect(remedy).toHaveText(/run a fresh product scan/i);
    await expect(page.getByTestId("briefing-panel").getByText("Free")).toBeVisible();
  });

  /** A broken link outranks a good Move. The Move is not mentioned at all. */
  test("says nothing about the Move while the evidence is wrong", async ({ page }) => {
    await page.goto(CORRECTED);

    await expect(
      page.getByTestId("briefing-panel").getByText(/put a price on the pricing page/i),
    ).toHaveCount(0);
  });
});

test.describe("when the evidence is sound", () => {
  test("quotes the engine's Move in the engine's own words", async ({ page }) => {
    await page.goto(MOVE);

    const panel = page.getByTestId("briefing-panel");
    await expect(panel).toHaveAttribute("data-briefing-read", "move");
    await expect(panel.getByText("Put a price on the pricing page")).toBeVisible();
    await expect(panel.getByText(/pricing page with no amount on it/i)).toBeVisible();

    /* Nova points at it; the Move's own words sit outside her paragraph. */
    await expect(page.getByTestId("briefing-paragraph")).not.toContainText(
      "Put a price on the pricing page",
    );
  });

  /** Nothing to repair, so nothing is offered beside the Move. */
  test("offers no repair", async ({ page }) => {
    await page.goto(MOVE);

    await expect(page.getByTestId("briefing-remedy")).toHaveCount(0);
  });

  test("says plainly when there is nothing to say", async ({ page }) => {
    await page.goto(SETTLED);

    const panel = page.getByTestId("briefing-panel");
    await expect(panel).toHaveAttribute("data-briefing-read", "settled");
    await expect(page.getByTestId("briefing-paragraph")).toContainText(
      "no Move is waiting on your list",
    );
  });
});

test.describe("a project on its first day", () => {
  /**
   * Absent is not wrong. Five grey rows on a founder's first visit, and a
   * single free run offered at the top — not an alarm, and not five buttons.
   */
  test("reports absence without alarm", async ({ page }) => {
    await page.goto(EMPTY);

    const panel = page.getByTestId("briefing-panel");
    await expect(panel).toHaveAttribute("data-briefing-read", "repair");
    await expect(page.locator('[data-briefing-state="outdated"]')).toHaveCount(0);
    await expect(page.locator('[data-briefing-state="missing"]')).toHaveCount(5);
    await expect(page.getByTestId("briefing-remedy")).toHaveCount(1);
  });

  /** No name on file is a normal state, and gets no placeholder. */
  test("names the product when it has no name for the founder", async ({ page }) => {
    await page.goto(EMPTY);

    await expect(page.getByTestId("briefing-panel").getByText("Untitled product")).toBeVisible();
    /* No name, no lead-in: the paragraph simply starts at the sentence. */
    await expect(page.getByTestId("briefing-paragraph")).toHaveText(/^Nothing is waiting/);
  });
});

test.describe("what Nova admits about herself", () => {
  test("says she does not watch between runs, in every state", async ({ page }) => {
    await page.goto(SETTLED);

    await expect(page.getByText(/she does not watch your product between runs/i)).toBeVisible();
  });

  /** Points at the card above rather than restating its sentence. */
  test("points at what is waiting instead of repeating it", async ({ page }) => {
    await page.goto(WAITING);

    await expect(page.getByTestId("briefing-paragraph")).toContainText(
      "One thing is waiting on you, above",
    );
  });
});

test.describe("at 390px", () => {
  test.use({ viewport: { width: 390, height: 900 } });

  test("does not scroll sideways", async ({ page }) => {
    await page.goto(CORRECTED);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

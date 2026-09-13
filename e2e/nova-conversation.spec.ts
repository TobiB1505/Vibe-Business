import { expect, test } from "@playwright/test";

/**
 * The conversation, in a browser (ADR 0109, vertical slice 1).
 *
 * Every assertion here is one a unit test cannot make: that the founder's own
 * question and Nova's answer are told apart on screen, that a Move arrives as
 * the canonical card rather than as a paraphrase inside the sentence, that a
 * turn in flight says what it is doing instead of spinning, that Vibe's own
 * fallback is visibly not Nova speaking, that there is exactly one place to
 * type, and that none of it breaks on a phone.
 */

const VIEWPORTS = [
  { name: "mobile", width: 375, height: 780 },
  { name: "desktop", width: 1440, height: 900 },
] as const;

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
});

test.describe("a question and an answer", () => {
  test("shows both, and the Move the answer points at", async ({ page }) => {
    await page.goto("/e2e/nova-conversation");

    await expect(page.getByText("What should I work on next?")).toBeVisible();
    await expect(
      page.getByText("The thing to start with is putting a price on the public site", {
        exact: false,
      }),
    ).toBeVisible();

    /*
     * The canonical card, not a paraphrase. The reply says the Move in prose
     * and the card says it in the product's own words — which is the whole
     * argument for storing a reference rather than a copy: the card is read
     * from the row and stays right when the row moves.
     */
    await expect(
      page.getByText("Say what it costs before the signup form", { exact: false }),
    ).toBeVisible();
  });

  test("has exactly one place to type, and it is reachable by keyboard", async ({ page }) => {
    await page.goto("/e2e/nova-conversation");

    const boxes = page.locator("textarea");
    await expect(boxes).toHaveCount(1);

    const composer = boxes.first();
    await composer.focus();
    await expect(composer).toBeFocused();

    // The send control is a real button, so the keyboard path and the pointer
    // path are the same path.
    await expect(page.getByRole("button", { name: "Ask Nova" })).toBeVisible();
  });

  test("will not send an empty question", async ({ page }) => {
    await page.goto("/e2e/nova-conversation");

    await expect(page.getByRole("button", { name: "Ask Nova" })).toBeDisabled();
    await page.locator("textarea").first().fill("Why?");
    await expect(page.getByRole("button", { name: "Ask Nova" })).toBeEnabled();
  });
});

test.describe("what Nova looked at", () => {
  test("collapses to one line, and opens to the steps she actually took", async ({ page }) => {
    await page.goto("/e2e/nova-conversation");

    const summary = page.getByRole("button", { name: /Looked at your business/ });
    await expect(summary).toBeVisible();
    await expect(summary).toHaveAttribute("aria-expanded", "false");

    // Closed by default: the answer is what the founder came for.
    await expect(page.getByText("Reading your Business Health")).toBeHidden();

    await summary.click();
    await expect(summary).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByText("Reading your Business Health")).toBeVisible();
    await expect(page.getByText("Checking what needs attention")).toBeVisible();

    // A step that found nothing says so rather than passing as done.
    await expect(page.getByText("nothing there yet")).toBeVisible();
  });

  test("never shows a tool's own name or its arguments", async ({ page }) => {
    await page.goto("/e2e/nova-conversation");
    await page.getByRole("button", { name: /Looked at your business/ }).click();

    const body = await page.locator("body").innerText();
    for (const internal of [
      "get_business_health",
      "get_project_focus",
      "get_action_plan",
      "resolve_execution",
      "use_skill",
      "opportunity_id",
    ]) {
      expect(body, internal).not.toContain(internal);
    }
  });

  test("says how long it took, and does not claim to have thought", async ({ page }) => {
    await page.goto("/e2e/nova-conversation");

    // A real elapsed time from the turn's own row, in whole seconds.
    await expect(page.getByText(/Looked at your business, \d+ seconds/)).toBeVisible();
    // "Thought" would be a claim about something nobody observed (rule 43).
    expect(await page.locator("body").innerText()).not.toMatch(/Thought for/i);
  });

  test("is reachable and operable from the keyboard", async ({ page }) => {
    await page.goto("/e2e/nova-conversation");

    const summary = page.getByRole("button", { name: /Looked at your business/ });
    await summary.focus();
    await expect(summary).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(summary).toHaveAttribute("aria-expanded", "true");
  });
});

test.describe("a turn still being answered", () => {
  test("says what it is doing, and never shows a fraction", async ({ page }) => {
    await page.goto("/e2e/nova-conversation-working");

    // The stage the operation is actually in, shimmering in the header.
    await expect(page.getByText("Looking at what Vibe knows")).toBeVisible();
    // And the stage it already passed, beneath it.
    await expect(page.getByText("Understanding your question")).toBeVisible();

    // No percentage, no step counter, no "3 of 5" anywhere on the screen.
    const body = (await page.locator("body").innerText()).toLowerCase();
    expect(body).not.toMatch(/\d+\s*%/);
    expect(body).not.toMatch(/step \d+ of \d+/);
  });

  test("stops the founder asking a second question over the first", async ({ page }) => {
    await page.goto("/e2e/nova-conversation-working");

    await expect(page.locator("textarea").first()).toBeDisabled();
  });
});

test.describe("when Nova could not answer", () => {
  test("shows Vibe's own sentence, and still offers somewhere to go", async ({ page }) => {
    await page.goto("/e2e/nova-conversation-fallback");

    await expect(
      page.getByText("I could not finish working through this one", { exact: false }),
    ).toBeVisible();
    // The founder is never left with only the bad news.
    await expect(
      page.getByText("Business Health and your Action Plan are both still there", {
        exact: false,
      }),
    ).toBeVisible();
  });
});

test.describe("before anything has been asked", () => {
  test("shows the composer and no empty transcript furniture", async ({ page }) => {
    await page.goto("/e2e/nova-conversation-empty");

    await expect(page.locator("textarea")).toHaveCount(1);
    await expect(page.locator("ol")).toHaveCount(0);
  });
});

for (const viewport of VIEWPORTS) {
  test.describe(`at ${viewport.name} (${viewport.width}px)`, () => {
    test("fits without scrolling sideways", async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto("/e2e/nova-conversation");

      await expect(page.locator("textarea").first()).toBeVisible();
      await expect(
        page.getByText("Say what it costs before the signup form", { exact: false }),
      ).toBeVisible();

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);
    });
  });
}

import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./support/overflow";

/**
 * The landing page (UI-34).
 *
 * ## What this exists to hold
 *
 * The page is long and every block below the hero is rendered **hidden by the
 * server** and revealed as it is scrolled to. That is a design decision with a
 * failure mode attached: if the reveal never fires, or fires only for readers
 * who allow motion, or fires only where JavaScript ran, the marketing site is
 * blank. None of that is visible in a screenshot of the top of the page, which
 * is exactly where a landing page gets looked at.
 *
 * So these assert the three states the reveal has to survive — scrolled,
 * reduced motion, and no JavaScript — against the browser rather than against
 * the source.
 *
 * The fourth guard is about the hero itself. V2's surfaces are translucent
 * films built to sit on the app's opaque ground, and the deck stands on a lit
 * grid: a `bg-surface-2` hero card reads as a ghost with grid lines running
 * across its own headline. The card's fill is asserted to be opaque, because
 * the class that makes it so is one word long and nothing else would notice
 * losing it.
 */

/** Every block the server renders hidden. The hero is deliberately not one. */
const REVEAL = "[data-reveal]";

test.describe("the landing page reveals what it hides", () => {
  test("brings every block to full opacity once it has been scrolled to", async ({ page }) => {
    await page.goto("/");

    const blocks = page.locator(REVEAL);
    const count = await blocks.count();
    expect(count).toBeGreaterThan(4);

    // The last block starts hidden — if it did not, this test would pass
    // without the reveal ever running.
    expect(await blocks.last().evaluate((el) => getComputedStyle(el).opacity)).toBe("0");

    for (let index = 0; index < count; index++) {
      await blocks.nth(index).scrollIntoViewIfNeeded();
    }
    await page.waitForTimeout(1200);

    const stillHidden = await page.evaluate(
      (selector) =>
        [...document.querySelectorAll(selector)].filter(
          (el) => Number(getComputedStyle(el).opacity) < 0.99,
        ).length,
      REVEAL,
    );
    expect(stillHidden).toBe(0);
  });

  test.describe("with reduced motion", () => {
    test("presents every block at first paint, with nothing moved", async ({ page }) => {
      /*
        `emulateMedia` rather than `test.use({ reducedMotion })`: the fixture
        option did not reach the page under this project's config —
        `matchMedia("(prefers-reduced-motion: reduce)")` read `false` inside a
        test that had asked for it, so a guard written that way would have been
        asserting the ordinary path twice and calling one of them reduced.
      */
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto("/");

      // No scrolling, no waiting: reduced motion is not a slower entrance, it
      // is the same information without the movement.
      const notPresent = await page.evaluate((selector) => {
        return [...document.querySelectorAll(selector)]
          .map((el) => {
            const style = getComputedStyle(el);
            return { opacity: style.opacity, transform: style.transform };
          })
          .filter((box) => box.opacity !== "1" || box.transform !== "none");
      }, REVEAL);

      expect(notPresent).toEqual([]);
    });
  });

  test.describe("without JavaScript", () => {
    test.use({ javaScriptEnabled: false });

    test("still shows the blocks below the hero", async ({ page }) => {
      await page.goto("/");

      // The `<noscript>` style is the only thing standing between a visitor
      // with JavaScript off and a page that is one card and then nothing.
      await expect(
        page.getByRole("heading", { name: /Simple plans|Start free/i }).first(),
      ).toBeVisible();

      const hidden = await page.evaluate(
        (selector) =>
          [...document.querySelectorAll(selector)].filter(
            (el) => Number(getComputedStyle(el).opacity) < 0.99,
          ).length,
        REVEAL,
      );
      expect(hidden).toBe(0);
    });
  });
});

test.describe("the hero deck", () => {
  test("stands on the field rather than letting it through", async ({ page }) => {
    await page.goto("/");

    const fill = await page
      .locator(".landing-hero-card")
      .first()
      .evaluate(
        (el) => getComputedStyle(el).backgroundImage + "|" + getComputedStyle(el).backgroundColor,
      );

    // The card composites its film over `--color-ground`, so the *colour*
    // underneath the gradient must be opaque. A translucent `rgba(…, 0.034)`
    // here is the ghost card this class exists to stop.
    expect(fill).not.toContain("rgba(0, 0, 0, 0)|");
    expect(fill).toMatch(/linear-gradient/);
  });

  test("carries the page's only h1, and hides the two cards behind it", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("build the business");

    // Scan and Audit are shown, not said: they are painted, so `toBeHidden`
    // would be false — what makes them silent is that they are out of the
    // accessibility tree, and that is the thing to assert.
    const behind = page.locator("[aria-hidden='true']", {
      hasText: "Repository and live product read.",
    });
    await expect(behind).toHaveCount(1);
  });

  test("holds the first screen, so the next block is a scroll away", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    /*
      The measurement is a height, so it has to wait for the real face. In the
      fallback the card measured 906px against a 900px viewport and this guard
      failed on a build whose source it had already passed — the same font race
      `expectNoHorizontalOverflow` documents, arriving here as a height rather
      than a width.
    */
    await page.evaluate(() => document.fonts.ready);

    const heroBottom = await page
      .locator(".landing-hero-card")
      .first()
      .evaluate((el) => el.getBoundingClientRect().bottom);
    const nextBlockTop = await page
      .locator(REVEAL)
      .first()
      .evaluate((el) => el.getBoundingClientRect().top);

    expect(heroBottom).toBeLessThan(900);
    expect(nextBlockTop).toBeGreaterThan(760);
  });

  test("fits a phone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});

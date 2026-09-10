import { expect, test } from "@playwright/test";

/**
 * What a sentence has room to be, on a phone (UI-36).
 *
 * Measured across 98 fixture screens at 390px, the median prose column was
 * 284px — about 47 characters, which is a good measure. The problem was never
 * the median. It was four rows that stayed two columns on a phone and squeezed
 * the text half of themselves: the worst ran a heading and a sentence in a
 * **five pixel** column beside a 175px button that had all the room it wanted.
 *
 * None of it overflowed, so nothing caught it. A layout that squeezes rather
 * than wraps stays inside the viewport and stays inside every rule about
 * staying inside the viewport.
 */

const PHONE = { width: 390, height: 844 };

/*
 * The four that were broken. A general floor rather than four pinned numbers,
 * because the fix is "this row wraps on a phone" and the exact width it wraps
 * to is a layout detail that may reasonably move.
 */
const FIXED = [
  "/e2e/product_scan_complete",
  "/e2e/billing-launch-v1",
  "/e2e/action_plan_ready",
  "/e2e/audit-synthesis",
];

const FLOOR = 200;

/**
 * A note about the palette, because this file is where it was found.
 *
 * The suite's server now runs `VIBE_PALETTE=v2` — the design being shipped.
 * It did not, and that is why the first version of this guard passed its own
 * mutation: the five-pixel column only happens in v2, and measured on the same
 * screen at the same width on the same build, v1 gives that paragraph 256px.
 *
 * There is no per-test override here any more. Each test asserts the palette
 * instead, so a server config that drifts back to v1 fails loudly rather than
 * quietly measuring the product that is being replaced.
 */

test.describe("prose has room to be read", () => {
  test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

  for (const screen of FIXED) {
    test(`no sentence is squeezed on ${screen}`, async ({ page }) => {
      await page.goto(screen);
      await page.evaluate(() => document.fonts.ready);

      /*
        The server has to be serving v2, or this test is measuring the one
        palette the defect is not in.
      */
      await expect
        .poll(() => page.evaluate(() => document.documentElement.dataset.vibe))
        .toBe("v2");

      const { squeezed, examined } = await page.evaluate((floor) => {
        const prose = [...document.querySelectorAll("p")]
          .filter((el) => {
            const text = (el.textContent ?? "").trim();
            /*
              Real prose only. A short label in a narrow column is a label; the
              claim here is about sentences, and a sentence needs a measure.
            */
            return (
              text.length > 45 &&
              el.getClientRects().length > 0 &&
              !el.closest("[data-testid='consent-banner']")
            );
          })
          .map((el) => ({
            width: Math.round(el.getBoundingClientRect().width),
            text: (el.textContent ?? "").trim().slice(0, 32),
          }));

        return { examined: prose.length, squeezed: prose.filter((p) => p.width < floor) };
      }, FLOOR);

      /*
        An empty set passes an "is empty" assertion. This is what stops the
        test reporting success because it found nothing to look at — the
        failure mode that let the first version of this guard survive its own
        mutation.
      */
      expect(examined).toBeGreaterThan(0);
      expect(squeezed).toEqual([]);
    });
  }
});

test.describe("and the desktop is not paying for it", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  /*
   * Every one of these was changed with a `max-sm:` and nothing else, and this
   * is what says so in a browser rather than in a diff. The values are the
   * originals: a `flex-1` column that still resolves to `0%`, a row that is
   * still a row, and two gutters still at their measured 48px.
   */
  const UNCHANGED = [
    ["/e2e/product_scan_complete", ".min-w-0.flex-1", "flexBasis", "0%"],
    ["/e2e/billing-launch-v1", ".flex.items-center.justify-between.gap-4", "flexDirection", "row"],
    ["/e2e/audit-synthesis", ".pr-12", "paddingRight", "48px"],
    ["/e2e/action_plan_ready", ".pl-12", "paddingLeft", "48px"],
  ] as const;

  for (const [screen, selector, property, expected] of UNCHANGED) {
    test(`keeps ${property} on ${screen}`, async ({ page }) => {
      await page.goto(screen);
      await page.evaluate(() => document.fonts.ready);

      const value = await page.evaluate(
        ({ selector, property }) => {
          const el = document.querySelector(selector);
          if (!el) return null;
          return getComputedStyle(el)[property as keyof CSSStyleDeclaration] as string;
        },
        { selector, property },
      );

      expect(value).toBe(expected);
    });
  }
});

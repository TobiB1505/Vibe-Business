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

test.describe("a block fills the column it sits in", () => {
  /*
   * Found by a founder on their own phone, not by any sweep here — because
   * the Agent's trust panel sits in `WorkspaceSection`'s `actions` slot on a
   * route that needs a session, so **no fixture had ever rendered it**. There
   * is one now (`agent-trust-panel`), which is the part of this fix that keeps
   * mattering after the CSS stops being interesting.
   *
   * Three facts sit side by side above `sm`, each capped at 230px. Below it
   * they stack and kept the cap, so the panel came to about 62% of the page
   * while the heading and prose above it ran full width — a card that reads as
   * having failed to load the rest of itself.
   */
  const PANEL = "/e2e/agent-trust-panel";

  test.describe("on a phone", () => {
    test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

    test("is as wide as the text above it", async ({ page }) => {
      await page.goto(PANEL);
      await page.evaluate(() => document.fonts.ready);

      const { rows, column, direction } = await page.evaluate(() => {
        const element = document.querySelector("[data-testid='agent-trust']")!;
        const heading = document.querySelector("h1")!;
        return {
          /*
            The *rows*, not the panel. The panel is a block-level flex column
            and fills its parent whatever its children do — measured against
            it, this test passed with the cap still on. The capped thing is
            each fact, so each fact is what has to be asked.
          */
          rows: [...element.children].map((row) => Math.round(row.getBoundingClientRect().width)),
          column: Math.round(heading.getBoundingClientRect().width),
          direction: getComputedStyle(element).flexDirection,
        };
      });

      // Stacked, and filling. A cap that survives the stack is the defect.
      expect(direction).toBe("column");
      expect(column).toBeGreaterThan(0);
      expect(rows.length).toBeGreaterThan(1);
      expect(rows.filter((width) => width < column - 4)).toEqual([]);
    });
  });

  test.describe("on a wide screen", () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test("is still three columns, each at its measured width", async ({ page }) => {
      await page.goto(PANEL);
      await page.evaluate(() => document.fonts.ready);

      /*
        The cap is right where there are three columns to cap, and this is
        what stops the mobile fix being applied one breakpoint too far.
      */
      const { direction, first } = await page.evaluate(() => {
        const element = document.querySelector("[data-testid='agent-trust']")!;
        return {
          direction: getComputedStyle(element).flexDirection,
          first: Math.round(element.firstElementChild!.getBoundingClientRect().width),
        };
      });

      expect(direction).toBe("row");
      expect(first).toBeLessThanOrEqual(230);
    });
  });
});

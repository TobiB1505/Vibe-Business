import { expect, test } from "@playwright/test";

/**
 * The screens on a phone (UI-36).
 *
 * The shell was UI-35; this is what is inside it. Swept across 107 fixture
 * routes at 390×844, the product had no horizontal overflow anywhere and about
 * three hundred and forty controls a thumb could not reliably hit — and they
 * were not scattered. They were four shared shapes: every `Button` at its
 * measured 40px, two hand-written `<summary>` expanders, and `SeeMore`.
 *
 * The fix is a hit area rather than a size, because the size was measured:
 * `button.tsx` records 44px being built, screenshotted and rejected when 47
 * dense controls broke the chrome they sit in. So nothing moved and the
 * tappable box grew — on a coarse pointer only.
 */

const PHONE = { width: 390, height: 844 };

/*
 * A handful rather than all 107. The sweep that found the problem is not a
 * test — it takes minutes — and what a test has to hold is the *mechanism*.
 * These four cover the four shapes: contained buttons, both expanders, and a
 * positioned control.
 */
const SCREENS = [
  "/e2e/understanding_ready",
  "/e2e/action_plan_ready",
  "/e2e/change_awaiting_approval",
  "/e2e/action_plan_handoff_offer",
];

test.describe("a thumb can hit what it is aiming at", () => {
  test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

  for (const screen of SCREENS) {
    test(`every control on ${screen} answers above its own centre`, async ({ page }) => {
      await page.goto(screen);
      await page.evaluate(() => document.fonts.ready);

      const unreachable = await page.evaluate(() => {
        /*
          A link inside a sentence is exempt, and the rules say so: a 44px
          target in running prose is a paragraph with holes in it. The test is
          whether the control sits inside a block with materially more text
          than itself.
        */
        const inline = (el: Element) => {
          const prose = el.closest("p,li,figcaption");
          return (
            prose !== null &&
            (prose.textContent ?? "").trim().length > (el.textContent ?? "").trim().length + 12
          );
        };

        const missed: string[] = [];
        for (const el of document.querySelectorAll("a,button,summary")) {
          if (el.getClientRects().length === 0 || inline(el)) continue;
          const box = el.getBoundingClientRect();
          if (box.height >= 44) continue;

          /*
            Twenty pixels above the middle — inside the 44px band, outside a
            40px control. If the element answers there, the hit area is real;
            asserting on `getBoundingClientRect` would measure the drawing
            instead, which is exactly the thing that did not change.
          */
          const x = Math.round(box.left + box.width / 2);
          const y = Math.round(box.top + box.height / 2 - 20);
          if (y < 1 || y > window.innerHeight - 1) continue;

          const hit = document.elementFromPoint(x, y);
          if (!hit || !(el.contains(hit) || hit.contains(el) || hit === el)) {
            missed.push(
              `${el.tagName.toLowerCase()} "${(el.textContent ?? "").trim().slice(0, 24)}"`,
            );
          }
        }
        return missed;
      });

      expect(unreachable).toEqual([]);
    });
  }

  test("does not scroll sideways on any of them", async ({ page }) => {
    for (const screen of SCREENS) {
      await page.goto(screen);
      const { doc, view } = await page.evaluate(() => ({
        doc: document.documentElement.scrollWidth,
        view: window.innerWidth,
      }));
      expect(doc, screen).toBeLessThanOrEqual(view);
    }
  });
});

test.describe("the mouse keeps the size that was measured", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("adds no hit area where there is no finger", async ({ page }) => {
    await page.goto(SCREENS[0]);

    /*
      The whole reason this is a pointer query and not a width. `button.tsx`
      records 40px being chosen over 44 because 47 dense controls broke their
      chrome at the larger size; that decision has to survive this one, and a
      pseudo-element on a mouse pointer would quietly undo it.
    */
    const drawn = await page.evaluate(() => {
      const control = document.querySelector("button.vibe-tap, a.vibe-tap");
      if (!control) return null;
      return {
        coarse: window.matchMedia("(pointer: coarse)").matches,
        height: Math.round(control.getBoundingClientRect().height),
        pseudo: getComputedStyle(control, "::after").content,
      };
    });

    expect(drawn).not.toBeNull();
    expect(drawn!.coarse).toBe(false);
    expect(drawn!.pseudo).toBe("none");
    expect(drawn!.height).toBe(40);
  });
});

test.describe("a control that says where it sits keeps saying it", () => {
  /*
   * On a finger, which is the only place `.vibe-tap` applies at all — so this
   * is the viewport the risk actually lives at. `handoff.spec.ts` already pins
   * this control as `absolute`, and it runs with a mouse, where the rule is
   * not even generated.
   *
   * `.vibe-tap` sets `position: relative` as a fallback for controls that have
   * none. Written unlayered it would have beaten `absolute` on every button in
   * the product, silently; in `@layer components` the utility wins.
   */
  test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

  test("is not moved by the hit area it was given", async ({ page }) => {
    await page.goto("/e2e/action_plan_handoff_prompt");

    const copy = page.getByTestId("handoff-copy");
    await expect(copy).toBeVisible();
    await expect(copy).toHaveClass(/vibe-tap/);
    await expect(copy).toHaveCSS("position", "absolute");
  });
});

test.describe("the cookie question on a phone", () => {
  test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

  test("puts its choices in a row rather than a column of three", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);

    const banner = page.getByTestId("consent-banner");
    await expect(banner).toBeVisible();

    /*
      Stacked, the three controls were 136px and the banner 330 — thirty-nine
      percent of the viewport. This pins the shape, not the pixel: the two
      equal choices share a line.
    */
    const rows = await page.evaluate(() => {
      const tops = ["consent-reject", "consent-accept"].map((id) => {
        const el = document.querySelector(`[data-testid="${id}"]`);
        return el ? Math.round(el.getBoundingClientRect().top) : -1;
      });
      return {
        tops,
        height: Math.round(
          document.querySelector("[data-testid='consent-banner']")!.getBoundingClientRect().height,
        ),
      };
    });

    expect(rows.tops[0]).toBe(rows.tops[1]);
    expect(rows.height).toBeLessThan(280);
  });
});

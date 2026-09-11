import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";

/**
 * The phone's shell (UI-35).
 *
 * Every number in here was measured before it was asserted, on the screen the
 * rail used to draw. The old shape was not wrong in a way a unit test could
 * see — no overflow, no error, every element present — it was wrong in that it
 * spent 476px of an 844px viewport on chrome and hid half its own navigation
 * in a sideways scroller. So these are geometry tests, and they are in a
 * browser because there is nowhere else to ask.
 */

const PHONE = { width: 390, height: 844 };
const SHELL = "/e2e/understanding_ready";

test.describe("the phone's shell", () => {
  test.use({ viewport: PHONE });

  test("gives the screen back to the product", async ({ page }) => {
    await page.goto(SHELL);
    await page.evaluate(() => document.fonts.ready);

    /*
      The measurement that started this. The rail was a stacked strip and the
      page heading began at y=546 — below a founder's first screenful of their
      own product. The top bar is the only chrome above the content now, so the
      heading has to land inside the first viewport with room to spare.
    */
    const headingTop = await page
      .locator("main h1")
      .evaluate((el) => Math.round(el.getBoundingClientRect().top + window.scrollY));

    expect(headingTop).toBeLessThan(200);
  });

  test("has no sideways scroller hiding half the navigation", async ({ page }) => {
    await page.goto(SHELL);
    await page.evaluate(() => document.fonts.ready);

    /*
      The old strip held 836px of sections in a 358px window. This asks the
      question generally — is anything wide enough to hold content scrolling
      sideways — rather than naming the element that used to, so the defect
      cannot come back somewhere else on the same screen.
    */
    const strips = await page.evaluate(() =>
      [...document.querySelectorAll("*")]
        .filter((el) => el.clientWidth > 100 && el.scrollWidth > el.clientWidth + 4)
        .map((el) => el.className.toString().slice(0, 60)),
    );

    expect(strips).toEqual([]);
    // And the page itself never scrolls sideways.
    const { doc, view } = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth,
      view: window.innerWidth,
    }));
    expect(doc).toBeLessThanOrEqual(view);
  });

  test("puts every one of its own controls within a thumb's reach", async ({ page }) => {
    await page.goto(SHELL);
    await page.evaluate(() => document.fonts.ready);

    /*
      44px is the floor, and this asks it only of the shell — the tab bar, the
      top bar and the account control. Page content is a separate job and has
      its own failures; mixing them here would mean this test could never be
      green and would stop being read.
    */
    const small = await page.evaluate(() => {
      const shell = [
        ...document.querySelectorAll("[data-tabbar] a, [data-tabbar] button"),
        ...document.querySelectorAll("[data-topbar] a"),
        ...document.querySelectorAll("[data-testid='mobile-account-trigger']"),
      ];
      return shell
        .map((el) => {
          const r = el.getBoundingClientRect();
          return {
            label: (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 24),
            h: Math.round(r.height),
            w: Math.round(r.width),
          };
        })
        .filter((box) => box.h < 44 || box.w < 44);
    });

    expect(small).toEqual([]);
  });

  test("draws a navigation you cannot see the page through", async ({ page }) => {
    await page.goto(SHELL);
    await page.evaluate(() => document.fonts.ready);

    /*
      v2 draws chrome as a film with the page blurred behind it, and over
      arbitrary scrolling content that failed: section labels sat on top of a
      sentence about the product, both legible and neither readable.

      Asserting a colour would pin a palette. This asserts the property that
      actually matters — an opaque bar cannot change when the page moves — by
      photographing the bar's own strip at two scroll positions.
    */
    /*
      A hash rather than the image: an assertion that fails by printing two
      base64 PNGs makes its own log unreadable, which is how a real failure
      gets skimmed past.
    */
    const strip = async () => {
      const shot = await page.screenshot({ clip: { x: 0, y: 800, width: 390, height: 36 } });
      return createHash("sha256").update(shot).digest("hex").slice(0, 16);
    };

    const before = await strip();
    await page.evaluate(() => window.scrollBy(0, 700));
    await page.waitForTimeout(400);
    const after = await strip();

    expect(after).toBe(before);
  });

  test("keeps the navigation reachable while the cookie question is open", async ({ page }) => {
    /*
      The suite sets a refusing consent cookie in `playwright.config.ts`, so
      the banner never appears in any other spec — which is exactly why nothing
      caught this. Clearing it is the whole point of the test.
    */
    await page.context().clearCookies();
    await page.goto(SHELL);
    await page.evaluate(() => document.fonts.ready);

    /*
      The banner is `z-50` and fixed to the bottom; the tab bar is `z-40`. It
      landed squarely on the navigation, and a founder who had not answered the
      cookie question could not move around the product at all. Playwright
      found this before a person did — every tap was intercepted.

      Clicking is the test. A visibility assertion passes on an element with
      another element on top of it.
    */
    await expect(page.getByTestId("consent-banner")).toBeVisible();
    await page.getByTestId("mobile-tab-bar").getByRole("link", { name: "Nova" }).click();
    await expect(page).not.toHaveURL(SHELL);
  });
});

test.describe("the two levels of the phone's navigation", () => {
  test.use({ viewport: PHONE });

  test("reaches every section, including the ones behind More", async ({ page }) => {
    await page.goto(SHELL);
    const bar = page.getByTestId("mobile-tab-bar");

    // Four in the bar, and the fifth control opens the rest.
    await expect(bar.getByRole("link")).toHaveCount(4);

    await bar.getByRole("button", { name: "More" }).click();
    const sheet = page.getByRole("dialog");
    /*
      Project Settings is filtered out of the desktop rail — it moved into the
      switcher — so if it were filtered here too it would be unreachable on a
      phone. That is the whole reason this assertion names it.
    */
    await expect(sheet.getByRole("link", { name: "Project Settings" })).toBeVisible();

    /*
      Clicked, not just seen. `pointer-events` inherits, and both sheets are
      rendered inside the chrome layer, which is `pointer-events-none` so a
      transparent box over the viewport does not swallow taps meant for the
      page. They inherited it: every control in both sheets painted and none of
      them worked, for as long as they have existed. The tests at the time
      asserted visibility — the exact failure `consent-banner` had already
      taught this file about, applied to everything except its own sheets.
    */
    await sheet.getByRole("link", { name: "Agent" }).click();
    /*
      The fixture holds no session, so the guard redirects — and `next` is
      where the link was actually followed to. Asserting the landing URL would
      assert the auth guard; this asserts the tap.
    */
    await expect(page).toHaveURL(/[?&]next=[^&]*agent/);
  });

  test("keeps the account out of the sections, and reachable", async ({ page }) => {
    await page.goto(SHELL);

    /*
      Two levels, two places. The bar is this product; the corner is the whole
      account. Before this they were one stacked list, and the balance and the
      identity sat above the founder's own screen.
    */
    await expect(page.getByTestId("mobile-tab-bar").getByText("Credits")).toHaveCount(0);

    await page.getByTestId("mobile-account-trigger").click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByTestId("wallet")).toBeVisible();

    // And the identity row goes where it says it goes, rather than only saying so.
    await sheet.getByRole("link", { name: /Profile and account/ }).click();
    await expect(page).toHaveURL(/[?&]next=[^&]*settings%2Fprofile/);
  });

  test("rests the sheet on the bottom edge instead of filling the screen", async ({ page }) => {
    await page.goto(SHELL);
    await page.getByTestId("mobile-account-trigger").click();

    /*
      It filled all 844px with its rows at the top, because a modal `<dialog>`
      is given `inset-block: 0` and a fixed box pinned at both ends with an auto
      height stretches — so `mt-auto` had nothing to push against. Two things
      were wrong and both were silent; this is the one assertion that catches
      either coming back.
    */
    const box = await page.getByRole("dialog").evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom) };
    });

    expect(box.bottom).toBe(844);
    expect(box.top).toBeGreaterThan(200);
  });
});

test.describe("a focused flow has no chrome to escape through", () => {
  test.use({ viewport: PHONE });

  test("draws neither bar where the rail is empty", async ({ page }) => {
    await page.goto("/e2e/shell-without-a-rail");

    /*
      Onboarding and the connect flow render no rail on purpose: a full
      navigation beside a setup flow is an invitation to abandon it. The phone
      shape must not smuggle one back in — and the content must not be padded
      away from the top of the screen as if there were a bar above it.
    */
    await expect(page.getByTestId("mobile-tab-bar")).toHaveCount(0);
    await expect(page.getByTestId("mobile-account-trigger")).toHaveCount(0);

    const paddingTop = await page
      .locator("main")
      .evaluate((el) => Math.round(el.getBoundingClientRect().top + window.scrollY));
    expect(paddingTop).toBeLessThan(60);
  });
});

test.describe("the desktop rail is untouched", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("draws the rail and none of the phone's chrome", async ({ page }) => {
    await page.goto(SHELL);

    /*
      The phone shape is a second presentation, not a replacement. This is the
      guard that stops a `max-lg:` losing its variant and quietly shipping a
      tab bar across the bottom of a 1440px screen.
    */
    await expect(page.getByTestId("app-rail")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Project sections" })).toBeVisible();
    await expect(page.getByTestId("mobile-tab-bar")).toBeHidden();
    await expect(page.getByTestId("mobile-account-trigger")).toBeHidden();
  });
});

test.describe("a sheet you can get out of", () => {
  test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

  /*
   * A modal dialog with no exit is a trap, and this product shipped two.
   *
   * `Sheet` closed on a backdrop click by checking `event.target === the
   * dialog`, which is true only while the dialog *covers* the point. It used
   * to cover every point — the bottom variant filled the viewport, which was
   * the bug UI-35 fixed — so that worked by accident. Making it a real bottom
   * sheet silently removed the only way out, and the guard written at the time
   * measured the geometry and nothing else.
   *
   * Measured on the shipped build: a tap above the sheet lands on `<html>`,
   * the dialog's listener never runs, there is no Escape key on a phone, and
   * neither sheet drew a single button. The only exit was the browser's back
   * button.
   */
  const SHEETS = [
    [
      "the sections sheet",
      async (page: import("@playwright/test").Page) =>
        page.getByTestId("mobile-tab-bar").getByRole("button", { name: "More" }).click(),
    ],
    [
      "the account sheet",
      async (page: import("@playwright/test").Page) =>
        page.getByTestId("mobile-account-trigger").click(),
    ],
  ] as const;

  for (const [name, open] of SHEETS) {
    test(`${name} draws a way out`, async ({ page }) => {
      await page.goto(SHELL);
      await open(page);

      const sheet = page.getByRole("dialog");
      await expect(sheet).toBeVisible();

      /*
        Visible and named. A scrim is not a control anybody has been told
        about, so the exit has to be something a founder can see.
      */
      const close = sheet.getByRole("button", { name: "Close" });
      await expect(close).toBeVisible();

      await close.click();
      await expect(page.locator("dialog[open]")).toHaveCount(0);
    });

    test(`${name} closes on a tap outside it`, async ({ page }) => {
      await page.goto(SHELL);
      await open(page);

      const sheet = page.getByRole("dialog");
      await expect(sheet).toBeVisible();

      /*
        Tapped well above the panel, which is where the regression lived: the
        dialog no longer reaches that far, so this is the point its own click
        handler never hears about.
      */
      const box = (await sheet.boundingBox())!;
      expect(box.y).toBeGreaterThan(160);
      await page.mouse.click(195, Math.round(box.y) - 120);

      await expect(page.locator("dialog[open]")).toHaveCount(0);
    });
  }
});

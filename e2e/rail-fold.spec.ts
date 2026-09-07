import { expect, test, type Page } from "@playwright/test";

/**
 * One rail, in a browser (UI-13).
 *
 * ## What this exists to catch
 *
 * The complaint was specific and it was about pixels: clicking Settings made
 * the navigation *wider*, and the whole frame visibly rebuilt itself, so
 * moving between a product and the account read as the page reloading. The
 * cause was two rails — 256px in `projects/[projectId]/layout.tsx` and 280px
 * in `(account)/layout.tsx` — mounted from two different branches of the route
 * tree.
 *
 * There is one `<aside>` now, rendered by the layout both areas share, and the
 * navigations are `@rail` slot contents that swap inside it. A unit guard can
 * say the box is declared once; only a browser can say the two states of the
 * fold actually land on the same geometry, which is the whole of what a
 * founder sees.
 *
 * ## What it does not prove
 *
 * That the element survives the navigation as the same DOM node. These are
 * fixture routes: each renders one state directly, so there is no client-side
 * navigation between them to measure. That property is structural — the
 * `<aside>` is in `AppFrame` and in nothing else — and `rail-switch.test.ts`
 * is what holds it.
 */

const PRODUCT = "/e2e/understanding_ready";
const SETTINGS = "/e2e/account-products";

type RailGeometry = {
  rail: { x: number; width: number; height: number };
  lockup: { y: number };
  identity: { y: number };
};

async function measure(page: Page, url: string): Promise<RailGeometry> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(url);

  const rail = page.getByTestId("app-rail");
  await expect(rail).toBeVisible();

  const railBox = (await rail.boundingBox())!;
  const lockup = (await rail.getByRole("link", { name: /Vibe Business/ }).boundingBox())!;
  const identity = (await page.getByTestId("account-card").boundingBox())!;

  return {
    rail: { x: railBox.x, width: railBox.width, height: railBox.height },
    lockup: { y: lockup.y },
    identity: { y: identity.y },
  };
}

test.describe("the rail does not change when the navigation inside it does", () => {
  test("is the same box in a product and in Settings", async ({ page }) => {
    const product = await measure(page, PRODUCT);
    const settings = await measure(page, SETTINGS);

    // The reported defect, to the pixel: 256 against 280.
    expect(settings.rail.width, "the rail resizes on the way into Settings").toBe(
      product.rail.width,
    );
    expect(settings.rail.x).toBe(product.rail.x);
    expect(settings.rail.height).toBe(product.rail.height);
  });

  test("keeps the parts that do not change in place", async ({ page }) => {
    const product = await measure(page, PRODUCT);
    const settings = await measure(page, SETTINGS);

    /*
     * The lockup above and the identity below are the same two components in
     * both states and are meant to look continuous through the fold. If either
     * moves, the founder sees the rail rebuild rather than the navigation
     * inside it change — which is the difference this sprint is about.
     */
    expect(Math.abs(settings.lockup.y - product.lockup.y)).toBeLessThan(0.5);
    expect(Math.abs(settings.identity.y - product.identity.y)).toBeLessThan(0.5);
  });

  test("keeps the identity at the foot of the rail however long the list is", async ({ page }) => {
    /*
     * The product rail carries seven sections, a switcher and a palette
     * control and used to run 22px past a 900px viewport — so the whole
     * `<aside>` scrolled and the identity went with it, landing lower than
     * Settings put it. Only the list scrolls now.
     */
    for (const url of [PRODUCT, SETTINGS]) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(url);

      const rail = (await page.getByTestId("app-rail").boundingBox())!;
      const identity = (await page.getByTestId("account-card").boundingBox())!;
      const gap = rail.y + rail.height - (identity.y + identity.height);

      expect(gap, `${url} lets its identity leave the foot of the rail`).toBeGreaterThan(0);
      expect(gap, `${url} floats its identity above the foot of the rail`).toBeLessThan(40);

      // And it stays there while the list is read: the rail itself is not a
      // scroller, so nothing can carry the identity off the bottom of it.
      await expect(page.getByTestId("app-rail")).toHaveCSS("overflow-y", "hidden");
    }
  });

  test("starts the column beside it at one height on both surfaces", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    async function firstLine(url: string): Promise<number> {
      await page.goto(url);
      const main = (await page.locator("main").boundingBox())!;
      const lockup = (await page
        .getByTestId("app-rail")
        .getByRole("link", { name: /Vibe Business/ })
        .boundingBox())!;
      // Where the content column begins, relative to the mark beside it.
      return main.y - lockup.y;
    }

    // `--shell-top` is one number and both columns pad with it, so the offset
    // between the rail and the content is a property of the frame rather than
    // something each surface picked.
    expect(Math.abs((await firstLine(SETTINGS)) - (await firstLine(PRODUCT)))).toBeLessThan(0.5);
  });
});

test.describe("the list is what runs out of room", () => {
  test("absorbs a rail taller than the viewport inside the list", async ({ page }) => {
    // 700px is a real laptop with a real browser chrome on it, and the product
    // rail carries seven sections, a switcher and a palette control. Something
    // has to give; this says which thing.
    await page.setViewportSize({ width: 1440, height: 700 });
    await page.goto(PRODUCT);

    const scroller = page.getByTestId("rail-scroll");
    await expect(scroller).toHaveCSS("overflow-y", "auto");
    expect(
      await scroller.evaluate((el) => el.scrollHeight > el.clientHeight),
      "the section list is not the thing that scrolls",
    ).toBe(true);

    // The identity is still on screen at the foot, not below the fold.
    const rail = (await page.getByTestId("app-rail").boundingBox())!;
    const identity = (await page.getByTestId("account-card").boundingBox())!;
    expect(identity.y + identity.height).toBeLessThanOrEqual(rail.y + rail.height + 0.5);
  });
});

test.describe("a route with no navigation gets no rail", () => {
  test("reserves nothing beside a focused flow", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/e2e/shell-without-a-rail");

    await expect(page.getByRole("heading", { name: "A focused flow" })).toBeVisible();

    /*
     * The `<aside>` is still in the markup — one layout renders it for the
     * whole product — and it must take no space. `empty:hidden` is what does
     * that, and it is exactly the kind of rule that is true in a stylesheet
     * and false on a screen if anything ever renders a stray node into the
     * slot.
     */
    const rail = page.getByTestId("app-rail");
    await expect(rail).toHaveCount(1);
    await expect(rail).toBeHidden();
    expect(await rail.boundingBox()).toBeNull();

    // The column beside it starts at the left edge of the window. `main` is
    // centred inside that column, so the column itself is what carries the
    // answer to "did the rail take any width".
    const column = await page.locator("main").evaluate((el) => {
      const box = el.parentElement!.getBoundingClientRect();
      return { x: box.x, width: box.width };
    });
    expect(column.x, "the column is pushed aside by a rail nobody can see").toBe(0);
    expect(column.width).toBe(1440);
  });
});

test.describe("Settings says how to get back", () => {
  test("names a product rather than offering a redirect", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(SETTINGS);

    const back = page.getByTestId("app-rail").getByRole("link", { name: /^Back to / });
    await expect(back).toBeVisible();
    // A direct address, not `/app` — which resolves a destination server-side
    // before anything renders, and is what made leaving Settings feel like a
    // page load.
    await expect(back).toHaveAttribute("href", /^\/app\/projects\//);
  });
});

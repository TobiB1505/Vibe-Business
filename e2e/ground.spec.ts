import { inflateSync } from "node:zlib";
import { expect, test, type Page } from "@playwright/test";

/**
 * The ground, in a browser.
 *
 * The unit guard asserts that some component wears each ground class. Only a
 * browser can say whether the rule then paints anything — and the defect this
 * pair replaces was exactly a rule that existed, a class nobody wore, and a
 * product drawing glass over a flat field while every test passed.
 *
 * The palette is still dormant, so `data-vibe` is set from here. That is the
 * same way the scoped tokens were proved before any route opted in: the
 * attribute is the switch, and nothing in the product throws it yet.
 */

const NOVA = "/e2e/nova-priced";
/** A route that deliberately did not opt into the contained field. */
const DENSE = "/e2e/repository_intelligence";
/** An ordinary screen in the account shell — no field, just ground. */
const ACCOUNT = "/e2e/account-products";

/**
 * Put the page in one palette, whatever the deployment renders.
 *
 * These tests are *about* the two palettes, so each has to say which one it is
 * measuring rather than inherit it. That used to be free: the suite's server
 * set no `VIBE_PALETTE`, so v1 was simply what a page arrived in and only the
 * v2 half had to be asked for. The server renders v2 now (UI-37), and a test
 * whose subject is "v1 paints nothing" cannot depend on which way that
 * variable happens to point.
 */
async function palette(page: Page, name: "v1" | "v2") {
  await page.evaluate((value) => document.documentElement.setAttribute("data-vibe", value), name);
  // One frame for the new custom properties to resolve.
  await page.waitForTimeout(200);
}

function layer(page: Page, selector: string) {
  return page
    .locator(selector)
    .first()
    .evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        image: style.backgroundImage,
        position: style.position,
        zIndex: style.zIndex,
        opacity: style.opacity,
        events: style.pointerEvents,
      };
    });
}

test.describe("the ground exists and stays out of the way", () => {
  test("paints nothing at all in the first palette", async ({ page }) => {
    await page.goto(NOVA);
    await palette(page, "v1");
    for (const selector of [".vibe-atmosphere", ".vibe-grain", ".vibe-atmosphere-field"]) {
      const found = await layer(page, selector);
      // The hooks are rendered in v1 too; they simply match no rule there,
      // which is what makes the palette switchable without touching a route.
      expect(found.image, `${selector} must be inert in v1`).toBe("none");
      expect(found.position).toBe("static");
    }
  });

  test("paints the ramp and the grain in the second", async ({ page }) => {
    await page.goto(NOVA);
    await palette(page, "v2");

    const ramp = await layer(page, ".vibe-atmosphere");
    expect(ramp.image).toContain("linear-gradient");
    expect(ramp.position).toBe("fixed");
    expect(ramp.zIndex).toBe("-1");

    const grain = await layer(page, ".vibe-grain");
    expect(grain.image).toContain("data:image/svg+xml");
    // Present but nearly not there; a grain you can see is noise.
    expect(Number(grain.opacity)).toBeLessThan(0.06);
    expect(Number(grain.opacity)).toBeGreaterThan(0);
  });

  test("gives the contained field only to the screen that opted in", async ({ page }) => {
    await page.goto(NOVA);
    await palette(page, "v2");
    const field = await layer(page, ".vibe-atmosphere-field");
    expect(field.image).toContain("radial-gradient");
    expect(field.position).toBe("fixed");

    await page.goto(DENSE);
    await palette(page, "v2");
    await expect(page.locator(".vibe-atmosphere-field")).toHaveCount(0);
    // The ramp is still there — a route that does not opt in gets the quiet
    // ground, never no ground at all.
    expect((await layer(page, ".vibe-atmosphere")).image).toContain("linear-gradient");
  });

  /**
   * The assertion the rest of this file cannot make.
   *
   * Every other test here reads a computed style, and a computed style is
   * exactly what `.vibe-atmosphere` had while it was dead code: a rule that
   * resolved, on a class nothing wore, over a product drawing glass on a flat
   * field. Reading the rule proves the rule exists. Only pixels prove the
   * ground is *there*.
   *
   * The first version of this compared two 1×1 screenshots for inequality, and
   * it survived deleting the ramp — the grain alone makes two pixels differ,
   * and so does a changed `--color-app`. Difference is not a ramp. So this
   * decodes the pixel and asserts the *direction and size* of the gradient,
   * which is the only claim that fails when the ground goes away.
   */
  async function luminance(page: Page, y: number, x = 4): Promise<number> {
    // A 1×1 PNG: signature, chunks, one IDAT holding a filter byte and one
    // pixel. Small enough to decode here rather than to take a dependency.
    const png = await page.screenshot({ clip: { x, y, width: 1, height: 1 } });
    let offset = 8;
    let data = Buffer.alloc(0);
    let channels = 3;
    while (offset < png.length) {
      const length = png.readUInt32BE(offset);
      const type = png.toString("ascii", offset + 4, offset + 8);
      if (type === "IHDR") channels = png[offset + 8 + 9] === 6 ? 4 : 3;
      if (type === "IDAT")
        data = Buffer.concat([data, png.subarray(offset + 8, offset + 8 + length)]);
      offset += 12 + length;
    }
    const raw = inflateSync(data);
    // Byte 0 is the row's filter. On a 1×1 image every PNG predictor — Sub,
    // Up, Average, Paeth — reads a left neighbour and a row above that do not
    // exist and are defined as zero, so the stored bytes *are* the sample
    // whichever filter the encoder picked. Chromium picks Paeth.
    expect(raw[0], "unknown PNG filter").toBeLessThanOrEqual(4);
    const [r, g, b] = [raw[1], raw[2], raw[3]];
    expect(channels).toBeGreaterThanOrEqual(3);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  test("is a flat field in v1 and a lit ramp in v2, in decoded pixels", async ({ page }) => {
    await page.goto(NOVA);
    await palette(page, "v1");
    const flatTop = await luminance(page, 8);
    const flatBottom = await luminance(page, 600);
    expect(
      Math.abs(flatTop - flatBottom),
      "v1 is one colour top to bottom; a difference means the ground leaked into the first palette",
    ).toBeLessThan(0.5);

    await palette(page, "v2");
    const litTop = await luminance(page, 8);
    const litBottom = await luminance(page, 600);
    // Measured at 2.01× when this was written. The bar is deliberately well
    // under that: the claim is that a ramp exists and runs downward, not that
    // it keeps one exact value.
    expect(
      litTop / Math.max(litBottom, 0.01),
      `v2 must light the ground from the top: ${litTop.toFixed(2)} over ${litBottom.toFixed(2)}`,
    ).toBeGreaterThan(1.3);
  });

  /**
   * The ground survives the shell.
   *
   * This is the defect the test above could not see. `.vibe-atmosphere` is
   * `position: fixed; z-index: -1`, so it paints above the canvas and below
   * everything in flow — including a block background a shell draws over the
   * whole viewport. Every shell in the product drew `bg-app` there, which is
   * the same colour `body` already paints, so nothing looked broken and the
   * ramp was covered on every signed-in route.
   *
   * Measured on an account screen before the fix: 11.79 luminance at the top
   * and 11.79 at the bottom, which is `--color-app` exactly. The glass shipped
   * in S2 had, in the product, never once had anything to refract.
   *
   * Sampled inside the content column rather than at x=4, which is the rail —
   * chrome is its own glass and would answer for itself.
   */
  test("is not painted over by the shell on an ordinary product screen", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(ACCOUNT);
    await palette(page, "v1");
    const column = 1420;

    const flatTop = await luminance(page, 8, column);
    const flatBottom = await luminance(page, 860, column);
    await palette(page, "v2");
    const litTop = await luminance(page, 8, column);
    const litBottom = await luminance(page, 860, column);

    expect(
      litTop / Math.max(litBottom, 0.01),
      `the shell is covering the ground: ${litTop.toFixed(2)} over ${litBottom.toFixed(2)}`,
    ).toBeGreaterThan(1.3);

    /*
     * And the first palette is flat *by comparison*, not absolutely.
     *
     * An absolute bar was tried at half a pixel of luminance and failed at
     * 1.0 on a page with cards on it: a `shadow-card` bleeds past its own box
     * and is not hit-tested, so a column that `elementFromPoint` reports as
     * page background still picks up a little of it. That is noise. A ground
     * is not: the same column measures a ten-point drop with the ramp on. So
     * the claim is the ratio between the two palettes, which noise cannot
     * fake and a leak cannot survive.
     */
    const flat = Math.abs(flatTop - flatBottom);
    const lit = Math.abs(litTop - litBottom);
    expect(
      flat * 4,
      `v1 varies by ${flat.toFixed(2)} against v2's ${lit.toFixed(2)} — the ground leaked`,
    ).toBeLessThan(lit);
  });

  test("takes no pointer and no tab stop", async ({ page }) => {
    await page.goto(NOVA);
    await palette(page, "v2");
    for (const selector of [".vibe-atmosphere", ".vibe-grain", ".vibe-atmosphere-field"]) {
      expect((await layer(page, selector)).events).toBe("none");
    }
    const focusable = await page
      .locator(".vibe-atmosphere, .vibe-grain, .vibe-atmosphere-field")
      .evaluateAll((nodes) => nodes.filter((n) => (n as HTMLElement).tabIndex >= 0).length);
    expect(focusable).toBe(0);
  });
});

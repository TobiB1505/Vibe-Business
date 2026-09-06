import { expect, test, type Page } from "@playwright/test";

/**
 * A price sits on the digits' optical centre, not the line box's.
 *
 * Flex centres the coin against the text's line box, which reserves room for
 * descenders — and "35" has none, so the coin sat a pixel low. One pixel is
 * enough to look like a mistake and not enough to see why, which is exactly
 * the kind of thing that comes back the moment somebody composes a price by
 * hand instead of using the component.
 *
 * Only a browser can answer this: it needs the loaded face's real cap height,
 * and the correction is in `em`, so it has to be checked at more than one size
 * or it proves nothing about the others.
 */

async function offsetFromOpticalCentre(page: Page, index: number) {
  return page
    .locator("[data-credit-amount]")
    .nth(index)
    .evaluate((element) => {
      const style = getComputedStyle(element);
      const context = document.createElement("canvas").getContext("2d")!;
      context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const digits = context.measureText("35");
      const face = context.measureText("Hg");

      const node = [...element.childNodes].find(
        (child) => child.nodeType === 3 && child.textContent!.trim(),
      )!;
      const range = document.createRange();
      range.selectNodeContents(node);
      const box = range.getBoundingClientRect();

      const ascent = face.fontBoundingBoxAscent;
      const descent = face.fontBoundingBoxDescent;
      const baseline = box.top + (box.height - (ascent + descent)) / 2 + ascent;
      const inkCentre =
        (baseline - digits.actualBoundingBoxAscent + baseline + digits.actualBoundingBoxDescent) /
        2;

      const coin = element.querySelector("svg")!.getBoundingClientRect();
      return coin.top + coin.height / 2 - inkCentre;
    });
}

test("the coin sits on the digits' optical centre", async ({ page }) => {
  await page.goto("/e2e/study-credits");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.waitForTimeout(400);

  // Every price on the page, so the em-based correction is checked at whatever
  // sizes the study renders rather than at one.
  const prices = page.locator("[data-credit-amount]");
  const count = await prices.count();
  expect(count).toBeGreaterThan(0);

  for (let index = 0; index < count; index++) {
    const offset = await offsetFromOpticalCentre(page, index);
    // Half a pixel of tolerance: sub-pixel layout and hinting move this
    // slightly, and the defect being guarded was a full pixel.
    expect(Math.abs(offset), `price ${index} is ${offset.toFixed(2)}px off centre`).toBeLessThan(
      0.5,
    );
  }
});

import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./support/overflow";

/**
 * The two documents a stranger reads before connecting a repository (UI-17).
 *
 * ## Why this needs a browser
 *
 * Both defects were geometric and both were invisible from the source. The
 * article was `max-w-[46rem]` with no `mx-auto` inside a 96rem container, so
 * at 1440 it was a column pinned to the left with about 700px of nothing
 * beside it. And a nine-section legal document had no way to reach section
 * seven except scrolling past six — which is not a bug any assertion about a
 * component would have caught, because every component rendered correctly.
 *
 * ## What it proves
 *
 * That the contents list exists, that every entry in it goes somewhere real,
 * that clicking one lands the reader below the sticky header rather than
 * underneath it, that the page uses its width, and that a phone gets the same
 * list without a column that will not fit.
 */

const PAGES = ["/privacy", "/terms"] as const;

async function open(page: Page, path: string, width = 1440) {
  await page.setViewportSize({ width, height: 1000 });
  await page.goto(path);
}

for (const path of PAGES) {
  test.describe(`${path}`, () => {
    test("lists every section, and every entry goes somewhere", async ({ page }) => {
      await open(page, path);

      const contents = page.getByRole("navigation", { name: "On this page" });
      await expect(contents).toBeVisible();

      const { links, ids } = await page.evaluate(() => ({
        links: [...document.querySelectorAll("nav[aria-label='On this page'] a")].map((a) =>
          a.getAttribute("href"),
        ),
        ids: [...document.querySelectorAll("article section[id]")].map((s) => `#${s.id}`),
      }));

      // Derived from the sections rather than written beside them: a list that
      // is a second copy of the structure drifts the first time a section is
      // added, and a missing entry breaks nothing visible.
      expect(links.length, "the document has no sections listed").toBeGreaterThan(4);
      expect(links, "an entry points at a section that does not exist").toEqual(ids);
    });

    test("lands a clause clear of the sticky header", async ({ page }) => {
      await open(page, path);

      const contents = page.getByRole("navigation", { name: "On this page" });
      const target = contents.getByRole("link").nth(3);
      const heading = (await target.textContent())!.replace(/^\d+/, "").trim();

      await target.click();
      await page.waitForTimeout(700);

      const landed = await page.evaluate((text: string) => {
        const h2 = [...document.querySelectorAll("article section h2")].find(
          (n) => n.textContent?.trim() === text,
        ) as HTMLElement | undefined;
        const header = document.querySelector("header") as HTMLElement;
        if (!h2) return null;
        return {
          heading: h2.getBoundingClientRect().top,
          headerBottom: header.getBoundingClientRect().bottom,
        };
      }, heading);

      expect(landed, `no section is headed "${heading}"`).not.toBeNull();
      // Under the bar the reader just clicked through is the failure mode
      // `scroll-mt` exists to prevent, and only a browser can see it.
      expect(landed!.heading).toBeGreaterThan(landed!.headerBottom);
    });

    test("spends the width it has, and keeps the prose readable", async ({ page }) => {
      await open(page, path);

      const article = (await page.locator("article").boundingBox())!;
      const contents = (await page
        .getByRole("navigation", { name: "On this page" })
        .boundingBox())!;

      // The specific defect: the article on the left, and nothing at all to
      // the right of it.
      expect(contents.x, "the contents are not beside the document").toBeGreaterThan(
        article.x + article.width,
      );

      /*
       * And the column itself stays a column.
       *
       * The unit here is the advance of `0`, not a real character: in this
       * face `0` is 0.64em, so 70 of them is nearer ninety letters. The bound
       * is calibrated to that measurement rather than to a count of letters —
       * what matters is that it is the same measurement every time. The old
       * column measured 77.
       */
      const ch = await page.evaluate(() => {
        const para = [...document.querySelectorAll("article section p")].find(
          (n) => (n.textContent ?? "").length > 120,
        ) as HTMLElement;
        const style = getComputedStyle(para);
        const context = document.createElement("canvas").getContext("2d")!;
        context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        return para.getBoundingClientRect().width / context.measureText("0").width;
      });
      expect(Math.round(ch)).toBeLessThanOrEqual(72);
    });

    test("gives a phone the same list, closed", async ({ page }) => {
      await open(page, path, 390);

      // The sticky column cannot fit and is not there.
      await expect(page.getByRole("navigation", { name: "On this page" })).toHaveCount(0);

      const disclosure = page.locator("details", { hasText: "On this page" });
      await expect(disclosure).toBeVisible();
      // Closed: a reader who came to read should not scroll past a table of
      // contents to begin.
      expect(await disclosure.evaluate((node: HTMLDetailsElement) => node.open)).toBe(false);

      await disclosure.locator("summary").click();
      await expect(disclosure.getByRole("link").first()).toBeVisible();

      await expectNoHorizontalOverflow(page);
    });
  });
}

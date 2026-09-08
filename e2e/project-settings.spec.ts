import { expect, test, type Page } from "@playwright/test";

/**
 * The screen that disconnects a repository and deletes a product (UI-21).
 *
 * ## Why this file did not exist
 *
 * The route needs a session and a project in Supabase, and the browser suite
 * deliberately has neither — so the one page carrying both of a project's
 * consequential controls had no browser coverage at all, while Products,
 * Repositories, Profile and Billing each had a fixture. CLAUDE.md rule 69 asks
 * four questions before shipping consequential user-visible state, and *is the
 * actual browser-visible state tested* was the one this page answered no to.
 *
 * ## What it found on the first render
 *
 * Three things no source review had caught, because each needed two files open
 * at once or a ruler:
 *
 * 1. The section paragraph and the form's own paragraph both opened with the
 *    identical sentence — *"Vibe works out what your product is on its own."*
 *    — one under the other.
 * 2. Deleting the product was the third row of the card headed **Repository**,
 *    one border-top under Disconnect, both `InlineAction`s carrying the same
 *    icon. The account's General page states the rule this page broke: a row
 *    that looks the same beside an irreversible one is a trap.
 * 3. Every card ran to 1080px with its prose stopping at 65ch, putting ~580px
 *    of nothing between a sentence and the control it describes.
 */

const CONNECTED = "/e2e/project-settings";
const DISCONNECTED = "/e2e/project-settings-disconnected";

async function open(page: Page, path: string, width = 1440) {
  await page.setViewportSize({ width, height: 1000 });
  await page.goto(path);
  await page.evaluate(() => document.fonts.ready);
}

test.describe("project settings", () => {
  test("has one heading level under the page title", async ({ page }) => {
    await open(page, CONNECTED);

    const levels = await page.evaluate(() =>
      [...document.querySelectorAll("main h1, main h2, main h3, main h4")].map((n) => n.tagName),
    );

    // `WorkspaceSection` renders the `h1`. The sections under it were `h3`,
    // skipping a level — which no unit test can see and no reader notices
    // until they are navigating by heading.
    expect(levels[0]).toBe("H1");
    expect(levels.slice(1).every((tag) => tag === "H2"), levels.join(",")).toBe(true);
  });

  test("says each thing once", async ({ page }) => {
    await open(page, CONNECTED);

    const opener = "Vibe works out what your product is on its own";
    const count = await page.evaluate(
      (text: string) =>
        [...document.querySelectorAll("main p")].filter((n) =>
          (n.textContent ?? "").includes(text),
        ).length,
      opener,
    );
    expect(count, "the same sentence is printed twice").toBe(1);
  });

  test("keeps deleting out of the repository card", async ({ page }) => {
    await open(page, CONNECTED);

    const deleteSection = page.getByTestId("delete-project");
    await expect(deleteSection).toBeVisible();

    // Not a row inside the card about the repository.
    const inRepositoryCard = await page.evaluate(() => {
      const heading = [...document.querySelectorAll("main h2")].find(
        (n) => n.textContent?.trim() === "Repository",
      );
      const card = heading?.closest("section, div[class*='vibe-surface']");
      return !!card?.querySelector("[data-testid='delete-project']");
    });
    expect(inRepositoryCard, "deleting is back inside the Repository card").toBe(false);

    // And it is the last thing on the page: everything above is a fact, a
    // destination or a reversible action.
    const isLast = await page.evaluate(() => {
      const sections = [...document.querySelectorAll("main h2")];
      return sections.at(-1)?.textContent?.trim();
    });
    expect(isLast).toBe("Delete this product");
  });

  test("keeps each control beside the sentence that explains it", async ({ page }) => {
    await open(page, CONNECTED);

    const column = (await page.locator("main h2").first().evaluate((n) => {
      const card = n.closest("[class*='vibe-surface']") as HTMLElement;
      return card.getBoundingClientRect().width;
    }))!;

    // A settings page is a column of facts and controls, and a column has a
    // measure. It was 1080px with its prose capped at 65ch.
    expect(Math.round(column)).toBeLessThanOrEqual(768);

    const prose = (await page
      .getByText("Removes the project and everything Vibe has learned")
      .boundingBox())!;
    const control = (await page.getByRole("button", { name: "Delete project" }).boundingBox())!;

    // Under its own paragraph, not at the far edge of the card away from it.
    expect(control.y).toBeGreaterThan(prose.y);
    expect(Math.abs(control.x - prose.x)).toBeLessThan(24);
  });

  test("names both consequences before either runs", async ({ page }) => {
    await open(page, CONNECTED);

    await page.getByRole("button", { name: "Disconnect repository" }).click();
    // Disconnecting is reversible and says so.
    await expect(page.getByText(/keeps|stays|kept|stay/i).first()).toBeVisible();

    await page.reload();
    await page.getByRole("button", { name: "Delete project" }).click();
    // Deleting is not, and says that instead.
    await expect(page.getByText(/cannot be undone|permanently/i).first()).toBeVisible();
  });

  test("is a different page without a repository", async ({ page }) => {
    await open(page, DISCONNECTED);

    // Scoped to `main`: the rail's switcher says the same thing about the same
    // product, which is correct in both places and ambiguous to a locator.
    const main = page.locator("main");
    await expect(main.getByText("No repository connected")).toBeVisible();
    await expect(main.getByRole("link", { name: "Connect a repository" })).toBeVisible();
    // Nothing to disconnect.
    await expect(main.getByRole("button", { name: "Disconnect repository" })).toHaveCount(0);

    // Deleting survives, which is the point of it having its own section: a
    // project that was disconnected is the one somebody is most likely to want
    // gone (ADR 0056 §1).
    await expect(page.getByTestId("delete-project")).toBeVisible();
  });

  for (const [name, width] of [
    ["a laptop", 1024],
    ["a phone", 390],
  ] as const) {
    test(`fits ${name}`, async ({ page }) => {
      await open(page, CONNECTED, width);

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
});

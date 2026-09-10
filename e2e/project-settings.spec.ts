import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./support/overflow";

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

    // The rule is "no level is skipped", not "everything is an h2": since
    // UI-24 the danger zone is an `h2` with its rows as `h3`s under it, which
    // is the nesting it actually has. What was wrong before was h1 straight to
    // h3, and that is what this still refuses.
    const depths = levels.map((tag) => Number(tag.slice(1)));
    for (let index = 1; index < depths.length; index += 1) {
      expect(
        depths[index]! - depths[index - 1]!,
        `${levels.join(",")} skips a heading level`,
      ).toBeLessThanOrEqual(1);
    }
  });

  /**
   * The defect was two paragraphs opening with the same sentence, in two
   * files, so neither reader saw it. Written as a property rather than as one
   * string: UI-25 cut the intro that duplicated the questions, and a guard
   * pinned to a sentence that no longer exists asserts nothing about the next
   * duplicate.
   */
  test("says each thing once", async ({ page }) => {
    await open(page, CONNECTED);

    const paragraphs = await page.evaluate(() =>
      [...document.querySelectorAll("main p")]
        .map((n) => (n.textContent ?? "").trim())
        .filter((text) => text.length > 40),
    );

    expect(paragraphs.length, "nothing to compare").toBeGreaterThan(2);
    expect(new Set(paragraphs).size, "a paragraph is printed twice").toBe(paragraphs.length);
  });

  /**
   * The founder's report on the first attempt: *"die Fragen sind viel zu klein
   * … unübersichtlicher als davor"*. The questions were `text-body`, the same
   * size as the eighteen answers under them, and the first fix reached for
   * `text-ui` — which is 0.8125rem against body's 0.875rem, so it made them
   * smaller.
   */
  test("asks its questions louder than it answers them", async ({ page }) => {
    await open(page, CONNECTED);

    const sizes = await page.evaluate(() => {
      const legend = [...document.querySelectorAll("legend")].find((n) =>
        (n.textContent ?? "").includes("Where is the product"),
      ) as HTMLElement;
      const pill = legend
        .closest("fieldset")!
        .querySelector("[role='radiogroup'] label") as HTMLElement;
      return {
        question: parseFloat(getComputedStyle(legend).fontSize),
        answer: parseFloat(getComputedStyle(pill).fontSize),
      };
    });

    expect(sizes.question, "the question is not larger than its answers").toBeGreaterThan(
      sizes.answer,
    );
  });

  test("puts both sharp controls in the danger zone, and neither in a card", async ({ page }) => {
    await open(page, CONNECTED);

    const zone = page.getByTestId("danger-zone");
    await expect(zone).toBeVisible();
    await expect(zone.getByRole("button", { name: "Delete project" })).toBeVisible();
    await expect(zone.getByRole("button", { name: "Disconnect repository" })).toBeVisible();

    // Neither is a row inside the card about the repository any more.
    const inRepositoryCard = await page.evaluate(() => {
      const heading = [...document.querySelectorAll("main h2")].find(
        (n) => n.textContent?.trim() === "Repository",
      );
      const card = heading?.closest("section, div[class*='vibe-surface']");
      return card?.textContent?.includes("Disconnect") ?? false;
    });
    expect(inRepositoryCard, "disconnecting is back inside the Repository card").toBe(false);

    // And the zone is the last thing on the page.
    const isLast = await page.evaluate(() => {
      const sections = [...document.querySelectorAll("main h2")];
      return sections.at(-1)?.textContent?.trim();
    });
    expect(isLast).toBe("Danger zone");
  });

  /**
   * The region groups; it must not flatten. Disconnecting keeps everything the
   * project learned and deleting destroys it, and a reader has to be able to
   * tell which is which before pressing either.
   */
  test("says which of the two can be undone", async ({ page }) => {
    await open(page, CONNECTED);

    const zone = page.getByTestId("danger-zone");
    const rows = zone.getByRole("listitem");

    await expect(rows.filter({ hasText: "Disconnect the repository" })).toContainText("Reversible");
    await expect(rows.filter({ hasText: "Delete this product" })).toContainText("Permanent");
  });

  /**
   * A confirmation answered by one click can be answered by muscle memory, and
   * this page is reached from a switcher by somebody with several products.
   * The mistake it prevents is deleting the wrong one.
   */
  test("will not delete until the product is named", async ({ page }) => {
    await open(page, CONNECTED);

    await page.getByRole("button", { name: "Delete project" }).click();
    const confirm = page.getByRole("button", { name: "Delete project" }).last();
    await expect(confirm).toBeDisabled();

    await page.getByTestId("confirm-phrase").fill("Acmes");
    await expect(confirm).toBeDisabled();

    await page.getByTestId("confirm-phrase").fill("Acme");
    await expect(confirm).toBeEnabled();
  });

  /** Disconnecting is reversible, so it asks for a click and not a name. */
  test("asks for no name to disconnect", async ({ page }) => {
    await open(page, CONNECTED);

    await page.getByRole("button", { name: "Disconnect repository" }).click();
    await expect(page.getByTestId("confirm-phrase")).toHaveCount(0);
  });

  test("keeps each control beside the sentence that explains it", async ({ page }) => {
    await open(page, CONNECTED);

    const column = (await page
      .locator("main h2")
      .first()
      .evaluate((n) => {
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

  /**
   * "What you told Vibe" (UI-25).
   *
   * It was three native `<select>`s under labels that read like a schema —
   * *Stage*, *Monetization you're planning*, *Primary goal* — with eighteen
   * possible answers hidden behind three clicks. Seeing the options is most of
   * what makes these questions answerable.
   */
  test.describe("what you told Vibe", () => {
    test("asks questions, and shows every answer without a click", async ({ page }) => {
      await open(page, CONNECTED);

      // No dropdown left on the page.
      await expect(page.locator("main select")).toHaveCount(0);

      await expect(page.getByText("Where is the product right now?")).toBeVisible();
      await expect(page.getByText("How does it make money, or how will it?")).toBeVisible();
      await expect(page.getByText("What are you working toward next?")).toBeVisible();

      // All eighteen, on screen, before anything is opened.
      const radios = page.locator("main [role='radiogroup'] input[type='radio']");
      await expect(radios).toHaveCount(18);
    });

    test("marks the chosen answer absolutely, not only by tint", async ({ page }) => {
      await open(page, CONNECTED);

      const chosen = page.getByRole("radio", { name: "Has active users" });
      await expect(chosen).not.toBeChecked();
      await page.getByText("Has active users", { exact: true }).click();
      await expect(chosen).toBeChecked();

      // A tick inside the pill, not just a border colour: a tinted border is
      // readable only against the unselected ones beside it.
      const tick = await page.evaluate(() => {
        const input = [...document.querySelectorAll("input[type='radio']")].find(
          (n) => (n as HTMLInputElement).value === "active_users",
        );
        return !!input?.closest("label")?.querySelector("svg");
      });
      expect(tick, "the selected pill carries no mark of its own").toBe(true);
    });

    test("clears an answer back to nothing chosen", async ({ page }) => {
      await open(page, CONNECTED);

      // Nothing to undo before anything is answered.
      await expect(page.getByTestId("clear-stage")).toHaveCount(0);

      await page.getByText("Prototype", { exact: true }).click();
      await page.getByTestId("clear-stage").click();

      await expect(page.getByRole("radio", { name: "Prototype" })).not.toBeChecked();
      await expect(page.getByTestId("clear-stage")).toHaveCount(0);
    });

    test("keeps the clear control beside the question it undoes", async ({ page }) => {
      await open(page, CONNECTED);
      await page.getByText("Prototype", { exact: true }).click();

      const question = (await page.getByText("Where is the product right now?").boundingBox())!;
      const clear = (await page.getByTestId("clear-stage").boundingBox())!;

      // It was pushed to the far border of the card, ~700px from its own words.
      expect(clear.x - (question.x + question.width)).toBeLessThan(80);
    });
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

    // Deleting survives, which is the point of the zone being its own region:
    // a project that was disconnected is the one somebody is most likely to
    // want gone (ADR 0056 §1).
    const zone = page.getByTestId("danger-zone");
    await expect(zone.getByRole("button", { name: "Delete project" })).toBeVisible();
    // And the zone holds only what is still true.
    await expect(zone.getByText("Disconnect the repository")).toHaveCount(0);
  });

  for (const [name, width] of [
    ["a laptop", 1024],
    ["a phone", 390],
  ] as const) {
    test(`fits ${name}`, async ({ page }) => {
      await open(page, CONNECTED, width);

      await expectNoHorizontalOverflow(page);
    });
  }
});

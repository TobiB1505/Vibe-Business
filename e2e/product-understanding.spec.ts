import { expect, test, type Page } from "@playwright/test";

/**
 * Product understanding, in a real browser (CORE-1 §51–§54).
 *
 * ## Why this suite exists
 *
 * The sprint's success criterion is not "the profile has the right fields" —
 * it is that a founder reads one paragraph and thinks *yes, that's my
 * product*. That is a claim about reading order, about a logo rendering rather
 * than breaking, and about whether any of it survives a 375px screen. None of
 * those are properties a unit test on a view model can check.
 *
 * ## What it proves
 *
 * On first paint, with nothing expanded: the conclusion comes before the
 * evidence, the scanners are behind a disclosure, a real logo renders with a
 * real alt text, the confirm and edit controls are keyboard-operable buttons,
 * no state is carried by colour alone, and nothing overflows at any of the four
 * widths the sprint names.
 *
 * ## What it does not prove
 *
 * That the understanding route assembles the right profile — the fixture
 * supplies it, from the real pipeline. The same documented gap the merge and
 * repository-intelligence suites carry.
 */

const READY = "/e2e/understanding_ready";
const CONFIRMED = "/e2e/understanding_confirmed";
const PARTIAL = "/e2e/understanding_partial";

/**
 * The logo fixture points at `https://acme.test`, which does not exist. That
 * is deliberate: the assertion is about the `<img>` the page renders, not
 * about a network fetch, and a suite that reached the internet would be a
 * different kind of test.
 */
async function forbidExternalCalls(page: Page): Promise<string[]> {
  const attempted: string[] = [];

  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
      attempted.push(url.href);
      await route.abort();
      return;
    }
    await route.continue();
  });

  return attempted;
}

test.describe("the conclusion comes first", () => {
  test("opens with what Vibe understood, above everything else", async ({ page }) => {
    await forbidExternalCalls(page);
    await page.goto(READY);

    await expect(page.getByRole("heading", { name: "I understand what you built." })).toBeVisible();
    await expect(page.getByText("You've built a tool that helps small teams")).toBeVisible();

    // Reading order, measured rather than assumed: the paragraph sits above
    // the capability list on the page.
    const headline = await page
      .getByText("You've built a tool that helps small teams")
      .boundingBox();
    const capabilities = await page.getByText("What people can do").boundingBox();

    expect(headline).not.toBeNull();
    expect(capabilities).not.toBeNull();
    expect(headline!.y).toBeLessThan(capabilities!.y);
  });

  test("keeps the scanners' output behind a disclosure", async ({ page }) => {
    await forbidExternalCalls(page);
    await page.goto(READY);

    const finding = page.getByText("Payment functionality appears to be present.");
    await expect(finding).toBeHidden();

    await page.getByText("See what Vibe found").click();
    await expect(finding).toBeVisible();
  });

  test("never shows a count of files, routes or detections", async ({ page }) => {
    await forbidExternalCalls(page);
    await page.goto(READY);

    const body = (await page.locator("body").innerText()).toLowerCase();
    expect(body).not.toMatch(/\d+\s+(files?|routes?|detections?)/);
    expect(body).not.toContain("repository intelligence");
    expect(body).not.toContain("snapshot");
  });
});

test.describe("the logo reveal", () => {
  test("renders the real asset with a name, not a generic label", async ({ page }) => {
    await forbidExternalCalls(page);
    await page.goto(READY);

    const logo = page.getByAltText("Acme logo");
    await expect(logo).toHaveAttribute("src", "https://acme.test/logo.svg");
    await expect(logo).toHaveAttribute("referrerpolicy", "no-referrer");
  });

  test("shows a neutral mark and says why when no logo can be shown", async ({ page }) => {
    await forbidExternalCalls(page);
    await page.goto(PARTIAL);

    await expect(page.getByAltText("Acme logo")).toHaveCount(0);
    await expect(
      page.getByText("Vibe found a logo in your project but can't show it from here yet."),
    ).toBeVisible();
  });
});

test.describe("did I get this right", () => {
  test("offers both answers as real, keyboard-reachable buttons", async ({ page }) => {
    await forbidExternalCalls(page);
    await page.goto(READY);

    await expect(page.getByRole("heading", { name: "Did I get this right?" })).toBeVisible();

    const yes = page.getByRole("button", { name: "Yes, that's my product" });
    const edit = page.getByRole("button", { name: "Let me fix it" });
    await expect(yes).toBeVisible();
    await expect(edit).toBeVisible();

    await yes.focus();
    await expect(yes).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(edit).toBeFocused();
  });

  test("opens a labelled editor rather than a dialog to trap focus in", async ({ page }) => {
    await forbidExternalCalls(page);
    await page.goto(READY);

    await page.getByRole("button", { name: "Let me fix it" }).click();

    await expect(page.getByLabel("Who it's for")).toBeVisible();
    await expect(page.getByLabel("What your product does")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save what I changed" })).toBeVisible();

    // The editor starts from what Vibe said, not from blank.
    await expect(page.getByLabel("Product name")).toHaveValue("Acme");
  });

  test("replaces the question once a person has answered it", async ({ page }) => {
    await forbidExternalCalls(page);
    await page.goto(CONFIRMED);

    await expect(page.getByRole("button", { name: "Yes, that's my product" })).toHaveCount(0);
    await expect(page.getByText("You confirmed this")).toBeVisible();
  });
});

test.describe("partial failure stays useful", () => {
  test("says what was not checked, without blaming the user", async ({ page }) => {
    await forbidExternalCalls(page);
    await page.goto(PARTIAL);

    await expect(page.getByText("Your public product has not been checked yet")).toBeVisible();
    await expect(page.getByText("Here's what Vibe found.")).toBeVisible();

    const body = (await page.locator("body").innerText()).toLowerCase();
    for (const blame of ["you should", "you failed", "error", "missing:"]) {
      expect(body, `blame leaked: ${blame}`).not.toContain(blame);
    }
  });

  test("still shows the capabilities and journey the rules established", async ({ page }) => {
    await forbidExternalCalls(page);
    await page.goto(PARTIAL);

    await expect(page.getByText("What people can do")).toBeVisible();
    await expect(page.getByText("How the product appears to work")).toBeVisible();
  });
});

test.describe("state is never carried by colour alone", () => {
  test("writes every confidence in words beside its glyph", async ({ page }) => {
    await forbidExternalCalls(page);
    await page.goto(READY);

    await expect(page.getByText("Seen on your live product").first()).toBeVisible();
    await expect(page.getByText("Likely, based on several signals").first()).toBeVisible();
  });

  test("labels each evidence source rather than only ticking it", async ({ page }) => {
    await forbidExternalCalls(page);
    await page.goto(READY);

    // Each row carries a decorative glyph beside its label, so the assertion
    // is on the row's own text rather than on an exact-match string.
    const sources = page.getByRole("listitem").filter({ hasText: "Your code" });
    await expect(sources.first()).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: "Your public product" }).first()).toBeVisible();
    await expect(page.getByText("Your signed-in product has not been checked yet")).toBeVisible();
  });
});

const WIDTHS = [1440, 1024, 768, 375];

test.describe("responsive", () => {
  for (const width of WIDTHS) {
    test(`does not scroll sideways at ${width}px`, async ({ page }) => {
      await forbidExternalCalls(page);
      await page.setViewportSize({ width, height: 900 });
      await page.goto(READY);

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      // One pixel of tolerance for sub-pixel layout rounding; anything more is
      // a real horizontal scrollbar.
      expect(overflow).toBeLessThanOrEqual(1);
    });
  }

  test("keeps the editor usable on a phone", async ({ page }) => {
    await forbidExternalCalls(page);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(READY);

    await page.getByRole("button", { name: "Let me fix it" }).click();
    await expect(page.getByLabel("Product name")).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

test.describe("document structure", () => {
  test("nests headings so the outline matches what is on screen", async ({ page }) => {
    await forbidExternalCalls(page);
    await page.goto(READY);

    const levels = await page
      .locator("h1, h2, h3, h4")
      .evaluateAll((nodes) => nodes.map((node) => Number(node.tagName.slice(1))));

    expect(levels.length).toBeGreaterThan(0);
    // No level is skipped on the way down — an h2 followed by an h4 reads as a
    // missing section to anyone navigating by heading.
    for (let index = 1; index < levels.length; index += 1) {
      expect(levels[index] - levels[index - 1]).toBeLessThanOrEqual(1);
    }
  });
});

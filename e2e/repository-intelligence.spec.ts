import { expect, test, type Page } from "@playwright/test";

/**
 * Repository intelligence, in a real browser (Sprint UI-3.6).
 *
 * ## Why this suite exists
 *
 * Because this sprint's claim is about **reading order**, and no assertion on a
 * data structure can check it. `buildRepositoryHumanView` returning a headline
 * proves the string exists; it does not prove a person sees the conclusion
 * before they see `src/app/(auth)/signup/page.tsx`. That is a question about
 * pixels, disclosure state and viewport width, so it is asked here.
 *
 * ## What it proves
 *
 * That on first paint, with nothing expanded: the conclusions are visible, the
 * package names and file paths are not, the technical layer is present and
 * reachable by keyboard, and none of it overflows a 375px screen.
 *
 * ## What it does not prove
 *
 * That the overview route assembles the right snapshot — the fixture supplies
 * it. The same gap the merge suite documents.
 */

const CODE_ONLY = "/e2e/repository_intelligence";
const CONTRADICTION = "/e2e/repository_intelligence_contradiction";
const AGREEMENT = "/e2e/repository_intelligence_agreement";
const LIMITED_ROUTES = "/e2e/repository_intelligence_limited_routes";

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

test.describe("the answer comes first", () => {
  test("opens with what Vibe understood, not with the analyzer's output", async ({ page }) => {
    const external = await forbidExternalCalls(page);
    await page.goto(CODE_ONLY);

    await expect(page.getByRole("heading", { level: 3 })).toContainText("Vibe understands");
    await expect(page.getByText("Customers can create an account and sign in.")).toBeVisible();
    await expect(
      page.getByText("Payment functionality appears to be started, but the buying flow isn't clear yet."),
    ).toBeVisible();

    expect(external).toEqual([]);
  });

  test("keeps package names, file paths and scan counts out of the default view", async ({ page }) => {
    await page.goto(CODE_ONLY);

    const body = await page.locator("body").innerText();

    for (const technical of [
      "@supabase/ssr",
      "stripe",
      "package.json",
      "src/app/(auth)/signup/page.tsx",
      "vercel.json",
      "2f05958",
      "27264",
      "431",
    ]) {
      expect(body).not.toContain(technical);
    }
  });

  test("groups what exists before what needs checking before what is missing", async ({ page }) => {
    await page.goto(CODE_ONLY);

    // Read from the landmarks rather than the headings: the group heading is
    // uppercased by CSS, and its accessible name is what a screen reader
    // announces in the same order a sighted reader meets it.
    const groups = await page.locator("section[aria-label]").evaluateAll((sections) =>
      sections.map((section) => section.getAttribute("aria-label")),
    );

    expect(groups).toEqual(["What already exists", "What needs checking", "What Vibe couldn't find"]);
  });

  test("states the business consequence of a gap and offers one way forward", async ({ page }) => {
    await page.goto(CODE_ONLY);

    await expect(page.getByText("You may not know what visitors do after they arrive.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Review next moves" }).first()).toHaveAttribute(
      "href",
      "/app/projects/project_e2e/plan",
    );
    await expect(page.getByRole("link", { name: "Check the live product" }).first()).toHaveAttribute(
      "href",
      "#live-product-check",
    );
  });
});

test.describe("evidence is subordinated, never removed", () => {
  test("technical details are collapsed by default and open on click", async ({ page }) => {
    await page.goto(CODE_ONLY);

    const technical = page.getByText("Technical details").first();
    await expect(technical).toBeVisible();
    await expect(page.getByText("analyzerVersion")).toBeHidden();

    await technical.click();
    await expect(page.getByText("analyzerVersion")).toBeVisible();
    await expect(page.getByText("repo-intelligence-v2")).toBeVisible();
    // Exact values, not rounded ones.
    await expect(page.getByText("27264", { exact: true })).toBeVisible();
  });

  test("a disclosure is operable by keyboard alone", async ({ page }) => {
    await page.goto(CODE_ONLY);

    const summary = page.getByText("What Vibe found").first();
    await summary.focus();
    await expect(summary).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(page.getByText("A sign-up page")).toBeVisible();

    // `<details>` supplies the state to assistive technology itself.
    await expect(summary.locator("xpath=..")).toHaveAttribute("open", "");
  });

  test("file paths remain reachable underneath the readable evidence", async ({ page }) => {
    await page.goto(CODE_ONLY);

    await page.getByText("What Vibe found").first().click();
    await page.getByText("Where in the code").first().click();

    await expect(page.getByText("package.json").first()).toBeVisible();
    await expect(page.getByText("@supabase/ssr")).toBeVisible();
  });
});

test.describe("the two intelligence layers", () => {
  test("names what this screen is and is not", async ({ page }) => {
    await page.goto(CODE_ONLY);

    await expect(page.getByText("What Vibe learned from your code")).toBeVisible();
    await expect(page.getByText("Only checking the live product can show whether it works")).toBeVisible();
  });

  test("turns a disagreement between code and live product into a business finding", async ({
    page,
  }) => {
    await page.goto(CONTRADICTION);

    await expect(
      page.getByText("Your product can take payments, but nothing a visitor can reach leads to paying."),
    ).toBeVisible();
    await expect(page.getByText("Repository signal")).toHaveCount(0);
  });

  /*
   * The half of R7 that is easy to leave out: an empty comparison and a
   * comparison that never ran render the same empty list, and on screen they
   * are opposite claims. One says so; the other stays silent.
   */
  test("says the two layers agree, but only when they were compared", async ({ page }) => {
    await page.goto(AGREEMENT);

    const section = page.getByRole("region", { name: /your code against your live product/i });
    await expect(section).toContainText(/everything vibe compared lines up/i);

    await page.goto(CODE_ONLY);
    await expect(
      page.getByRole("region", { name: /your code against your live product/i }),
    ).toHaveCount(0);
  });

  test("says an analysis did not finish before its results are read", async ({ page }) => {
    await page.goto(LIMITED_ROUTES);

    const notice = page.getByRole("status").first();
    await expect(notice).toContainText("did not finish");
    /*
     * In words, not in the analyzer's vocabulary. This asserted the literal
     * `tree_truncated` on screen (audit D12) — a budget name a founder can
     * only read as a defect in their own repository.
     */
    await expect(notice).toContainText(/more files than vibe reads in one pass/i);
    await expect(notice).not.toContainText("tree_truncated");
  });
});

test.describe("375px", () => {
  test.use({ viewport: { width: 375, height: 900 } });

  test("does not scroll sideways, even with every disclosure open", async ({ page }) => {
    await page.goto(CODE_ONLY);

    // Force every `<details>` open — the state a curious reader ends up in,
    // and the one where long repository paths used to push the page sideways.
    await page.evaluate(() => {
      for (const details of document.querySelectorAll("details")) details.open = true;
    });

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("shows the conclusion and its next step without expanding anything", async ({ page }) => {
    await page.goto(CODE_ONLY);

    await expect(page.getByText("You may not know what visitors do after they arrive.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Review next moves" }).first()).toBeVisible();
  });
});

import { expect, test } from "@playwright/test";

/**
 * The Deep Scan panel under `launch-v1`.
 *
 * PRODUCT.md §12.1 has said additional Deep Scans are credit-gated since Sprint
 * 5, and until now the panel's answer was a disabled "Coming with Vibe Credits".
 * `launch-v1` puts a button there that spends 25 Credits.
 *
 * A domain test proves the entitlement resolves to `credits` and that only a
 * persisted snapshot settles the hold. Only a browser proves the person is told
 * the price — and told what happens when a scan comes back with nothing —
 * before they click ([CLAUDE.md](../CLAUDE.md) rule 69).
 */

test.describe("an additional Deep Scan, priced", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/e2e/deep-scan-additional-available");
  });

  test("states the price before the click, not after it", async ({ page }) => {
    await expect(page.getByText("Another one costs 25 Credits.")).toBeVisible();
  });

  test("puts the price on the control that spends it", async ({ page }) => {
    // A cost revealed after the click is a surprise, and a surprise is what a
    // Credit system exists to avoid.
    await expect(page.getByRole("button", { name: /Run Deep Scan · 25 Credits/ })).toBeEnabled();
  });

  test("says that a scan which finds nothing is not charged", async ({ page }) => {
    // The hold is released on every outcome that does not persist a snapshot.
    // Somebody deciding whether to spend deserves to know that while deciding.
    await expect(page.getByText("You're only charged if Vibe comes back with a result.")).toBeVisible();
  });

  test("offers no checkout it cannot honour", async ({ page }) => {
    await expect(page.getByRole("link", { name: "Top up Credits" })).toHaveCount(0);
  });
});

test.describe("an additional Deep Scan the balance cannot cover", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/e2e/deep-scan-insufficient-credits");
  });

  test("names the price and says the balance is short", async ({ page }) => {
    await expect(
      page.getByText(/Another Deep Scan costs 25 Credits, and your balance doesn.t cover it yet\./),
    ).toBeVisible();
  });

  test("sends the customer somewhere that can fix it", async ({ page }) => {
    // The difference between this state and `credits_required`: this one has a
    // checkout behind it.
    await expect(page.getByRole("link", { name: "Top up Credits" })).toHaveAttribute(
      "href",
      "/app/billing",
    );
  });

  test("does not offer a start it would refuse", async ({ page }) => {
    await expect(page.getByRole("button", { name: /Run Deep Scan/ })).toHaveCount(0);
  });
});

test.describe("an additional Deep Scan that is not for sale", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/e2e/deep-scan-credits-required");
  });

  test("explains rather than sells, and invents no price", async ({ page }) => {
    // Reachable only when no policy prices an additional scan. The honest
    // terminal answer, and not a route into a checkout that cannot help.
    await expect(page.getByText(/aren.t available right now/)).toBeVisible();

    const text = await page.locator("body").innerText();
    expect(text).not.toContain("Credits");
  });

  test("offers no control at all", async ({ page }) => {
    await expect(page.getByRole("button", { name: /Run Deep Scan/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Top up Credits" })).toHaveCount(0);
  });
});

/**
 * A finished Deep Scan, and another one buyable.
 *
 * The state that shipped broken. `state` ranks `completed` above every
 * purchasable state — correctly, because once a scan exists that is what the
 * section is about — and the branch that renders it drew a summary card with no
 * control, no price and no reason. One successful scan and the panel was
 * read-only for good.
 *
 * Nothing below the browser could see it: the entitlement resolved `credits`,
 * the view model was right, and every unit fixture for `completed` happened to
 * use a policy that priced no additional scan. Rule 69's third question,
 * answered.
 */
test.describe("running another Deep Scan after one has finished", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/e2e/deep-scan-completed-rerunnable");
  });

  test("still shows the finished result", async ({ page }) => {
    await expect(page.getByText("Pages Vibe looked at")).toBeVisible();
    await expect(page.getByText("Dashboard")).toBeVisible();
  });

  test("offers a way to run another one", async ({ page }) => {
    // The defect, stated as the thing a person could not do.
    await expect(page.getByRole("button", { name: /Scan again · 25 Credits/ })).toBeEnabled();
  });

  test("states the price on the control that spends it", async ({ page }) => {
    await expect(page.getByRole("button", { name: /25 Credits/ })).toBeVisible();
  });

  test("says that a scan which finds nothing is not charged", async ({ page }) => {
    await expect(page.getByText("You're only charged if Vibe comes back with a result.")).toBeVisible();
  });
});

test.describe("a finished Deep Scan while a cooldown is in force", () => {
  test("gives a reason instead of an empty card", async ({ page }) => {
    // A heading and a summary with no action and no explanation is
    // indistinguishable from a broken page — which is how this was reported.
    await page.goto("/e2e/deep-scan-completed-blocked");

    await expect(page.getByRole("button", { name: /Scan again/ })).toHaveCount(0);
    await expect(page.getByText(/Please wait a moment before starting another Deep Scan\./)).toBeVisible();
  });
});

/*
 * Slice 3: a finished scan says what it noticed, behind a disclosure, grouped
 * by what kind of statement each note is.
 *
 * The snapshot has carried these since it existed and the view model dropped
 * them, so "Check finished: only partly" was once the entire account of a scan
 * that had specific things to report. Then they arrived as one flat list under
 * "N things Vibe could not check" — and a real scan produced six of them of
 * which **one** was a failure. Two were facts Vibe had established by looking,
 * one was the page budget working as designed, two were safety refusals.
 *
 * A founder reading that heading learns Vibe failed six times. It failed once.
 * Only a browser says what the heading actually reads (rule 69).
 */
test.describe("what a finished scan reports about itself", () => {
  test("counts failures, and groups the rest as what it is", async ({ page }) => {
    await page.goto("/e2e/deep-scan-completed-with-warnings");

    /*
     * The finding leads. This card opened with a three-row definition list and
     * put what Vibe had actually found underneath it as small grey chips — a
     * receipt with the answer stapled to the back.
     */
    const surfaces = page.getByText("Surfaces Vibe recognised");
    const receipt = page.getByText("Pages Vibe looked at");
    await expect(surfaces).toBeVisible();
    await expect(receipt).toBeVisible();

    const surfacesBox = await surfaces.boundingBox();
    const receiptBox = await receipt.boundingBox();
    expect(surfacesBox!.y).toBeLessThan(receiptBox!.y);

    /*
     * And the scan is not called half-done for having behaved.
     *
     * "Only partly", in amber, was the whole account of a scan whose single
     * limit was that Vibe refuses every non-GET request — which it does
     * because the session is the founder's own, and always will.
     */
    await expect(page.getByText("Yes, within Vibe's limits")).toBeVisible();
    await expect(page.getByText(/refuses anything that could change your data/i)).toBeVisible();
    await expect(page.getByText(/by design and not by configuration/i)).toBeVisible();

    // One failure in three notes, and the label says exactly that.
    const disclosure = page.getByText("1 page Vibe could not read · 2 notes");
    await expect(disclosure).toBeVisible();

    // Counted before it is opened, so the label is the size of what is behind it.
    await expect(page.getByText(/took too long to load/i)).toBeHidden();
    await disclosure.click();

    await expect(page.getByText("Could not be read")).toBeVisible();
    await expect(page.getByText(/took too long to load/i)).toBeVisible();

    await expect(page.getByText("Stopped on purpose")).toBeVisible();
    await expect(page.getByText(/exist in more copies/i)).toBeVisible();

    await expect(page.getByText("Left alone")).toBeVisible();
    await expect(page.getByText(/redirected to a page Vibe had already/i)).toBeVisible();

    /*
     * And the path, which is what tells two notes apart. A real scan produced
     * two identical redirect sentences with nothing between them, and that is
     * how a correct message reads as the same message printed twice.
     */
    await expect(page.getByText("/app/onboarding")).toBeVisible();
    await expect(page.getByText("/app/reports")).toBeVisible();
  });
});

/*
 * A founder spends 25 Credits and ninety seconds letting Vibe into their
 * signed-in product, and got back a timestamp, a page count and seven grey
 * chips. The evidence behind every one of those chips was in the snapshot the
 * whole time — which pages, which headings — and none of it reached the screen.
 */
test.describe("the overview after a scan", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/e2e/deep-scan-completed-with-warnings");
  });

  test("lets a founder check any surface it claims", async ({ page }) => {
    // The claim, and the way to the proof, on the same row.
    const dashboard = page.getByRole("listitem").filter({ hasText: "Dashboard" }).first();
    await expect(dashboard).toContainText("Dashboard");

    await dashboard.getByRole("button", { name: /source/i }).click();

    // The pages that are the reason Vibe says it, in sentences and not ids.
    const drawer = page.getByRole("dialog");
    await expect(drawer).toContainText("Vibe opened this page while signed in");
    await expect(drawer).toContainText("Welcome back");
    await expect(drawer).toContainText("/app");
  });

  test("names the screens it read, not the paths", async ({ page }) => {
    /*
     * Twenty-one paths is a list nobody reads. The template carries the
     * instance count instead, because "which three projects" is a real
     * question and not the first one.
     */
    await expect(page.getByText("2 screens Vibe read")).toBeVisible();
    await expect(page.getByText("/app/projects/:id/settings")).toBeVisible();
    await expect(page.getByText("2 of them")).toBeVisible();
  });

  test("says what was on those pages, behind the first answer", async ({ page }) => {
    const shape = page.getByText("What was on those pages");
    await expect(shape).toBeVisible();

    // Second question, so it is not open by default.
    await expect(page.getByText("Navigation Vibe saw")).toBeHidden();
    await shape.click();

    await expect(page.getByText("Navigation Vibe saw")).toBeVisible();
    await expect(page.getByText("My Products")).toBeVisible();
    await expect(page.getByText("Pages with a form")).toBeVisible();
  });
});

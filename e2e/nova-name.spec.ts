import { expect, test } from "@playwright/test";

/**
 * The one question Nova asks about the founder rather than about the product.
 *
 * Two claims are being held here and they pull in opposite directions. Nova is
 * not a chat box — there is nothing to type at her, which is what makes her a
 * colleague rather than a prompt window. And she has to be able to call
 * somebody by their name, which nothing in this product could do without
 * asking, because `identity-view.ts` refuses to turn an address into one.
 *
 * The reconciliation is that this is a *label*, not an instruction: one
 * bounded line, asked once. These tests are what stop the exemption widening.
 */

const ASKING = "/e2e/study-opening-asks-name";
const KNOWS = "/e2e/study-opening-shipped";

/*
 * The opening is a choreography — the mark assembles, travels, the room is
 * drawn around it, and only then does she speak. Waiting for her last sentence
 * is waiting for the whole sequence, and it is the honest way to wait: a fixed
 * timeout would pass on a machine that never got there.
 */
const spoken = "One thing before we start — what should I call you?";

test.describe("meeting a founder Nova has no name for", () => {
  test("greets by the login and still asks what to call them", async ({ page }) => {
    await page.goto(ASKING);

    /*
      Both, and the order matters. A login is a name somebody chose, so she
      uses it; it is not what anybody is called, so she still asks. A screen
      that treated the login as an answer to both would be reading a database
      out loud.
    */
    await expect(page.getByText(/Hi ada-lovelace — I'm Nova/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(spoken)).toBeVisible({ timeout: 20_000 });
  });

  test("asks with one bounded line, and nothing to write at her in", async ({ page }) => {
    await page.goto(ASKING);
    const field = page.locator('input[name="displayName"]');
    await expect(field).toBeVisible({ timeout: 20_000 });

    // The bound is the database's, not a number somebody typed into a screen.
    await expect(field).toHaveAttribute("maxlength", "60");

    // And the claim this must not cost: she is still not a chat box.
    await expect(page.locator("textarea")).toHaveCount(0);
    await expect(page.locator("input[type='text'], input:not([type])")).toHaveCount(1);
  });

  test("names the field for a screen reader, and the label is not the question", async ({
    page,
  }) => {
    await page.goto(ASKING);
    const field = page.getByLabel("What Nova calls you");
    await expect(field).toBeVisible({ timeout: 20_000 });

    /*
      Her question is her voice and the label is the field's name. If the label
      were the question restated, a screen reader would read it twice — and if
      there were no label at all it would read nothing.
    */
    await expect(field).not.toHaveAttribute("aria-label", spoken);
  });

  test("carries the answer on the control that was already there", async ({ page }) => {
    await page.goto(ASKING);
    await expect(page.locator('input[name="displayName"]')).toBeVisible({ timeout: 20_000 });

    /*
      One press, not two. A separate "Save" beside "Continue" would make the
      name a form to fill in rather than something she asked, and would leave a
      state where the name is stored and the introduction is not over.
    */
    const controls = page.getByRole("button").or(page.locator('button[type="submit"]'));
    await expect(page.getByRole("button", { name: /save/i })).toHaveCount(0);
    await expect(controls.filter({ hasText: "Continue" })).toHaveCount(1);
  });
});

test.describe("meeting a founder who has already said", () => {
  test("does not ask again, and offers no field", async ({ page }) => {
    await page.goto(KNOWS);

    await expect(page.getByText(/Hi ada-lovelace — I'm Nova/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(spoken)).toHaveCount(0);
    await expect(page.locator('input[name="displayName"]')).toHaveCount(0);
  });
});

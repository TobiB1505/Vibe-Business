import { expect, test } from "@playwright/test";

/**
 * Profile.
 *
 * ## What this exists to hold
 *
 * The page shows two facts and one claim, and the claim is the part that can
 * go wrong silently: a panel headed "what Vibe does not keep" is a promise
 * about storage, and it is printed beside the very things it is describing. It
 * already said "the picture above is served by GitHub" on a screen rendering
 * initials, because the line was fixed text and the avatar was not.
 *
 * So these assert the claim against the state it is printed in, not merely
 * that it appears.
 */

const CONNECTED = "/e2e/profile-connected";
const NO_GITHUB = "/e2e/profile-no-github";
const NO_EMAIL = "/e2e/profile-no-email";

test.describe("the person, as the product knows them", () => {
  test("calls a connected founder by their GitHub login, with the address below", async ({
    page,
  }) => {
    await page.goto(CONNECTED);

    await expect(page.getByRole("heading", { name: "Profile", level: 1 })).toBeVisible();
    await expect(page.getByText("ada-lovelace").first()).toBeVisible();
    await expect(page.getByText("founder@example.com")).toBeVisible();
  });

  test("prints an address once when it is also the name", async ({ page }) => {
    // Without GitHub the address *is* the display name. Rendering it again as
    // its own caption underneath reads as two facts about a person Vibe holds
    // one fact about.
    await page.goto(NO_GITHUB);

    await expect(page.getByText("founder@example.com")).toHaveCount(1);
  });

  test("still renders a person when there is neither login nor address", async ({ page }) => {
    // `Session.email` is nullable, so this is reachable, and it is the branch
    // that would break a page deriving a name for itself.
    await page.goto(NO_EMAIL);

    await expect(page.getByText("Your account")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Profile", level: 1 })).toBeVisible();
  });
});

test.describe("the GitHub connection says which state it is in", () => {
  test("names the login and offers no connect action once connected", async ({ page }) => {
    await page.goto(CONNECTED);

    await expect(page.getByText("Connected", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: /connect github/i })).toHaveCount(0);
  });

  test("offers exactly one way forward when it is not connected", async ({ page }) => {
    await page.goto(NO_GITHUB);

    await expect(page.getByText("Not connected")).toBeVisible();
    await expect(page.getByRole("link", { name: /connect github/i })).toHaveCount(1);
  });
});

test.describe("what Vibe does not keep is true on the screen it is printed on", () => {
  test("credits the picture to GitHub only when a picture is shown", async ({ page }) => {
    await page.goto(CONNECTED);
    await expect(page.getByText(/served by GitHub/)).toBeVisible();
  });

  test("says there is no picture at all when the circle is initials", async ({ page }) => {
    // The regression: fixed text claiming a GitHub-served picture on a screen
    // that renders none.
    await page.goto(NO_GITHUB);

    await expect(page.getByText(/served by GitHub/)).toHaveCount(0);
    await expect(page.getByText(/No picture of any kind/)).toBeVisible();
  });

  /*
   * This asserted zero text fields, under the sentence "no field that would
   * need a store this product does not have". The product now has that store —
   * `founder_profiles`, asked for because Nova has to know what to call
   * somebody — so the claim inverts rather than disappears: exactly one field,
   * and it is the one with a table behind it.
   */
  test("offers exactly the one field the product has a column for", async ({ page }) => {
    await page.goto(CONNECTED);

    await expect(page.getByRole("textbox")).toHaveCount(1);
    await expect(page.getByTestId("founder-name-form").getByRole("textbox")).toBeVisible();
    await expect(page.getByRole("button", { name: /save/i })).toHaveCount(1);
  });
});

test.describe("it fits", () => {
  for (const width of [1440, 1024, 768, 390]) {
    test(`does not scroll sideways at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(CONNECTED);

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
});

/**
 * The name field, and the sentence that stops being true once it is filled.
 *
 * A form is exactly the kind of thing rule 69 names: the domain is tested, the
 * database contract is tested, and none of that says whether a founder can see
 * a box and a button. What the browser adds here is the *agreement* between
 * two places on one screen — the heading calls the person by the name they
 * gave, and the panel about what Vibe does not keep must stop claiming there
 * is no name.
 */
test.describe("the name a founder gave", () => {
  const NAMED = "/e2e/profile-named";

  test("offers a box to fill in, whatever is on file", async ({ page }) => {
    await page.goto(CONNECTED);

    const form = page.getByTestId("founder-name-form");
    await expect(form).toBeVisible();
    await expect(form.getByLabel(/what should nova call you/i)).toHaveValue("");
    await expect(form.getByRole("button", { name: /save/i })).toBeVisible();
  });

  test("says who uses it and what happens without one", async ({ page }) => {
    await page.goto(CONNECTED);

    await expect(page.getByText(/used when vibe writes to you/i)).toBeVisible();
    await expect(page.getByText(/github login or your email address/i)).toBeVisible();
  });

  test("shows the given name in the field and as the heading", async ({ page }) => {
    await page.goto(NAMED);

    await expect(page.getByTestId("founder-name-form").getByLabel(/call you/i)).toHaveValue("Tobi");
    await expect(page.getByRole("main").getByText("Tobi", { exact: true }).first()).toBeVisible();
  });

  /**
   * The chosen name outranks a connected GitHub login *as the identity*.
   *
   * Not as a claim that the login has vanished: the connections panel below
   * still names which GitHub account is attached, and it should — that is a
   * fact about a connection rather than about the person. What changes is who
   * the page says you are.
   */
  test("becomes the identity, while the connection still names the account", async ({ page }) => {
    await page.goto(NAMED);

    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText("Tobi", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("ada-lovelace").first()).toBeVisible();
  });

  /*
   * The panel about what Vibe does not keep may not contradict the page it is
   * printed on — the same defect its own docblock records, in a new place.
   * Two tests rather than one because a second `goto` in one test exceeds the
   * suite's deliberately short timeout: a first navigation here costs about
   * thirteen seconds against a fifteen-second budget.
   */
  test("says there is no name while there is none", async ({ page }) => {
    await page.goto(CONNECTED);

    await expect(page.getByText(/no name yet/i)).toBeVisible();
  });

  test("stops saying it once there is one", async ({ page }) => {
    await page.goto(NAMED);

    await expect(page.getByText(/no name yet/i)).toHaveCount(0);
    await expect(page.getByText(/beyond the name you gave/i)).toBeVisible();
  });
});

import { expect, test } from "@playwright/test";

/**
 * The account erasure control, in a real browser (ADR 0056 §4, §9).
 *
 * ## Why this is not covered by the source assertion
 *
 * `delete-account-ui.test.ts` proves what copy the component *can* render.
 * That is a different claim from "a person sees it before they press the
 * button", and for the one irreversible action in this product the second is
 * the one that matters. Three of these disclosures are decisions ADR 0056 made
 * and recorded as copy obligations; a confirmation that rendered them behind a
 * collapsed section, or after the confirm button, would satisfy the source test
 * and fail the person.
 *
 * ## Why the running state gets its own test
 *
 * Because it fails quietly. A screen deriving its state from "is one running"
 * with the wrong status set would show an inviting Delete button beside an
 * erasure already under way, and nothing about that looks broken.
 */

/**
 * Everything is scoped to the section. Next injects a `role="alert"` route
 * announcer into every page, so an unscoped `getByRole("alert")` matches on a
 * screen that is showing nothing of the kind.
 */
const SECTION = "delete-account";

const IDLE = "/e2e/account-erasure-idle";
const RUNNING = "/e2e/account-erasure-running";
const FAILED = "/e2e/account-erasure-failed";

test.describe("before anything is pressed", () => {
  test("offers the control and says nothing has happened yet", async ({ page }) => {
    await page.goto(IDLE);

    const section = page.getByTestId(SECTION);
    await expect(section.getByRole("button", { name: /delete account/i })).toBeVisible();
    await expect(section.getByRole("alert")).toHaveCount(0);
  });

  test("does not disclose the consequences until the control is pressed", async ({ page }) => {
    // The section says what the control does; the confirmation says what it
    // costs. A person browsing settings has not asked for the second yet.
    await page.goto(IDLE);

    await expect(page.getByText(/cannot be undone/i)).toHaveCount(0);
    await expect(page.getByText(/not refunded/i)).toHaveCount(0);
    await expect(page.getByRole("button", { name: /erase account/i })).toHaveCount(0);
  });
});

test.describe("the confirmation states every consequence", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(IDLE);
    await page.getByRole("button", { name: /delete account/i }).click();
  });

  test("says it cannot be undone", async ({ page }) => {
    await expect(page.getByText(/cannot be undone/i)).toBeVisible();
  });

  test("says the GitHub App is not uninstalled", async ({ page }) => {
    await expect(page.getByText(/does not uninstall/i)).toBeVisible();
  });

  test("says the remaining paid period is not refunded", async ({ page }) => {
    await expect(page.getByText(/not refunded/i)).toBeVisible();
  });

  test("says the billing history survives without the person's name", async ({ page }) => {
    // The disclosure most easily lost, because it contradicts the word delete.
    await expect(page.getByText(/kept without your name/i)).toBeVisible();
  });

  test("puts every consequence above the confirm button", async ({ page }) => {
    // A disclosure a person scrolls past after deciding is not a disclosure.
    const confirm = page.getByRole("button", { name: /erase account/i });
    const lastSentence = page.getByText(/cannot be undone/i);

    const confirmBox = await confirm.boundingBox();
    const sentenceBox = await lastSentence.boundingBox();

    expect(sentenceBox?.y ?? 0).toBeLessThan(confirmBox?.y ?? 0);
  });

  test("can be backed out of", async ({ page }) => {
    await page.getByRole("button", { name: /cancel/i }).click();

    await expect(page.getByRole("button", { name: /delete account/i })).toBeVisible();
    await expect(page.getByText(/cannot be undone/i)).toHaveCount(0);
  });
});

test.describe("while an erasure is under way", () => {
  test("shows no button to press", async ({ page }) => {
    await page.goto(RUNNING);

    await expect(page.getByRole("button", { name: /delete account/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /erase account/i })).toHaveCount(0);
  });

  test("says what is happening and what will happen to the session", async ({ page }) => {
    await page.goto(RUNNING);

    await expect(page.getByRole("status")).toContainText(/being erased/i);
    await expect(page.getByRole("status")).toContainText(/signed out/i);
  });
});

test.describe("after one failed", () => {
  test("says why, and that nothing was erased", async ({ page }) => {
    await page.goto(FAILED);

    const alert = page.getByTestId(SECTION).getByRole("alert");
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(/nothing was erased/i);
  });

  test("still offers the control, because a failed erasure can be retried", async ({ page }) => {
    await page.goto(FAILED);

    await expect(page.getByRole("button", { name: /delete account/i })).toBeVisible();
  });
});

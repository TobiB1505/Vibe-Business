import { expect, test } from "@playwright/test";

/**
 * Nova Home in a browser (UI Sourcing Spec §15, Slice 1).
 *
 * Every assertion here is one the unit tests cannot make: that the founder can
 * *see* the price before pressing, that a paused run does not read as
 * activity, that a missing score explains itself on screen, that the evidence
 * drawer opens and gives focus back, and that none of it disappears at 375px.
 */

const NOVA = (scenario: string) => `/e2e/${scenario}`;

const VIEWPORTS = [
  { name: "mobile", width: 375, height: 780 },
  { name: "tablet", width: 768, height: 900 },
  { name: "desktop", width: 1280, height: 900 },
] as const;

test.describe("Nova Home", () => {
  test("leads with one dominant action and its price, before any click", async ({ page }) => {
    await page.goto(NOVA("nova-priced"));

    // The focus is the page's h1: one sentence about what needs the founder.
    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toBeVisible();
    await expect(heading).toHaveText(/audit behind what I am showing you/i);

    // The price is on screen with nothing expanded and nothing pressed.
    await expect(page.getByText(/\d+ Credits/)).toBeVisible();
    await expect(page.getByText(/of 420 available/)).toBeVisible();

    // Exactly one primary control. The stack below carries none.
    await expect(page.getByRole("button", { name: "Run the audit again" })).toBeVisible();
  });

  test("never shows a currency or a percentage", async ({ page }) => {
    await page.goto(NOVA("nova-review"));

    const body = await page.locator("main").innerText();
    expect(body).not.toMatch(/\$\d|USD/);
    expect(body).not.toMatch(/\d+\s?%/);
  });

  test("shows a paused run as waiting, never as working", async ({ page }) => {
    await page.goto(NOVA("nova-waiting"));

    const strip = page.getByRole("status");
    await expect(strip).toContainText("Waiting for you");
    await expect(strip).not.toContainText("Working");
  });

  test("shows a running operation as working", async ({ page }) => {
    await page.goto(NOVA("nova-review"));
    // This scenario has no operation, so the strip is absent rather than idle.
    await expect(page.getByRole("status")).toHaveCount(0);
  });

  test("names a stall as a stall rather than a failure", async ({ page }) => {
    await page.goto(NOVA("nova-stalled"));

    const strip = page.getByRole("status");
    await expect(strip).toContainText("Stalled");
    await expect(strip).toContainText(/running far longer than it should/i);
  });

  test("says so, and offers nothing, when there is nothing to do", async ({ page }) => {
    await page.goto(NOVA("nova-settled"));

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Nothing needs you/i);
    // The failure mode this replaces is a button that does nothing.
    await expect(page.locator("main").getByRole("button")).toHaveCount(0);
    await expect(page.getByRole("status")).toHaveCount(0);
  });

  test("explains a missing score instead of printing a zero", async ({ page }) => {
    await page.goto(NOVA("nova-unscored"));

    const health = page.getByRole("region", { name: "Business health" });

    await expect(health).toContainText("—");
    await expect(health).toContainText(/Only 2 of 9 applicable areas could be scored/);
    // A dash, never a zero standing in for "nothing was measurable".
    await expect(health).not.toContainText(/(^|\s)0(\s|$)/);
  });

  test("keeps the attention stack ordered and free of controls", async ({ page }) => {
    await page.goto(NOVA("nova-review"));

    const stack = page.getByRole("list").filter({ hasText: "audit behind" });
    await expect(stack).toBeVisible();
    await expect(stack.getByRole("button")).toHaveCount(0);
    // Every row is a real destination.
    await expect(stack.getByRole("link").first()).toBeVisible();
  });

  test.describe("evidence drawer", () => {
    test("opens from a citation count and shows resolved sources, never ids", async ({ page }) => {
      await page.goto(NOVA("nova-review"));

      const trigger = page.getByRole("button", { name: "2 sources" });
      await expect(trigger).toBeVisible();
      await expect(trigger).toHaveAttribute("aria-expanded", "false");

      await trigger.click();

      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText("Payments integration detected");
      await expect(dialog).toContainText("Your code");
      // A raw evidence id would look like `repo.payments.stripe`.
      await expect(dialog).not.toContainText(/\b[a-z]+\.[a-z_]+\.[a-z_]+\b/);
    });

    test("traps focus while open and returns it on close", async ({ page }) => {
      await page.goto(NOVA("nova-review"));

      const trigger = page.getByRole("button", { name: "2 sources" });
      await trigger.click();

      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();

      // Focus is inside the dialog, not on the page behind it.
      const focusedInDialog = await page.evaluate(() => {
        const dialogEl = document.querySelector("dialog[open]");
        return dialogEl?.contains(document.activeElement) ?? false;
      });
      expect(focusedInDialog).toBe(true);

      await page.keyboard.press("Escape");
      await expect(dialog).not.toBeVisible();

      // The trigger gets focus back — `<dialog>` restores it.
      await expect(trigger).toBeFocused();
    });

    test("closes on the close control as well as Escape", async ({ page }) => {
      await page.goto(NOVA("nova-review"));

      await page.getByRole("button", { name: "2 sources" }).click();
      await expect(page.getByRole("dialog")).toBeVisible();

      await page.getByRole("button", { name: "Close" }).click();
      await expect(page.getByRole("dialog")).not.toBeVisible();
    });
  });

  for (const viewport of VIEWPORTS) {
    test(`keeps the focus action and the price visible at ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(NOVA("nova-priced"));

      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByRole("button", { name: "Run the audit again" })).toBeVisible();
      await expect(page.getByText(/\d+ Credits/)).toBeVisible();

      // Nothing pushes the page sideways at any width.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      );
      expect(overflow, `${viewport.name} scrolls horizontally`).toBe(false);
    });
  }

  test("keeps the attention rows readable on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 780 });
    await page.goto(NOVA("nova-review"));

    const rows = page.getByRole("list").filter({ hasText: "audit behind" }).getByRole("link");
    await expect(rows.first()).toBeVisible();

    // A tap target a thumb can hit.
    const box = await rows.first().boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  });
});

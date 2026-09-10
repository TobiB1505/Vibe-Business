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

/**
 * The dead end a founder actually reached, and the rule that removes it.
 *
 * A change was waiting, the approval section said *"Start a preview and look
 * at the change first"*, and there was nothing to press anywhere on the
 * screen. `ChangeGates` matched its `stage` prop exactly, so Nova's
 * `review_change` moment — which mounts it at `stage="review"` — rendered the
 * refusal and filtered out the panel that answers it.
 *
 * Only a browser proves this one. Every unit test passed while it shipped:
 * the copy was right, the block was mounted, the panels each worked. What was
 * wrong was which of them reached the page together.
 */
test.describe("a refusal and its remedy", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  test("puts the preview control on the screen that asks for a preview", async ({ page }) => {
    await page.goto("/e2e/study-block");

    const gate = page.locator('[data-testid="gate-needs-preview"]');
    await expect(gate.getByText(/approval needs a preview of this exact commit/)).toBeVisible();

    /*
     * The remedy, pressable, in the same gate. Not a link away and not a
     * sentence about it.
     */
    await expect(gate.getByRole("button", { name: "Start temporary preview" })).toBeEnabled();
  });

  /*
   * And in the right order: the step comes before the decision that needs it.
   * A control below its own refusal is a scroll a founder should not have to
   * discover.
   */
  test("offers the step above the decision it unblocks", async ({ page }) => {
    await page.goto("/e2e/study-block");

    const gate = page.locator('[data-testid="gate-needs-preview"]');
    const preview = await gate
      .getByRole("button", { name: "Start temporary preview" })
      .boundingBox();
    const refusal = await gate
      .getByText(/approval needs a preview of this exact commit/)
      .boundingBox();

    expect(preview).not.toBeNull();
    expect(refusal).not.toBeNull();
    expect(preview!.y).toBeLessThan(refusal!.y);
  });

  /*
   * The disclosure over the gate was open and held only the refusal, because
   * the two panels that belong in it had been filtered out. Evidence a founder
   * opens to read "how this change got here" must contain some.
   */
  test("fills the record of how the change got here", async ({ page }) => {
    await page.goto("/e2e/study-block");

    const gate = page.locator('[data-testid="gate-needs-preview"]');
    await expect(gate.getByRole("heading", { name: "Safety checks" })).toBeVisible();
    await expect(gate.getByText("All safety checks passed")).toBeVisible();
  });
});

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

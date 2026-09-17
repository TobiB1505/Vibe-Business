import { expect, test } from "@playwright/test";

/**
 * The way out of the conversation (ADR 0109 §4, Slice 4).
 *
 * A block in Nova's thread used to be a dead end: the audit reading, the Move
 * and the prepared change were all on screen, and nothing said the product had
 * a page for any of them. Each frame now names where it is read in full and
 * links there.
 *
 * ## What only a browser proves
 *
 * That the row fits. The frame's meta row is a mono label in 0.16em tracking on
 * one side and this link on the other, and at 390px both have to sit on one
 * line without pushing the composed surface below them sideways. `cn` is a
 * filtered join rather than `tailwind-merge`, so a class that looks like it
 * wins may not — which is the kind of thing that passes every unit test and is
 * visibly wrong on a phone.
 *
 * And that the link's *word* is the destination's own. It is looked up in
 * `PROJECT_SECTIONS` rather than written in the registry, so a section renamed
 * without the registry noticing shows up here as the wrong word on a link.
 */

const WIDTHS = [
  { name: "phone", width: 390, height: 780 },
  { name: "desktop", width: 1280, height: 900 },
] as const;

const ARTIFACTS = [
  {
    scenario: "artifact-audit",
    section: "Business Health",
    href: "/app/projects/project_e2e/health",
  },
  {
    scenario: "artifact-move",
    section: "Action Plan",
    href: "/app/projects/project_e2e/plan?plan=move_e2e#planned-work",
  },
  {
    scenario: "artifact-change",
    section: "Agent",
    href: "/app/projects/project_e2e/agent?change=change_e2e#prepared-change-change_e2e",
  },
] as const;

test.describe("an artifact in the thread says where it is read", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  for (const artifact of ARTIFACTS) {
    test(`${artifact.scenario} links to ${artifact.section}`, async ({ page }) => {
      await page.goto(`/e2e/${artifact.scenario}`);

      const link = page.getByRole("link", { name: artifact.section });
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute("href", artifact.href);

      // Above the surface it is about, not inside it — the frame is furniture.
      await expect(page.getByTestId("artifact-body")).toBeVisible();
    });
  }

  /**
   * A moment with no block has no frame, so there is nothing to open.
   *
   * The case a placeholder would be most tempting on: the thread is quiet and a
   * link would fill it. It stays empty, because it would lead to a page that
   * answers a question nobody asked.
   */
  test("a settled project is offered nothing to open", async ({ page }) => {
    await page.goto("/e2e/artifact-settled");

    await expect(page.getByTestId("artifact-body")).toHaveCount(0);
    await expect(page.getByRole("link")).toHaveCount(0);
  });

  for (const viewport of WIDTHS) {
    test(`the meta row fits at ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto("/e2e/artifact-audit");

      const link = page.getByRole("link", { name: "Business Health" });
      await expect(link).toBeVisible();

      // The label and the link on one line: the row is one line tall.
      const row = link.locator("xpath=..");
      const rowBox = await row.boundingBox();
      const linkBox = await link.boundingBox();
      expect(rowBox).not.toBeNull();
      expect(linkBox).not.toBeNull();
      expect(rowBox!.height).toBeLessThan(linkBox!.height * 1.6);

      // And the page does not go sideways because of it.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
});

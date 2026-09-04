import { expect, test } from "@playwright/test";

/**
 * "Vibe's read of your code is out of date" — in a real browser (Stufe 4).
 *
 * ## Why this suite exists
 *
 * This is the one refusal that renders **no start control**. The step does not
 * resolve agentic, so `AgentReadyStage` receives no `startAction` and draws an
 * empty call-to-action block under a hero still saying Vibe understands this
 * founder's code. Every unit test around it passed while that was true, because
 * what was wrong was a screen with nothing on it — and only a rendered DOM can
 * say whether a founder is told what to do next.
 *
 * The `ANALYZER_VERSION` bump to v5 makes this the first thing every existing
 * project sees, which is why it earns a browser test rather than a comment.
 */

test.describe("a repository Vibe last read under an older analysis", () => {
  test("says so, and points at the scan that fixes it", async ({ page }) => {
    await page.goto("/e2e/agent-stale-read");

    const notice = page.getByTestId("agent-stale-read");
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("predates this check");

    // Built by `projectSectionHref`, in the fixture as on the real page — so
    // the segment is `product` rather than the section id, and this assertion
    // fails if the canonical href ever moves. A literal typed here would have
    // gone on passing against a route that no longer exists.
    const scan = page.getByTestId("agent-stale-read-scan");
    await expect(scan).toHaveAttribute("href", /\/product#product-scan$/);
  });

  test("says the founder starts it, and that it is free", async ({ page }) => {
    // Both halves matter. "You have to do this" without "it costs nothing"
    // reads like a bill, and a founder who reads a bill does not click.
    await page.goto("/e2e/agent-stale-read");

    const notice = page.getByTestId("agent-stale-read");
    await expect(notice).toContainText("never re-reads your code on its own");
    await expect(notice).toContainText("free");
  });

  test("offers nothing that starts work from here", async ({ page }) => {
    // The way forward is a link to another screen, deliberately: a control on
    // this one would be Vibe re-reading a founder's code a click after telling
    // them it never does that (rule 60).
    await page.goto("/e2e/agent-stale-read");

    await expect(page.getByTestId("agent-stale-read").locator("button")).toHaveCount(0);
    await expect(page.locator("form")).toHaveCount(0);
  });

  test("does not scroll sideways at 375px", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/e2e/agent-stale-read");
    await expect(page.getByTestId("agent-stale-read")).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

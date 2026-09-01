import { expect, test } from "@playwright/test";

/**
 * The Agent screen does not wait for GitHub to show anything (VB-023).
 *
 * ## Why this is a browser test and not a unit test
 *
 * Because the claim is about *when bytes reach a client*, and nothing about a
 * server component's source proves that. A `<Suspense>` boundary written
 * correctly and a `<Suspense>` boundary whose child is awaited one line too
 * early produce identical-looking code and completely different pages, and the
 * second is only visible to something that watches the response arrive.
 *
 * ## What it proves, and what it does not
 *
 * The fixture reproduces the route's render shape — the agent panel from cheap
 * reads, then the prepared changes behind the boundary — with an artificial
 * delay standing in for the merge preflight. So this proves the composition
 * streams: the panel and the loading state are painted while the slow half is
 * still resolving.
 *
 * It does not prove the real route puts its reads on the right side of the
 * boundary. That route needs a signed-in session against a real Supabase
 * project, which the browser suite deliberately does not have; the structural
 * assertion in `workspace-routes.test.ts` is what covers it.
 */

const STREAMING = "/e2e/agent-streaming";

test.describe("the agent panel arrives before the prepared changes", () => {
  test("paints the panel and a loading state while the slow half is still resolving", async ({
    page,
  }) => {
    // `commit` returns as soon as the response starts, so what follows sees the
    // first flush rather than the finished document.
    await page.goto(STREAMING, { waitUntil: "commit" });
    await expect(page.getByRole("status", { name: "Loading" })).toBeVisible();

    /*
     * One synchronous snapshot, taken while the boundary is still pending.
     *
     * Playwright's own matchers each auto-wait, so three of them in a row
     * would happily satisfy themselves at three different moments — including
     * after the slow half landed, which would make this pass against a page
     * that never streamed at all. Reading the DOM once answers all three
     * questions about the same instant.
     */
    const firstFlush = await page.evaluate(() => ({
      headline: document.querySelector("h3")?.textContent ?? null,
      loading: document.querySelectorAll('[role="status"][aria-label="Loading"]').length,
      changes: document.querySelectorAll('[data-testid="prepared-change"]').length,
    }));

    expect(firstFlush.headline).toBe("Ready");
    expect(firstFlush.loading).toBe(1);
    expect(firstFlush.changes).toBe(0);
  });

  test("replaces the loading state with the changes when they resolve", async ({ page }) => {
    await page.goto(STREAMING);

    await expect(page.getByTestId("prepared-change")).toBeVisible();
    await expect(page.getByRole("status", { name: "Loading" })).toHaveCount(0);

    // The panel written in the first flush is still there, not re-rendered away.
    await expect(page.getByRole("heading", { level: 3 })).toBeVisible();
  });
});

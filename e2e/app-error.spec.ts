import { expect, test } from "@playwright/test";

/**
 * The signed-in error boundary, in a real browser.
 *
 * ## What this is protecting against
 *
 * A founder signed in and got this, on a black page, with nothing else on it:
 *
 * ```
 * Application error: a client-side exception has occurred
 * (see the browser console for more information).
 * ```
 *
 * The trigger was a `JWT issued at future` — a clock skew between Supabase Auth
 * and PostgREST that appeared one second after login and had cleared two
 * seconds later. The product had no error boundary under `/app` at all, so a
 * transient read failure became a dead end: no header, no retry, no navigation,
 * and an instruction to open the browser console.
 *
 * Every assertion below is about that screen not being a dead end. None of them
 * can be made anywhere but in a browser — "the component returns a button" says
 * nothing about whether a person can reach it, and the failure being replaced
 * was entirely about what a person could see and do.
 */

const WITH_DIGEST = "/e2e/app-error";
const WITHOUT_DIGEST = "/e2e/app-error-no-digest";

test.describe("a founder is not stranded", () => {
  test("offers a retry as a real, keyboard-reachable button", async ({ page }) => {
    await page.goto(WITH_DIGEST);

    const retry = page.getByRole("button", { name: /try again/i });
    await expect(retry).toBeVisible();
    await expect(retry).toBeEnabled();

    await retry.focus();
    await expect(retry).toBeFocused();
  });

  test("offers a way back that actually navigates", async ({ page }) => {
    await page.goto(WITH_DIGEST);

    await expect(page.getByRole("link", { name: /back to your projects/i })).toHaveAttribute(
      "href",
      "/app",
    );
  });

  test("still looks like Vibe rather than like a crashed server", async ({ page }) => {
    await page.goto(WITH_DIGEST);

    await expect(page.getByText("Vibe Business").first()).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/couldn.t load this page/i);
  });

  /** The sentence the screenshot showed. It must not come back. */
  test("never tells anyone to open the browser console", async ({ page }) => {
    await page.goto(WITH_DIGEST);

    await expect(page.getByText(/browser console/i)).toHaveCount(0);
    await expect(page.getByText(/application error/i)).toHaveCount(0);
  });
});

test.describe("what it says and does not say", () => {
  /**
   * A raw PostgREST payload is not a sentence anyone outside this codebase
   * should read, and it names tables and columns. The digest is the useful
   * half, and it is the half that is shown.
   */
  test("shows no raw database error", async ({ page }) => {
    await page.goto(WITH_DIGEST);

    const body = await page.locator("body").innerText();
    expect(body).not.toContain("PGRST303");
    expect(body).not.toContain("JWT issued at future");
    expect(body).not.toContain('{"code"');
  });

  test("shows the reference that ties this screen to the server log", async ({ page }) => {
    await page.goto(WITH_DIGEST);

    await expect(page.getByText("1813753987@E394")).toBeVisible();
  });

  /**
   * No digest is a real state — a client-side throw carries none. The screen
   * must not render a dangling "this reference identifies what failed:" with
   * nothing after it.
   */
  test("says nothing about a reference when there is none", async ({ page }) => {
    await page.goto(WITHOUT_DIGEST);

    await expect(page.getByRole("button", { name: /try again/i })).toBeVisible();
    await expect(page.getByText(/reference identifies/i)).toHaveCount(0);
  });

  /**
   * The one claim about state. It is safe to make: a Server Component read
   * threw, so nothing was written — and a founder looking at a broken screen
   * needs to know that before anything else.
   */
  test("says the founder's work is safe, without promising a fix", async ({ page }) => {
    await page.goto(WITH_DIGEST);

    await expect(page.getByText(/your work is safe/i)).toBeVisible();
    // Never "temporary" or "we're on it" — we do not know either.
    await expect(page.getByText(/we.re (on it|working on)/i)).toHaveCount(0);
  });
});

test.describe("375px", () => {
  test("does not scroll sideways on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 780 });
    await page.goto(WITH_DIGEST);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("keeps both controls reachable without scrolling sideways", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 780 });
    await page.goto(WITH_DIGEST);

    await expect(page.getByRole("button", { name: /try again/i })).toBeInViewport();
    await expect(page.getByRole("link", { name: /back to your projects/i })).toBeInViewport();
  });
});

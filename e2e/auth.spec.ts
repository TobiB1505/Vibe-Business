import { expect, test, type Page } from "@playwright/test";

/**
 * The auth screens, in a real browser, against a production build.
 *
 * ## What this suite proves, and what it cannot
 *
 * The Playwright web server points at a Supabase project that does not exist
 * (see playwright.config.ts). Every call to Supabase therefore fails at DNS,
 * which makes the entire *signed-out* half of authentication exercisable and
 * perfectly deterministic: guards, redirects, `next` handling, error states,
 * disabled controls, the lot.
 *
 * It cannot prove anything that needs a real session. A successful sign-in,
 * session survival across a browser restart, automatic identity linking, and
 * the neutral password-reset confirmation are all outside what this file
 * sees. Those are unit-tested where they can be, and otherwise require
 * dogfooding against a real project — which has not happened for this sprint.
 * Nothing here should be read as evidence that Google sign-in works.
 */

/**
 * Wait for React to take a progressively-enhanced form over before clicking it.
 *
 * The three tests below assert a *pending* state: a click flips a
 * `useActionState` transition and the control disables itself. That is only
 * true once React has hydrated. Before it, the same click is a native form
 * POST — the browser leaves the page, and the assertion fails with "waiting
 * for navigation to finish" against a control that no longer exists.
 *
 * That race was being lost intermittently, in whichever of these three tests
 * happened to run first on a cold worker. The route hold in the Google test
 * removed a *different* race (the hand-off completing before the assertions
 * ran) and could never address this one, because this one happens before any
 * request is made.
 *
 * React internals are read deliberately: nothing on these pages changes
 * visibly on hydration, so there is no product-level marker to wait for
 * instead — and inventing one would mean changing shipped code to suit a test.
 *
 * What is read is the **form**, not the button, and that is the whole fix.
 * A fiber on the button says React reached that node; it does not say React
 * has taken the submission over, because the interception lives on the
 * `<form>`. Waiting on the button left a window in which the button was
 * hydrated and the form was not, and a click in that window still left the
 * page — which is how this helper went on failing the race it was written to
 * win, at roughly one run in four under two workers.
 *
 * The signal is precise rather than approximate: an unhydrated form carries a
 * string `action` attribute, and a hydrated server-action form carries a
 * *function* in its React props. A function there means the next click is
 * React's, not the browser's.
 */
async function waitForHydration(page: Page, testId: string): Promise<void> {
  await page.waitForFunction((id) => {
    const form = document.querySelector(`[data-testid="${id}"]`)?.closest("form");
    if (!form) return false;

    const key = Object.keys(form).find((candidate) => candidate.startsWith("__reactProps$"));
    if (!key) return false;

    return typeof (form as unknown as Record<string, { action?: unknown }>)[key].action ===
      "function";
  }, testId);
}

/**
 * Hold the login screen's server action open, so a pending state can be read.
 *
 * ## Why the submission and not the network behind it
 *
 * Both tests below assert "one submission disables both routes in", which is
 * true exactly while a submission is in flight. Left to run, that window is
 * however long an unreachable Supabase takes to fail — long enough most of the
 * time, and not long enough often enough to be a flake.
 *
 * An earlier version held the Supabase URL instead, which stops the browser
 * leaving but leaves a *navigation pending* — and a pending navigation is
 * precisely the state in which Playwright cannot resolve a locator. The first
 * assertion won the race to run before the redirect was issued and the second
 * waited out its timeout against a document on its way somewhere: received
 * undefined, on a button that was on the screen the whole time.
 *
 * Holding the POST holds the state under test directly. Nothing navigates,
 * both locators resolve, and the window stays open until the context closes.
 */
async function holdSubmission(page: Page): Promise<void> {
  await page.route("**/login", async (route) => {
    // Only the submission. The document and its RSC reads must go through, or
    // the screen under test never renders.
    if (route.request().method() === "POST") return;
    await route.continue();
  });
}

test.describe("the login screen at rest", () => {
  test("offers both ways in, with nothing disabled", async ({ page }) => {
    await page.goto("/login");

    const google = page.getByTestId("google-signin");
    const email = page.getByTestId("email-signin");

    await expect(google).toBeVisible();
    await expect(google).toHaveText("Continue with Google");
    await expect(google).toBeEnabled();

    await expect(email).toBeVisible();
    await expect(email).toBeEnabled();

    await expect(page.getByLabel("Email address")).toBeEnabled();
    await expect(page.getByLabel("Password")).toBeEnabled();
    await expect(page.getByRole("link", { name: "Forgot password?" })).toBeVisible();
  });

  test("shows no error before anything has been attempted", async ({ page }) => {
    await page.goto("/login");

    await expect(page.getByText("Invalid email or password.")).toHaveCount(0);
    await expect(page.getByText("Google sign-in was cancelled.")).toHaveCount(0);
  });
});

test.describe("submitting the email form", () => {
  test("disables both routes in while the submission is in flight", async ({ page }) => {
    await page.goto("/login");

    await holdSubmission(page);

    await page.getByLabel("Email address").fill("user@example.com");
    await page.getByLabel("Password").fill("hunter22");
    await waitForHydration(page, "email-signin");
    await page.getByTestId("email-signin").click();

    // The point of the assertion: while one route in is submitting, a second
    // click must not be able to post the credentials again.
    await expect(page.getByTestId("email-signin")).toBeDisabled();
    await expect(page.getByTestId("google-signin")).toBeDisabled();
  });

  test("reports an unreachable server in words a person can act on", async ({ page }) => {
    await page.goto("/login");

    await page.getByLabel("Email address").fill("user@example.com");
    await page.getByLabel("Password").fill("hunter22");
    await page.getByTestId("email-signin").click();

    await expect(
      page.getByText("We couldn't reach the server. Please try again."),
    ).toBeVisible({ timeout: 12_000 });

    // Never the provider's own wording.
    await expect(page.getByText(/AuthRetryableFetchError|ENOTFOUND|fetch failed/)).toHaveCount(0);
  });

  test("re-enables the form after a failure so the visitor can retry", async ({ page }) => {
    await page.goto("/login");

    await page.getByLabel("Email address").fill("user@example.com");
    await page.getByLabel("Password").fill("hunter22");
    await page.getByTestId("email-signin").click();

    await expect(
      page.getByText("We couldn't reach the server. Please try again."),
    ).toBeVisible({ timeout: 12_000 });

    await expect(page.getByTestId("email-signin")).toBeEnabled();
    await expect(page.getByTestId("google-signin")).toBeEnabled();
  });
});

test.describe("starting Google sign-in", () => {
  test("disables both routes in while handing off", async ({ page }) => {
    await page.goto("/login");

    await holdSubmission(page);

    await waitForHydration(page, "google-signin");

    await page.getByTestId("google-signin").click();

    await expect(page.getByTestId("google-signin")).toBeDisabled();
    await expect(page.getByTestId("email-signin")).toBeDisabled();
  });

  /**
   * `signInWithOAuth` builds the authorize URL locally — no network call —
   * so this works against a project that does not exist, and it is the only
   * place the real PKCE parameters can be observed end to end.
   *
   * It still proves nothing about Google itself. What it proves is that the
   * hand-off Vibe constructs is the right one.
   */
  test("hands off to Supabase with PKCE and our own callback as the return leg", async ({
    page,
  }) => {
    await page.goto("/login");

    // The placeholder host does not resolve; aborting keeps the test from
    // waiting out a DNS failure.
    await page.route("**e2e-placeholder.supabase.co/**", (route) => route.abort());

    const [request] = await Promise.all([
      page.waitForRequest(/e2e-placeholder\.supabase\.co\/auth\/v1\/authorize/),
      page.getByTestId("google-signin").click(),
    ]);

    const url = new URL(request.url());
    expect(url.searchParams.get("provider")).toBe("google");

    // PKCE is active: a code challenge was generated and sent.
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
    expect(url.searchParams.get("code_challenge_method")).toBe("s256");

    // The return leg is *our* callback, not Google's and not Supabase's.
    const returnTo = new URL(url.searchParams.get("redirect_to") as string);
    expect(returnTo.pathname).toBe("/auth/callback");
    expect(returnTo.searchParams.get("next")).toBe("/app");
  });

  test("carries the originally requested page through the hand-off", async ({ page }) => {
    await page.goto("/login?next=%2Fapp%2Faction-plan%2F123");
    await page.route("**e2e-placeholder.supabase.co/**", (route) => route.abort());

    const [request] = await Promise.all([
      page.waitForRequest(/e2e-placeholder\.supabase\.co\/auth\/v1\/authorize/),
      page.getByTestId("google-signin").click(),
    ]);

    const returnTo = new URL(
      new URL(request.url()).searchParams.get("redirect_to") as string,
    );
    expect(returnTo.searchParams.get("next")).toBe("/app/action-plan/123");
  });

  test("refuses to carry a hostile destination to the provider", async ({ page }) => {
    await page.goto("/login?next=https%3A%2F%2Fevil.com");
    await page.route("**e2e-placeholder.supabase.co/**", (route) => route.abort());

    const [request] = await Promise.all([
      page.waitForRequest(/e2e-placeholder\.supabase\.co\/auth\/v1\/authorize/),
      page.getByTestId("google-signin").click(),
    ]);

    const redirectTo = new URL(request.url()).searchParams.get("redirect_to") as string;
    expect(redirectTo).not.toContain("evil.com");
    expect(new URL(redirectTo).searchParams.get("next")).toBe("/app");
  });
});

test.describe("failures carried back from the OAuth callback", () => {
  test("a cancelled consent screen reads as cancellation", async ({ page }) => {
    await page.goto("/auth/callback?error=access_denied");

    await expect(page).toHaveURL(/\/login\?error=oauth_cancelled/);
    await expect(page.getByText("Google sign-in was cancelled.")).toBeVisible();
  });

  test("a provider outage reads as something to retry", async ({ page }) => {
    await page.goto("/auth/callback?error=server_error");

    await expect(
      page.getByText("We couldn't sign you in with Google. Please try again."),
    ).toBeVisible();
  });

  test("a callback with nothing in it does not crash the screen", async ({ page }) => {
    await page.goto("/auth/callback");

    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByTestId("email-signin")).toBeVisible();
  });

  test("a tampered error parameter cannot put text on the page", async ({ page }) => {
    await page.goto("/login?error=Your%20account%20was%20suspended%2C%20call%200800");

    await expect(page.getByText("call 0800")).toHaveCount(0);
    await expect(page.getByText("We couldn't sign you in. Please try again.")).toBeVisible();
  });
});

test.describe("the guard on /app", () => {
  test("turns a signed-out visitor away", async ({ page }) => {
    await page.goto("/app");

    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByTestId("email-signin")).toBeVisible();
  });

  test("remembers where they were going", async ({ page }) => {
    await page.goto("/app/action-plan/123");

    await expect(page).toHaveURL("/login?next=%2Fapp%2Faction-plan%2F123");
    await expect(page.locator('input[name="next"]').first()).toHaveValue(
      "/app/action-plan/123",
    );
  });

  test("never shows a frame of the protected page first", async ({ page }) => {
    const response = await page.goto("/app/projects/1");

    // The redirect happens in the proxy, so the protected route is never
    // rendered and its markup never reaches the browser at all.
    expect(response?.url()).toContain("/login");
    await expect(page.locator("body")).not.toContainText("Attention");
  });

  test("refuses to carry a hostile destination into the form", async ({ page }) => {
    await page.goto("/login?next=https%3A%2F%2Fevil.com");

    await expect(page.locator('input[name="next"]').first()).toHaveValue("/app");
  });
});

test.describe("password recovery", () => {
  test("offers a way to ask for a link", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("link", { name: "Forgot password?" }).click();

    await expect(page).toHaveURL("/forgot-password");
    await expect(page.getByTestId("send-reset-link")).toBeEnabled();
  });

  test("disables the button while sending, so it cannot be double-submitted", async ({
    page,
  }) => {
    await page.goto("/forgot-password");

    /*
     * Hold the request open, the same way the Google hand-off test does and
     * for the same reason: the assertion below is only true *while* the
     * submission is in flight.
     *
     * Supabase is unreachable here, so the request fails at DNS — and a DNS
     * failure is not reliably slow. When it resolved quickly the pending
     * window closed before the assertion ran, the button was enabled again,
     * and the test failed claiming a control that cannot be double-submitted
     * can be. Roughly one run in ten.
     */
    await page.route("**e2e-placeholder.supabase.co/**", () => {
      // Deliberately never settled.
    });

    await page.getByLabel("Email address").fill("user@example.com");
    await waitForHydration(page, "send-reset-link");
    await page.getByTestId("send-reset-link").click();

    await expect(page.getByTestId("send-reset-link")).toBeDisabled();
  });

  test("an expired reset link lands somewhere that can issue a new one", async ({ page }) => {
    await page.goto("/auth/confirm?token_hash=expired&type=recovery");

    await expect(page).toHaveURL(/\/forgot-password\?error=expired_link/);
    await expect(
      page.getByText("That reset link has expired or was already used. Request a new one."),
    ).toBeVisible();
  });

  test("the set-a-password screen refuses without a recovery session", async ({ page }) => {
    await page.goto("/reset-password");

    await expect(page).toHaveURL(/\/forgot-password\?error=expired_link/);
  });
});

test.describe("email confirmation links", () => {
  test("an invalid signup link explains itself on the login screen", async ({ page }) => {
    await page.goto("/auth/confirm?token_hash=nope&type=signup");

    await expect(page).toHaveURL(/\/login\?error=expired_link/);
    await expect(
      page.getByText("That link has expired or was already used. Request a new one."),
    ).toBeVisible();
  });

  test("a one-time token never survives into the address bar", async ({ page }) => {
    await page.goto("/auth/confirm?token_hash=SECRET-TOKEN&type=signup");

    expect(page.url()).not.toContain("SECRET-TOKEN");
  });
});

test.describe("public pages stay public", () => {
  test("the marketing page does not require a session", async ({ page }) => {
    await page.goto("/");
    // Scoped to main because the header carries its own "Get started", and to
    // the first match because UI-S1 gave the page a closing call to action as
    // well. What is being asserted is that an unauthenticated visitor reaches
    // the page at all — not how many ways in it offers.
    await expect(
      page.getByRole("main").getByRole("link", { name: "Start with your GitHub repo" }).first(),
    ).toBeVisible();
  });

  test("signup does not require a session", async ({ page }) => {
    await page.goto("/signup");
    await expect(page.getByRole("button", { name: "Create account" })).toBeVisible();
  });
});

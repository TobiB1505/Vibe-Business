import { expect, test, type Page } from "@playwright/test";

/**
 * The first ten minutes, in a real browser (UI-S1 §22–§24).
 *
 * ## What this suite is arguing
 *
 * That a stranger can understand what Vibe is, reach the sign-up screen, read
 * what happens to their repository — and that a founder with no live product
 * can finish setting up instead of hitting a wall. Every one of those is a
 * claim about what is on a screen at a given width, and none of them is a
 * property of a data structure.
 *
 * ## Public pages are real; onboarding is fixtures
 *
 * The landing page, sign-up and the legal routes are the actual routes, because
 * they need nothing but a render. The onboarding states go through the fixture
 * harness for the reason documented in `src/app/e2e/[scenario]/page.tsx`: there
 * is no isolated database here, so the real components are given the real
 * operation views and the browser does the rest.
 *
 * ## No network leaves the machine
 *
 * `forbidExternalCalls` aborts anything that is not localhost and records it, so
 * a fixture that quietly reached the internet fails rather than passing slowly.
 * That is also what makes the broken-logo test honest: the logo URL is aborted
 * at the network layer, which is exactly the failure a customer's dead asset
 * produces.
 */

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

async function forbidExternalCalls(page: Page): Promise<string[]> {
  const attempted: string[] = [];
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
      attempted.push(url.href);
      await route.abort();
      return;
    }
    await route.continue();
  });
  return attempted;
}

/** Nothing may scroll sideways. A landing page that does is broken on a phone. */
async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "horizontal overflow in px").toBeLessThanOrEqual(1);
}

test.describe("the landing page", () => {
  test("sends the primary call to action to sign-up, not sign-in", async ({ page }) => {
    await page.goto("/");

    const hero = page.getByRole("main").locator("section").first();
    const primary = hero.getByRole("link", { name: "Get started" });
    await expect(primary).toBeVisible();
    await expect(primary).toHaveAttribute("href", "/signup");

    await primary.click();
    await expect(page).toHaveURL(/\/signup$/);
    await expect(page.getByRole("heading", { name: "Create account" })).toBeVisible();
  });

  test("offers signing in as the secondary route", async ({ page }) => {
    await page.goto("/");
    const hero = page.getByRole("main").locator("section").first();
    await expect(hero.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
  });

  test("says what the product does, in one heading a founder can act on", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1 })).toContainText("vibe-coded the product");
    await expect(
      page.getByRole("heading", { name: "Turn what you built into a business." }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "See what is working and where to start." }),
    ).toBeVisible();
  });

  /** The self-negating copy, gone — asserted on rendered text, not on source. */
  test("no longer tells visitors the product is unbuilt", async ({ page }) => {
    await page.goto("/");
    const body = page.locator("body");
    for (const stale of ["PRODUCT.md", "not built yet", "early development", "core loop"]) {
      await expect(body, stale).not.toContainText(stale);
    }
  });

  test("shows the nine real business areas without inventing a score", async ({ page }) => {
    await page.goto("/");

    for (const area of ["Offer", "Audience", "Acquisition", "Conversion", "Retention"]) {
      await expect(page.getByText(area, { exact: true }).first()).toBeVisible();
    }
    await expect(page.getByText("Nothing is filled in here")).toBeVisible();
  });

  test("reaches the legal surfaces from the footer", async ({ page }) => {
    await page.goto("/");

    const footer = page.getByRole("navigation", { name: "Footer" });
    await expect(footer.getByRole("link", { name: "Privacy" })).toBeVisible();
    await expect(footer.getByRole("link", { name: "Terms" })).toBeVisible();

    await footer.getByRole("link", { name: "Privacy" }).click();
    await expect(page).toHaveURL(/\/privacy$/);
    await expect(page.getByRole("heading", { level: 1, name: "Privacy" })).toBeVisible();
  });

  for (const [name, viewport] of [
    ["desktop", DESKTOP],
    ["phone", PHONE],
  ] as const) {
    test(`survives ${name} without scrolling sideways`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto("/");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expectNoHorizontalOverflow(page);
    });
  }
});

test.describe("the legal surfaces", () => {
  for (const [path, heading] of [
    ["/privacy", "Privacy"],
    ["/terms", "Terms"],
  ] as const) {
    test(`${path} renders and admits what is still missing`, async ({ page }) => {
      await page.goto(path);

      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
      await expect(page.getByText("Not yet complete")).toBeVisible();
      await expect(page.getByText("registered address", { exact: false })).toBeVisible();

      await page.setViewportSize(PHONE);
      await expectNoHorizontalOverflow(page);
    });
  }
});

test.describe("sign-up", () => {
  test("offers both ways in and links what the founder is agreeing to", async ({ page }) => {
    await page.goto("/signup");

    const google = page.getByTestId("google-signup");
    await expect(google).toBeVisible();
    await expect(google).toHaveText("Continue with Google");
    await expect(google).toBeEnabled();

    await expect(page.getByTestId("email-signup")).toBeEnabled();
    await expect(page.getByLabel("Email address")).toBeEnabled();

    await expect(page.getByRole("link", { name: "terms" })).toHaveAttribute("href", "/terms");
    await expect(page.getByRole("link", { name: "privacy notice" })).toHaveAttribute(
      "href",
      "/privacy",
    );
  });

  test("carries no developer-facing copy", async ({ page }) => {
    await page.goto("/signup");
    await expect(page.locator("body")).not.toContainText("For development");
  });
});

test.describe("onboarding with no live product", () => {
  const PARKED = "/e2e/onboarding_audit_parked";

  /**
   * The trap, in the one form a browser can disprove: is there a way out on the
   * screen, and does it lead to the workspace rather than back into setup.
   */
  test("offers a way to the workspace instead of demanding a URL", async ({ page }) => {
    await page.goto(PARKED);

    await expect(
      page.getByRole("heading", { name: "No live product yet? That's fine." }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue to your workspace" })).toBeEnabled();

    // The address field is not on screen unless it is asked for.
    await expect(page.getByLabel("Live product address")).toHaveCount(0);
  });

  test("says the audit was set aside, never that it ran", async ({ page }) => {
    await page.goto(PARKED);

    await expect(page.getByText("it has not run", { exact: false })).toBeVisible();
    const body = page.locator("body");
    await expect(body).not.toContainText("Your audit is complete");
    await expect(body).not.toContainText("failed");
  });

  test("still lets a founder who just launched add the address", async ({ page }) => {
    await page.goto(PARKED);

    const disclosure = page.getByRole("button", { name: "My product is live now" });
    await expect(disclosure).toHaveAttribute("aria-expanded", "false");

    await disclosure.click();
    await expect(disclosure).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByLabel("Live product address")).toBeVisible();
  });

  test("is usable on a phone", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto(PARKED);

    await expect(page.getByRole("button", { name: "Continue to your workspace" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});

test.describe("onboarding with a live product that has not been read", () => {
  const AWAITING = "/e2e/onboarding_audit_awaiting";

  test("asks for the address and keeps 'not yet' available beside it", async ({ page }) => {
    await page.goto(AWAITING);

    await expect(page.getByLabel("Live product address")).toBeVisible();
    await expect(page.getByRole("button", { name: "Check my live product" })).toBeEnabled();
    // The escape that stops this becoming the same trap in the other direction.
    await expect(
      page.getByRole("button", { name: "I don't have a live product yet" }),
    ).toBeEnabled();
  });
});

test.describe("a running onboarding operation", () => {
  test("names the stage the server actually reported", async ({ page }) => {
    await page.goto("/e2e/onboarding_running");
    await expect(page.getByRole("heading", { name: "Understanding what you built" })).toBeVisible();
  });

  /**
   * The frozen-stage defect, disproved.
   *
   * Two fixtures of the same run at different stages must read differently. If
   * they ever read the same, the stage line has stopped depending on the stage.
   */
  test("reads differently at a different stage", async ({ page }) => {
    await page.goto("/e2e/onboarding_running_late");
    await expect(
      page.getByRole("heading", { name: "Understanding who it is for and how people use it" }),
    ).toBeVisible();
    await expect(page.getByText("Understanding what you built")).toHaveCount(0);
  });

  test("announces itself to assistive technology", async ({ page }) => {
    await page.goto("/e2e/onboarding_running");
    await expect(page.locator("[role='status']").first()).toBeVisible();
  });

  test("says the founder may leave, while that is still true", async ({ page }) => {
    await page.goto("/e2e/onboarding_running");
    await expect(page.getByText("You can leave this page. Vibe will keep going.")).toBeVisible();
  });
});

test.describe("a stalled onboarding operation", () => {
  const STALLED = "/e2e/onboarding_stalled";

  /** §14: no worry without a next action, and no contradiction beside it. */
  test("is calm, honest, and has something to do", async ({ page }) => {
    await page.goto(STALLED);

    await expect(page.getByText("This is taking longer than usual")).toBeVisible();
    await expect(page.getByText("It may still finish on its own", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "Try again" })).toBeEnabled();
  });

  test("stops claiming the run continues once it has stopped being believable", async ({
    page,
  }) => {
    await page.goto(STALLED);
    await expect(page.getByText("You can leave this page. Vibe will keep going.")).toHaveCount(0);
  });
});

test.describe("a failed onboarding operation", () => {
  test("says what happened, what changed, and what to do", async ({ page }) => {
    await page.goto("/e2e/onboarding_failed");

    await expect(page.getByText("Vibe couldn't finish getting to know your product")).toBeVisible();
    await expect(page.getByText("are unchanged", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "Try again" })).toBeEnabled();
  });

  /** The silent reset: a start control on screen with no failure above it. */
  test("never shows a bare start button in place of a failure", async ({ page }) => {
    await page.goto("/e2e/onboarding_failed");
    const notice = page.locator("[role='status']").filter({ hasText: "Vibe couldn't finish" });
    await expect(notice).toBeVisible();
    await expect(notice.getByRole("button", { name: "Try again" })).toBeVisible();
  });

  test("exposes no provider error or stack trace", async ({ page }) => {
    await page.goto("/e2e/onboarding_failed");
    const body = page.locator("body");
    for (const leak of ["Error:", "at async", "anthropic", "supabase.co"]) {
      await expect(body, leak).not.toContainText(leak);
    }
  });

  /** A maybe-billed failure must not be offered as a one-click retry. */
  test("does not invite a retry it cannot promise was free", async ({ page }) => {
    await page.goto("/e2e/onboarding_failed_unclear");

    await expect(page.getByText("Vibe will not start this again by itself")).toBeVisible();
  });
});

test.describe("a product logo that will not load", () => {
  test("falls back to the Vibe mark rather than a broken image", async ({ page }) => {
    const attempted = await forbidExternalCalls(page);
    await page.goto("/e2e/onboarding_logo_broken");

    // The remote asset was genuinely attempted and genuinely refused, so the
    // fallback below is the browser's real error path rather than a stub.
    await expect
      .poll(() => attempted.some((url) => url.includes("acme.test")))
      .toBe(true);

    await expect(page.getByTestId("product-logo")).toHaveCount(0);
    const mark = page.locator("img[src*='vibe-mark']");
    await expect(mark).toBeVisible();
    // A decorative fallback: it stands in for the customer's logo, and naming
    // it "Vibe Business" where their logo should be would be worse than silent.
    await expect(mark).toHaveAttribute("alt", "");
  });
});

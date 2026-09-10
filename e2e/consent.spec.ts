import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./support/overflow";
import { OPTIONAL_CATEGORIES } from "../src/modules/consent/categories";
import { CONSENT_VERSION } from "../src/modules/consent/record";

/**
 * Cookies: what is asked, and what is actually loaded (UI-23).
 *
 * ## What this exists to prevent
 *
 * A banner that asks and loads anyway. Before this sprint Vibe mounted three
 * third-party tags on first paint with nothing asked — Vercel Web Analytics,
 * Vercel Speed Insights, and the **Meta Pixel**, which sets `_fbp` and reports
 * the address of every public page a visitor opens. `/privacy` listed the gap
 * itself: *"consent for advertising cookies where the law requires asking
 * first, and a way to decline."*
 *
 * So the load-bearing assertions here are not about the banner's appearance.
 * They are: with no decision, **no tracker is in the document**; after a
 * refusal, still none; and refusing is exactly as easy as accepting.
 *
 * Every other spec in this suite starts with a refusing consent cookie set by
 * `playwright.config.ts`, which is why this file clears it first.
 */

const ANALYTICS_SCRIPT = 'script[src*="/_vercel/insights"]';
const SPEED_SCRIPT = 'script[src*="/_vercel/speed-insights"]';

async function openUndecided(page: Page, path = "/") {
  await page.context().clearCookies();
  await page.goto(path);
  await page.evaluate(() => document.fonts.ready);
}

async function consentCookie(page: Page): Promise<string | undefined> {
  const cookies = await page.context().cookies();
  return cookies.find((cookie) => cookie.name === "vibe-consent")?.value;
}

test.describe("before anybody has answered", () => {
  test("asks, and loads no tracker while it is asking", async ({ page }) => {
    await openUndecided(page);

    await expect(page.getByTestId("consent-banner")).toBeVisible();

    // The point of the whole feature. Not "disabled" — absent.
    await expect(page.locator(ANALYTICS_SCRIPT)).toHaveCount(0);
    await expect(page.locator(SPEED_SCRIPT)).toHaveCount(0);
    expect(
      await consentCookie(page),
      "a decision was recorded before one was made",
    ).toBeUndefined();
  });

  /**
   * The one thing about a consent banner that is not a matter of taste.
   *
   * Every reference banner in the registries puts a filled *Accept all* beside
   * a quiet *Customize*, which puts refusal two clicks behind acceptance.
   * German and French regulators have repeatedly fined exactly that.
   */
  test("makes refusing exactly as easy as agreeing", async ({ page }) => {
    await openUndecided(page);

    const reject = page.getByTestId("consent-reject");
    const accept = page.getByTestId("consent-accept");

    const rejectBox = (await reject.boundingBox())!;
    const acceptBox = (await accept.boundingBox())!;

    // Same row, within a line height of each other.
    expect(Math.abs(rejectBox.y - acceptBox.y)).toBeLessThan(8);
    // Same weight: neither is the loud one.
    const [rejectStyle, acceptStyle] = await Promise.all([
      reject.evaluate((n) => {
        const s = getComputedStyle(n);
        return `${s.backgroundColor}|${s.fontWeight}|${Math.round(n.getBoundingClientRect().height)}`;
      }),
      accept.evaluate((n) => {
        const s = getComputedStyle(n);
        return `${s.backgroundColor}|${s.fontWeight}|${Math.round(n.getBoundingClientRect().height)}`;
      }),
    ]);
    expect(rejectStyle, "the two answers are not drawn the same").toBe(acceptStyle);
  });

  /**
   * A banner that blocks the page makes "agree" the fast way out, which is
   * coercion with a stylesheet. It is also, measurably, a barrier across the
   * foot of every page: 29 specs failed the moment this was mounted globally,
   * before the wrapper stopped taking pointer events.
   */
  test("does not put an invisible barrier across the page", async ({ page }) => {
    await openUndecided(page);
    // The banner mounts after the cookie read, so it is not in the first frame.
    await expect(page.getByTestId("consent-banner")).toBeVisible();

    const barrier = await page.evaluate(() => {
      const banner = document.querySelector("[data-testid='consent-banner']") as HTMLElement;
      const box = banner.getBoundingClientRect();
      // A point inside the strip but beside the card.
      const x = Math.max(4, box.left + 8);
      const y = box.top + box.height / 2;
      const hit = document.elementFromPoint(x, y);
      return banner.contains(hit);
    });
    expect(barrier, "the banner's margin swallows clicks meant for the page").toBe(false);
  });
});

test.describe("answering it", () => {
  test("refusing records the refusal and still loads nothing", async ({ page }) => {
    await openUndecided(page);
    await page.getByTestId("consent-reject").click();

    await expect(page.getByTestId("consent-banner")).toHaveCount(0);
    expect(await consentCookie(page)).toBe("v1.000." + (await consentCookie(page))!.split(".")[2]);
    await expect(page.locator(ANALYTICS_SCRIPT)).toHaveCount(0);

    // And it stays refused across a reload, rather than asking again.
    await page.reload();
    await expect(page.getByTestId("consent-banner")).toHaveCount(0);
    await expect(page.locator(ANALYTICS_SCRIPT)).toHaveCount(0);
  });

  test("accepting loads the analytics that were refused a moment ago", async ({ page }) => {
    await openUndecided(page);
    await page.getByTestId("consent-accept").click();

    await expect(page.getByTestId("consent-banner")).toHaveCount(0);
    expect((await consentCookie(page))!.startsWith("v1.111.")).toBe(true);

    // The gate is what mounts them, so this is the proof the switch is wired
    // to something rather than to a preference nobody reads.
    await expect(page.locator(ANALYTICS_SCRIPT)).toHaveCount(1);
  });

  test("offers the categories, with nothing pre-ticked", async ({ page }) => {
    await openUndecided(page);
    await page.getByTestId("consent-choose").click();

    const analytics = page.getByRole("switch", { name: "Analytics" });
    const marketing = page.getByRole("switch", { name: "Marketing" });
    const preferences = page.getByRole("switch", { name: "Preferences" });

    // A pre-ticked box is a record of an action nobody took.
    for (const control of [analytics, marketing, preferences]) {
      await expect(control).toHaveAttribute("aria-checked", "false");
    }

    // Necessary is a state, not a disabled switch: a switch that cannot be
    // moved still says "this could be off, and somebody decided for you".
    await expect(page.getByRole("switch", { name: "Necessary" })).toHaveCount(0);
    await expect(page.getByText("Always on")).toBeVisible();
  });

  test("saves exactly the categories that were switched on", async ({ page }) => {
    await openUndecided(page);
    await page.getByTestId("consent-choose").click();
    await page.getByRole("switch", { name: "Analytics" }).click();
    await page.getByTestId("consent-save").click();

    // preferences off, analytics on, marketing off — positional, so a
    // transposition in the encoder shows up here.
    expect((await consentCookie(page))!.startsWith("v1.010.")).toBe(true);
    await expect(page.locator(ANALYTICS_SCRIPT)).toHaveCount(1);
  });
});

test.describe("a decision that no longer answers the question", () => {
  /**
   * Consent is given to a list. When the list changes, reading an old "yes" as
   * covering the new thing is consenting on somebody's behalf.
   */
  test("asks again when the record was made against a different list", async ({ page }) => {
    await page.context().clearCookies();
    await page.context().addCookies([
      {
        name: "vibe-consent",
        value: "v99.111.1757246400",
        domain: "127.0.0.1",
        path: "/",
      },
    ]);
    await page.goto("/");

    await expect(page.getByTestId("consent-banner")).toBeVisible();
    await expect(page.locator(ANALYTICS_SCRIPT)).toHaveCount(0);
  });

  test("asks again when the record is not one this code wrote", async ({ page }) => {
    await page.context().clearCookies();
    await page
      .context()
      .addCookies([{ name: "vibe-consent", value: "accept-all", domain: "127.0.0.1", path: "/" }]);
    await page.goto("/");

    await expect(page.getByTestId("consent-banner")).toBeVisible();
    await expect(page.locator(ANALYTICS_SCRIPT)).toHaveCount(0);
  });
});

test.describe("changing your mind, in Settings", () => {
  test("shows what is stored and writes what is changed", async ({ page }) => {
    await page.goto("/e2e/cookie-settings");

    // The suite's own cookie refuses everything, so the panel must show that.
    for (const name of ["Preferences", "Analytics", "Marketing"]) {
      await expect(page.getByRole("switch", { name })).toHaveAttribute("aria-checked", "false");
    }

    await page.getByRole("switch", { name: "Marketing" }).click();
    await page.getByTestId("cookie-save").click();

    expect((await consentCookie(page))!.startsWith("v1.001.")).toBe(true);
    await expect(page.getByRole("status")).toContainText("Saved");
  });

  test("withdraws in one click, the same as giving", async ({ page }) => {
    await page.goto("/e2e/cookie-settings");

    await page.getByRole("button", { name: "Accept all" }).click();
    expect((await consentCookie(page))!.startsWith("v1.111.")).toBe(true);

    await page.getByRole("button", { name: "Reject all" }).click();
    expect((await consentCookie(page))!.startsWith("v1.000.")).toBe(true);
  });

  test("does not overflow a phone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/e2e/cookie-settings");
    await page.evaluate(() => document.fonts.ready);

    await expectNoHorizontalOverflow(page);
  });
});

/**
 * And the banner is not in the way of the other eight hundred tests.
 *
 * `playwright.config.ts` ships a refusing consent record in `storageState`, so
 * every spec but this one starts with the question already answered. That is
 * deliberate — a banner fixed to the bottom of the screen is not a fixture
 * every unrelated test should have to reason about — but it used to be a
 * *literal string*, `"v1.000.1757246400"`, and that string is only an answer
 * while `CONSENT_VERSION` is 1 and there are exactly three optional
 * categories.
 *
 * `record.ts` says outright to raise the version when the list gains something
 * loaded. The first person to do that would have handed the whole suite a
 * banner back, and on a phone that banner lands on the tab bar and intercepts
 * every tap on the navigation (UI-35). The config builds the value with
 * `encodeConsent` now; this is what says so out loud rather than trusting it.
 */
test.describe("the banner stays out of every other spec", () => {
  test("is already answered on an ordinary screen", async ({ page }) => {
    // No `clearCookies` — this is the state the rest of the suite runs in.
    await page.goto("/e2e/account-repositories");
    await page.evaluate(() => document.fonts.ready);

    await expect(page.getByTestId("consent-banner")).toHaveCount(0);

    /*
      And it is answered for *this* version of the list. A record from an
      older version is not a decision — the product asks again — so a cookie
      that parses but is stale would put the banner back on every screen.
    */
    const cookie = await consentCookie(page);
    expect(cookie, "the suite's consent record is missing").toBeDefined();
    expect(cookie!.startsWith(`v${CONSENT_VERSION}.`)).toBe(true);
    // One digit per optional category, all refused.
    expect(cookie!.split(".")[1]).toBe("0".repeat(OPTIONAL_CATEGORIES.length));
  });
});

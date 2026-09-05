import { expect, type Page, test } from "@playwright/test";

/**
 * The Credits screen, in a real browser (BILLING CORE-2 §49–§55, §93, §94).
 *
 * ## What this suite exists to prove
 *
 * That the discipline the domain enforces survives being rendered. A unit test
 * proves purchased Credits are protected and expiring ones go first; only a
 * browser proves the customer is shown a single number and a date rather than
 * the lot table that produced them. CLAUDE.md rule 69 names this exact gap —
 * "three greens and an untested screen" — and billing is the worst place to
 * have it.
 *
 * The three properties asserted hardest are all negatives:
 *
 * - **No internal vocabulary reaches the screen.** No "lot", "allocation",
 *   "reservation", "ledger", "nanoUSD", "rate card", "SKU", no token counts and
 *   no raw enum (§53, §94).
 * - **No amount is client-supplied.** Every purchase control posts a SKU key
 *   and nothing else — no price, no currency, no Credit count in any form
 *   field (§23, §52).
 * - **The Checkout return never claims Credits were added.** It says the
 *   payment is being confirmed, because at that moment that is all Vibe knows
 *   (§25, §95).
 *
 * ## What it does not prove
 *
 * The server wiring in `billing/page.tsx` that assembles the overview from
 * Supabase, RLS, or anything about Stripe. There is no isolated database and no
 * Stripe test account in this environment, so every state comes from
 * `billing-scenarios.ts`.
 */

/** Internal vocabulary that must never reach a customer (§94). */
const FORBIDDEN_VOCABULARY = [
  "grant lot",
  "allocation",
  "reservation",
  "ledger",
  "nanoUSD",
  "nano_usd",
  "rate card",
  "rate-card",
  "rateCard",
  "settlement",
  "idempotency",
  "credit_units",
  "creditUnits",
  "source_kind",
  "posted_credits",
  "reserved_credits",
  "stripe_",
  "price_",
  "anthropic",
  "tokens",
];

async function open(page: Page, scenario: string): Promise<void> {
  await page.goto(`/e2e/${scenario}`);
  await expect(page.getByRole("heading", { name: "Billing", exact: true })).toBeVisible();
}

test.describe("the balance", () => {
  test("shows one number, with the word Credits beside it", async ({ page }) => {
    await open(page, "billing-free");

    // One number and the word "Credits", in one element — the whole of §50.
    await expect(page.getByTestId("credit-balance")).toHaveText(/2,480\s+Credits/);
    await expect(page.getByText("Available Credits", { exact: true })).toBeVisible();
  });

  test("says when the next Credits expire, in plain language", async ({ page }) => {
    await open(page, "billing-free");

    // "120 expire on 1 Sep 2026" — a number and a date, not an expiry policy.
    await expect(page.getByText(/120 expire on/)).toBeVisible();
  });

  test("shows no expiry line when nothing is due to expire", async ({ page }) => {
    await open(page, "billing-unconfigured");
    await expect(page.getByText(/expire on/)).toHaveCount(0);
  });

  test("shows a zero balance as 0 rather than as an error or an empty space", async ({ page }) => {
    await open(page, "billing-empty");
    await expect(page.getByTestId("credit-balance")).toHaveText(/0\s+Credits/);
  });
});

test.describe("the plan", () => {
  test("names the Free plan and what it includes", async ({ page }) => {
    await open(page, "billing-free");

    await expect(page.getByRole("heading", { name: "Free", exact: true })).toBeVisible();
    await expect(page.getByText(/first Business Audit and first Deep Scan/)).toBeVisible();
  });

  test("names a paid plan and when it renews", async ({ page }) => {
    await open(page, "billing-builder");

    await expect(page.getByRole("heading", { name: "Builder", exact: true })).toBeVisible();
    await expect(page.getByText(/Renews on/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Manage or cancel plan" })).toBeVisible();
  });

  test("marks the current plan instead of offering to buy it again", async ({ page }) => {
    await open(page, "billing-builder");

    await expect(
      page.getByRole("region", { name: "Plans" }).getByText("Current plan", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Choose Builder" })).toHaveCount(0);
    // The other plan is still offered.
    await expect(page.getByRole("button", { name: "Choose Pro" })).toBeVisible();
  });

  test("offers both paid plans at their approved prices", async ({ page }) => {
    await open(page, "billing-free");

    await expect(page.getByText("€19 / month")).toBeVisible();
    await expect(page.getByText("€49 / month")).toBeVisible();
    await expect(page.getByText("1,000 Credits each month")).toBeVisible();
    await expect(page.getByText("3,000 Credits each month")).toBeVisible();
  });
});

test.describe("buying Credits", () => {
  test("offers the three approved packs at their approved prices", async ({ page }) => {
    await open(page, "billing-free");

    for (const [credits, price] of [
      ["500 Credits", "€12"],
      ["1,500 Credits", "€33"],
      ["5,000 Credits", "€99"],
    ]) {
      await expect(page.getByText(credits, { exact: true })).toBeVisible();
      await expect(page.getByText(price, { exact: true })).toBeVisible();
    }
  });

  test("posts a SKU key and nothing else — no price, currency or amount (§23)", async ({ page }) => {
    await open(page, "billing-free");

    /*
     * The structural guarantee, asserted on the rendered DOM: every field the
     * browser would submit is a SKU key. A field carrying a number would be a
     * field an attacker could change.
     *
     * Next.js injects its own `$ACTION_*` inputs to route a Server Action —
     * framework machinery rather than application data, and excluded by name
     * rather than by position so a real field can never hide behind one.
     */
    const fields = await page.locator("form input").evaluateAll((inputs) =>
      inputs
        .map((input) => ({
          name: (input as HTMLInputElement).name,
          value: (input as HTMLInputElement).value,
        }))
        .filter((field) => !field.name.startsWith("$ACTION")),
    );

    expect(fields.length).toBeGreaterThan(0);
    for (const field of fields) {
      expect(["pack", "plan"]).toContain(field.name);
      expect(field.value).toMatch(/^(pack_500|pack_1500|pack_5000|builder|pro)$/);
    }
  });

  test("disables purchasing when Stripe is not configured, and says why", async ({ page }) => {
    await open(page, "billing-unconfigured");

    // The apostrophe is typographic in the rendered copy, so the pattern does
    // not assume which one it is.
    await expect(page.getByText(/Payments aren.t set up on this deployment/)).toBeVisible();
    // Not a colour-only state: the control reads "Unavailable".
    await expect(page.getByRole("button", { name: "Unavailable" }).first()).toBeDisabled();
  });
});

test.describe("prices", () => {
  test("states what every operation costs, before anything is bought", async ({ page }) => {
    await open(page, "billing-free");

    /*
     * Scoped to the price list, because the same words now appear in the
     * history too — which is the point: a charge and a price that name the
     * same thing differently is what the activity projection exists to end.
     */
    const prices = page.getByRole("region", { name: "Credit prices" });
    await expect(prices.getByText("Business Audit", { exact: true })).toBeVisible();
    await expect(prices.getByText("35 Credits", { exact: true })).toBeVisible();
    await expect(prices.getByText("20 Credits", { exact: true })).toBeVisible();
    await expect(prices.getByText("15 Credits", { exact: true })).toBeVisible();
  });

  test("shows Product Understanding as Free rather than as 0 Credits (§56)", async ({ page }) => {
    await open(page, "billing-free");

    // Scoped to the price list: "Free" also names the plan elsewhere on the page.
    const row = page.getByRole("listitem").filter({ hasText: "Understanding your product" });
    await expect(row).toContainText("Free");
    // Exact, and scoped: an unanchored "0 Credits" matches inside
    // "1000 Credits each month" and would pass for the wrong reason.
    await expect(row.getByText("0 Credits", { exact: true })).toHaveCount(0);
  });
});

test.describe("recent activity", () => {
  /**
   * The history says what the Credits were *for*.
   *
   * Every one of these used to read "Credits used" or "Credits added" — the
   * ledger's own kind, which tells a customer nothing they did not already know
   * from the sign in front of the number. `overview.test.ts` proves each label
   * is resolved from a real ledger row rather than from a mapping table; this
   * proves the resolved label survives being rendered.
   */
  test("names what each movement was for, never a ledger kind (§53)", async ({ page }) => {
    await open(page, "billing-free");

    await expect(page.getByText("Business Audit", { exact: true }).last()).toBeVisible();
    await expect(page.getByText("Credit Pack", { exact: true })).toBeVisible();
    await expect(page.getByText("Welcome Credits", { exact: true })).toBeVisible();
  });

  test("carries the sign in the text, not in colour alone (§93)", async ({ page }) => {
    await open(page, "billing-free");

    await expect(page.getByText("-35", { exact: true })).toBeVisible();
    await expect(page.getByText("+500", { exact: true })).toBeVisible();
  });

  test("shows a plan renewal as Credits arriving, in plan words", async ({ page }) => {
    await open(page, "billing-builder");

    const history = page.getByRole("region", { name: "Recent usage" });
    await expect(history.getByText("Monthly Credits", { exact: true })).toBeVisible();
    await expect(history.getByText("+1,000", { exact: true })).toBeVisible();
  });

  test("shows a refund as Credits coming back", async ({ page }) => {
    await open(page, "billing-launch-v1");

    await expect(page.getByText("Refund", { exact: true })).toBeVisible();
    await expect(page.getByText("+35", { exact: true })).toBeVisible();
  });

  test("names the Deep Scan that has no operation behind it", async ({ page }) => {
    await open(page, "billing-launch-v1");

    await expect(page.getByText("Deep Scan", { exact: true })).toBeVisible();
  });

  test("says so plainly when there is no history", async ({ page }) => {
    await open(page, "billing-empty");

    await expect(page.getByText("No Credit activity yet")).toBeVisible();
    // An empty state that explains itself, rather than one that could be read
    // as something having failed to load.
    await expect(page.getByText(/will appear here/)).toBeVisible();
  });
});

test.describe("the balance answers more than one number (§50)", () => {
  test("says what is left of the included monthly Credits, and when they renew", async ({ page }) => {
    await open(page, "billing-builder");

    await expect(page.getByText(/1,000 of 1,000 monthly Credits left/)).toBeVisible();
    await expect(page.getByText(/Your included Credits renew on/)).toBeVisible();
  });

  /**
   * The only line on the page that can explain a balance the history does not
   * add up to. It is deliberately absent at zero: a permanent "0 Credits held"
   * would teach every customer what a hold is in order to tell them nothing.
   */
  test("explains Credits a running job is holding", async ({ page }) => {
    await open(page, "billing-builder");

    await expect(page.getByText(/held for work that is still running/)).toBeVisible();
    await expect(page.getByText("200", { exact: true })).toBeVisible();
  });

  test("says nothing about holds when nothing is held", async ({ page }) => {
    await open(page, "billing-free");

    await expect(page.getByText(/held for work that is still running/)).toHaveCount(0);
  });

  test("claims no monthly allowance on a plan that includes none", async ({ page }) => {
    await open(page, "billing-free");

    await expect(page.getByText(/monthly Credits left/)).toHaveCount(0);
  });
});

test.describe("a balance too low to buy anything (§43)", () => {
  /**
   * The billing page never refuses an operation — `authorizeOperationCredits`
   * does, server-side, and no figure rendered here may override it. What this
   * state has to get right is smaller: a wallet below the cheapest thing on the
   * price table must still read as a calm, buyable page.
   */
  test("shows the real balance and keeps buying reachable", async ({ page }) => {
    await open(page, "billing-low");

    await expect(page.getByTestId("credit-balance")).toHaveText(/8\s+Credits/);
    await expect(page.getByText(/8 of 1,000 monthly Credits left/)).toBeVisible();
    await expect(page.getByRole("link", { name: /Buy Credits/ })).toBeVisible();
  });

  test("does not scold, warn or block", async ({ page }) => {
    await open(page, "billing-low");

    const text = await page.locator("main").innerText();
    for (const alarm of ["Out of Credits", "You cannot", "Error", "Warning"]) {
      expect(text, `low balance screen says "${alarm}"`).not.toContain(alarm);
    }
  });
});

test.describe("the Checkout return never mints Credits (§25)", () => {
  test("says the payment is being confirmed, not that Credits were added", async ({ page }) => {
    await open(page, "billing-checkout-complete");

    await expect(page.getByText(/Your payment is being confirmed/)).toBeVisible();
    // The lie this page could tell, asserted as a negative.
    await expect(page.getByText(/Credits added to your balance/)).toHaveCount(0);
    await expect(page.getByText(/Purchase complete/)).toHaveCount(0);
  });

  test("shows the balance unchanged beside the pending notice", async ({ page }) => {
    await open(page, "billing-checkout-complete");
    await expect(page.getByTestId("credit-balance")).toHaveText(/100\s+Credits/);
  });
});

test.describe("the Welcome claim", () => {
  test("is offered only to an account that has not received it", async ({ page }) => {
    await open(page, "billing-empty");

    await expect(page.getByText(/eligible for 100 Welcome Credits/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Add my 100 Welcome Credits" })).toBeVisible();
  });

  test("is absent once the account has it", async ({ page }) => {
    await open(page, "billing-free");
    await expect(page.getByRole("button", { name: "Add my 100 Welcome Credits" })).toHaveCount(0);
  });
});

test.describe("no internal vocabulary reaches the customer (§52, §94)", () => {
  for (const scenario of ["billing-free", "billing-builder", "billing-empty"]) {
    test(`${scenario} exposes no internal billing terms`, async ({ page }) => {
      await open(page, scenario);

      const body = ((await page.locator("body").textContent()) ?? "").toLowerCase();
      for (const term of FORBIDDEN_VOCABULARY) {
        expect(body, `screen shows "${term}"`).not.toContain(term.toLowerCase());
      }
    });
  }

  test("exposes no provider cost, token count or internal unit", async ({ page }) => {
    await open(page, "billing-free");

    /*
     * `innerText` of the rendered main, not `textContent` of the body.
     * `textContent` includes the inline RSC payload script, which is React's
     * own serialization and full of "$" markers — asserting against it tests
     * the framework rather than the screen.
     */
    const visible = await page.locator("main").innerText();

    // Internal credit units are 1000× the displayed figure. 2,480 Credits must
    // never render as 2480000.
    expect(visible).not.toContain("2480000");
    // No currency symbol beside a Credit figure other than the catalog prices.
    expect(visible).not.toContain("$");
  });

  test("does not copy reference-only card, invoice or product-usage data", async ({ page }) => {
    await open(page, "billing-free");

    await expect(page.getByText(/Visa|4242|Billing history|Usage by product/i)).toHaveCount(0);
  });
});

test.describe("loading is not zero (§50)", () => {
  /**
   * A skeleton must not read as a balance.
   *
   * "Unknown" and "0 Credits" are different facts about somebody's money, and
   * a placeholder shaped like a figure collapses them. `loading.tsx` was
   * written to avoid that deliberately — and until this test it was a route
   * convention no browser could reach, so the intention had never been
   * checked against what a person would actually see.
   */
  test("shows no number at all while the balance is unknown", async ({ page }) => {
    await page.goto("/e2e/billing-loading");

    const status = page.getByRole("status", { name: /Loading your billing details/ });
    await expect(status).toBeVisible();

    // Any digit would be a claim. Scoped to the skeleton, since the fixture
    // route prints its own scenario label above it.
    expect(await status.innerText()).not.toMatch(/[0-9]/);
  });
});

test.describe("accessibility (§93)", () => {
  test("every control is a real, keyboard-reachable button", async ({ page }) => {
    await open(page, "billing-free");

    const buttons = page.getByRole("button");
    await expect(buttons.first()).toBeVisible();

    // Tab reaches a control rather than the page having click-only divs.
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => document.activeElement?.tagName ?? "");
    expect(["BUTTON", "A", "INPUT"]).toContain(focused);
  });

  test("uses one page heading and real section headings", async ({ page }) => {
    await open(page, "billing-free");

    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 2 }).first()).toBeVisible();
  });

  test("does not overflow horizontally on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, "billing-free");

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

/**
 * The screen under `launch-v1`, in a browser.
 *
 * The domain layer's prices were correct and every test was green while this
 * page rendered `retail-v1`'s three rows under a footnote describing agent
 * tiers that were not on it. Three greens and an untested screen is the failure
 * mode [CLAUDE.md](../CLAUDE.md) rule 69 names, and this is it happening.
 */
test.describe("the price table under launch-v1 (rule 69)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/e2e/billing-launch-v1");
  });

  test("states every operation the policy sells, and none it does not", async ({ page }) => {
    const text = await page.locator("body").innerText();

    expect(text).toContain("Business Audit");
    expect(text).toContain("35 Credits");
    expect(text).toContain("Next moves");
    expect(text).toContain("20 Credits");
    expect(text).toContain("Deep Scan (additional)");
    expect(text).toContain("25 Credits");
  });

  test("shows all three agent tiers rather than a range or a 'from'", async ({ page }) => {
    // A customer budgeting needs the top of the scale. "From 150 Credits" hides
    // exactly the number they would plan against, and the cheapest of three is
    // a lie.
    const text = await page.locator("body").innerText();

    expect(text).toContain("Agent improvement");
    expect(text).toContain("150 Credits");
    expect(text).toContain("200 Credits");
    expect(text).toContain("350 Credits");
  });

  test("keeps Product Understanding free rather than at 0 Credits", async ({ page }) => {
    const row = page.getByText("Understanding your product").locator("xpath=ancestor::li[1]");
    await expect(row).toContainText("Free");
    await expect(row).not.toContainText("0 Credits");
  });

  test("qualifies the prices that are not measured, and only those", async ({ page }) => {
    const text = await page.locator("body").innerText();

    // The footnote is present here because rows on this page need it.
    expect(text).toContain("Agent prices scale with how broad a change is");

    // And a measured row does not carry the marker.
    const audit = page
      .getByRole("region", { name: "Credit prices" })
      .getByRole("listitem")
      .filter({ hasText: "Business Audit" });
    await expect(audit).not.toContainText("*");
  });

  test("says what a plan buys, in work rather than in Credits", async ({ page }) => {
    const text = await page.locator("body").innerText();

    // 1,000 ÷ 200 = 5 and 1,000 ÷ 35 = 28, both rounded down. Computed from the
    // catalog and the rate card, never typed, so it cannot drift from what is
    // actually charged.
    expect(text).toContain("Builder buys");
    expect(text).toContain("5 standard agent improvements, or 28 Business Audits each month");
    expect(text).toContain("15 standard agent improvements, or 85 Business Audits each month");
  });

  test("still exposes no provider cost, token count or internal unit", async ({ page }) => {
    const text = (await page.locator("body").innerText()).toLowerCase();

    for (const forbidden of ["token", "nanousd", "usd", "sandbox", "anthropic", "margin", "cogs"]) {
      expect(text, `launch-v1 billing page leaks "${forbidden}"`).not.toContain(forbidden);
    }
  });

  test("does not overflow horizontally on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflows).toBe(false);
  });
});

/*
 * Slice 5, R24. The ledger has carried `project_id` since it existed and the
 * read never selected it, so Billing could show that 200 Credits left the
 * account and not which of four products spent them.
 */
test.describe("where the Credits went", () => {
  test("groups spend by product, and says what the total covers", async ({ page }) => {
    await open(page, "billing-free");

    const spend = page.getByTestId("spend-by-product");
    await expect(spend).toBeVisible();
    await expect(spend).toContainText("Acme");
    await expect(spend).toContainText(/35 Credits/);

    // The scope of the number is stated rather than left to be assumed.
    await expect(page.getByText(/across the activity shown below/i)).toBeVisible();
  });

  test("names the product on the movement that belongs to one", async ({ page }) => {
    await open(page, "billing-free");

    await expect(page.getByText(/Acme ·/)).toBeVisible();
  });
});

/*
 * Slice 5's last acceptance line. `audit_events` is written per user, and the
 * rows with no `project_id` — a Credit grant, a GitHub connection — could not
 * be returned by the project-scoped read, which filters on exactly the column
 * they have nothing in. They were recorded and shown nowhere.
 */
test.describe("the account's own record", () => {
  test("shows the events that belong to no product", async ({ page }) => {
    await open(page, "billing-free");

    const section = page.getByRole("region", { name: /your account/i });
    await expect(section).toBeVisible();
    await expect(section).toContainText(/credits added/i);
    await expect(section).toContainText(/github installation connected/i);
  });
});

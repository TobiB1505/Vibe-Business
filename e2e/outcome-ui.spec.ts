import { expect, test, type Page } from "@playwright/test";

/**
 * The Outcome panel, in a real browser (Sprint 12A §44).
 *
 * ## What this suite exists to prove
 *
 * That the panel a person actually looks at after a merge keeps three claims
 * apart:
 *
 * ```
 * Merged              the branch moved                    — proven in Sprint 11C
 * Production outcome  the intended behaviour was observed — this sprint
 * Business impact     nobody has measured it              — and it says so
 * ```
 *
 * The moment a green tick appears under a successful merge is the moment a user
 * concludes "it worked, the business is better". Every test below is a way of
 * asserting the screen does not let them.
 *
 * ## What it does not prove
 *
 * The wiring in `page.tsx` that produces these states, or RLS. There is no
 * isolated database available here, so the states come from fixtures — the same
 * gap Sprint 11C.1 documented, and it is still real.
 */

/**
 * The panel's headline state, as distinct from the ladder row beneath it.
 *
 * Both legitimately say "Partially observed" — the headline announces the
 * result, the ladder places it against delivery and business impact — so an
 * unscoped text match is ambiguous. Selecting the paragraph is what makes each
 * assertion about the thing it is named for rather than about whichever
 * element happened to match first.
 */
function outcomeHeadline(page: Page, text: string) {
  return outcomeSection(page).locator(`p:text-is("${text}")`);
}

function outcomeSection(page: Page) {
  // The direct-child heading is what makes this unambiguous: the panels are
  // `<section>`s nested inside the prepared-changes `<section>`, so "a section
  // containing an Outcome heading" would match the wrapper too.
  return page.locator('section:has(> h4:text-is("Outcome"))');
}

/**
 * Fails the test if the page reaches any external host.
 *
 * The whole point of §43 is that rendering an outcome costs nothing. A panel
 * that quietly fetched a customer's production website on render would be a
 * side-effect-capable page load, and "zero real calls" has to be a counter
 * rather than a promise.
 */
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

test.describe("merged but not yet measured", () => {
  test("offers the check, and does not claim anything was measured", async ({ page }) => {
    const external = await forbidExternalCalls(page);
    await page.goto("/e2e/outcome_not_started");

    const outcome = outcomeSection(page);

    await expect(outcome.getByText("Merged", { exact: true })).toBeVisible();
    await expect(outcome.getByText("Not yet verified in production")).toBeVisible();
    await expect(page.getByRole("button", { name: "Check production outcome" })).toBeVisible();

    // Rendering the panel must not have contacted the customer's website (§43).
    expect(external, "the outcome screen reached an external host").toEqual([]);
  });

  test("says what the check will do before it is clicked", async ({ page }) => {
    await page.goto("/e2e/outcome_not_started");
    const outcome = outcomeSection(page);

    await expect(outcome).toContainText("This reads public pages only, and changes nothing.");
  });
});

test.describe("observing", () => {
  test("shows a running state with no invented percentage", async ({ page }) => {
    await page.goto("/e2e/outcome_observing");
    const outcome = outcomeSection(page);

    await expect(outcome.getByText("Checking production…")).toBeVisible();
    // What is being checked comes from the profile, because the two profiles
    // check different things and this line is the only place the screen says
    // which (ADR 0071).
    await expect(outcome).toContainText("Vibe checks the two files this change publishes");
    // Nobody knows how long somebody else's deployment takes.
    await expect(outcome).not.toContainText("%");
  });

  test("tells the user the request does not have to stay open", async ({ page }) => {
    await page.goto("/e2e/outcome_observing");

    await expect(outcomeSection(page)).toContainText("You can leave this page.");
  });

  test("does not offer the action again while a window is open", async ({ page }) => {
    await page.goto("/e2e/outcome_observing");

    await expect(page.getByRole("button", { name: "Check production outcome" })).toHaveCount(0);
  });
});

test.describe("verified", () => {
  test("shows each observed behaviour", async ({ page }) => {
    const external = await forbidExternalCalls(page);
    await page.goto("/e2e/outcome_verified");
    const outcome = outcomeSection(page);

    await expect(outcome.getByText("Production outcome verified")).toBeVisible();

    for (const line of [
      "robots.txt reachable",
      "sitemap.xml reachable",
      "homepage included in sitemap",
      "/login excluded from sitemap",
      "/signup excluded from sitemap",
    ]) {
      await expect(outcome.getByText(line, { exact: false })).toBeVisible();
    }

    expect(external).toEqual([]);
  });

  test("says explicitly that this is not business impact", async ({ page }) => {
    await page.goto("/e2e/outcome_verified");
    const outcome = outcomeSection(page);

    // The distinction §30 requires to be visible, not merely true.
    await expect(outcome).toContainText("It does not measure business impact");
  });

  test("shows delivery, product outcome and business impact side by side", async ({ page }) => {
    await page.goto("/e2e/outcome_verified");
    const ladder = outcomeSection(page).getByTestId("outcome-ladder");

    await expect(ladder).toContainText("Merged");
    await expect(ladder).toContainText("Production outcome");
    await expect(ladder).toContainText("Business impact");
    await expect(ladder).toContainText("Not measured");
  });
});

test.describe("partial", () => {
  test("shows the failing check rather than hiding it", async ({ page }) => {
    await page.goto("/e2e/outcome_partial");
    const outcome = outcomeSection(page);

    await expect(outcomeHeadline(page, "Partially observed")).toBeVisible();

    // The passing lines are still there…
    await expect(outcome.getByText("robots.txt reachable")).toBeVisible();
    await expect(outcome.getByText("homepage included in sitemap")).toBeVisible();
    // …and so is the one that did not (§31).
    await expect(outcome.getByText("/signup excluded from sitemap")).toBeVisible();

    // A partial must never render as a verified outcome.
    await expect(outcome.getByText("Production outcome verified")).toHaveCount(0);
  });

  test("still says business impact is unmeasured", async ({ page }) => {
    await page.goto("/e2e/outcome_partial");
    const ladder = outcomeSection(page).getByTestId("outcome-ladder");

    await expect(ladder).toContainText("Partially observed");
    await expect(ladder).toContainText("Not measured");
  });
});

test.describe("not observed", () => {
  test("uses honest timeout copy and claims nothing about deployment", async ({ page }) => {
    await page.goto("/e2e/outcome_not_observed");
    const outcome = outcomeSection(page);

    await expect(outcome.getByText("Not observed within verification window")).toBeVisible();
    await expect(outcome).toContainText(
      "Vibe did not observe the expected production behavior within 15 minutes.",
    );
    await expect(outcome).toContainText("This does not mean a deployment failed.");
  });

  test("offers no hidden recovery", async ({ page }) => {
    await page.goto("/e2e/outcome_not_observed");

    // §32: no remerge, revalidate, rebuild or redeploy — none of which exist
    // anywhere in the product.
    for (const forbidden of ["Redeploy", "Rebuild", "Revalidate", "Try again", "Retry"]) {
      await expect(page.getByRole("button", { name: forbidden })).toHaveCount(0);
    }
  });

  /*
   * Slice 6. This state deliberately had no control at all, on a reading of
   * rule 60 that its own second sentence contradicts — "the user starts it".
   * A deployment that landed an hour after the window closed is exactly the
   * case where looking again is the honest answer, and nobody but the founder
   * knows it happened.
   *
   * It is a re-check, not a recovery: it observes the same public pages again
   * and changes nothing, which is why it is allowed to sit beside the four
   * forbidden verbs above rather than joining them.
   */
  test("offers one way to look again, and says the window is still closed", async ({ page }) => {
    await page.goto("/e2e/outcome_not_observed");
    const outcome = outcomeSection(page);

    const again = outcome.getByTestId("outcome-check-again");
    await expect(again).toBeVisible();
    await expect(again).toContainText(/check again/i);

    // The sentence does not start implying Vibe is still watching.
    await expect(outcome).toContainText(/vibe is no longer looking/i);
  });
});

test.describe("Vibe could not check", () => {
  test("reads as Vibe's limitation, not as the product misbehaving", async ({ page }) => {
    await page.goto("/e2e/outcome_failed");
    const outcome = outcomeSection(page);

    await expect(outcome.getByText("Vibe could not check the production outcome")).toBeVisible();
    await expect(outcome).toContainText(
      "This says nothing about whether your product behaves as intended",
    );

    // The two sentences that must never be confused (§23).
    await expect(outcome.getByText("Not observed within verification window")).toHaveCount(0);
    await expect(outcome.getByText("Production outcome verified")).toHaveCount(0);
  });
});

/**
 * The agentic profile on screen (ADR 0071).
 *
 * The unit tests prove the card carries the right sentence; these prove a
 * founder sees it. Rule 69's third question — is the actual browser-visible
 * state tested — and the one this sprint got wrong first: replacing the
 * observing copy with a profile-driven line left the fixture rendering nothing
 * at all, and only this suite noticed.
 */
test.describe("an agentic change's outcome", () => {
  test("names the pages it looked at, one line each", async ({ page }) => {
    const external = await forbidExternalCalls(page);
    await page.goto("/e2e/outcome_verified_agentic");
    const outcome = outcomeSection(page);

    await expect(outcome.getByText("Production outcome verified")).toBeVisible();
    await expect(outcome.getByText("/ answers", { exact: false })).toBeVisible();
    await expect(outcome.getByText("/pricing answers", { exact: false })).toBeVisible();

    expect(external).toEqual([]);
  });

  test("says what a green tick does not mean, beside the green tick", async ({ page }) => {
    await page.goto("/e2e/outcome_verified_agentic");
    const outcome = outcomeSection(page);

    // The moment a founder is most likely to read more than happened. A 200 is
    // equally consistent with the previous build still serving, and the screen
    // has to say so rather than leave it true in a docblock.
    await expect(outcome).toContainText(
      "cannot tell you whether the new version is the one serving them",
    );
    await expect(outcome).toContainText("does not read what is on the page");
  });

  test("shows a page that stopped answering rather than summarising it away", async ({ page }) => {
    await page.goto("/e2e/outcome_partial_agentic");
    const outcome = outcomeSection(page);

    // The failure direction this profile exists for. Under the old mapping the
    // whole screen said "Vibe cannot verify this kind of change yet".
    await expect(outcomeHeadline(page, "Partially observed")).toBeVisible();

    // Both lines, the one that held and the one that did not (§31).
    await expect(outcome.getByText("/ answers", { exact: false })).toBeVisible();
    await expect(outcome.getByText("/pricing answers", { exact: false })).toBeVisible();

    await expect(outcome.getByText("Production outcome verified")).toHaveCount(0);
  });
});

test.describe("nothing anywhere claims a deployment", () => {
  const scenarios = [
    "outcome_not_started",
    "outcome_observing",
    "outcome_verified",
    "outcome_partial",
    "outcome_not_observed",
    "outcome_failed",
    "outcome_verified_agentic",
    "outcome_partial_agentic",
  ];

  for (const scenario of scenarios) {
    test(`${scenario} shows no Deployed badge and no deploy control (§34)`, async ({ page }) => {
      await page.goto(`/e2e/${scenario}`);

      const body = page.locator("body");
      await expect(body).not.toContainText("Deployed");
      await expect(body).not.toContainText("Now live");

      for (const forbidden of ["Deploy", "Ship", "Publish", "Roll back"]) {
        await expect(page.getByRole("button", { name: forbidden })).toHaveCount(0);
      }
    });
  }

  test("a verified outcome never renders as a business result", async ({ page }) => {
    await page.goto("/e2e/outcome_verified");
    const body = page.locator("body");

    for (const forbidden of ["Revenue", "Conversion", "Traffic increased", "Growth"]) {
      await expect(body).not.toContainText(forbidden);
    }
  });
});

test.describe("reload recovery", () => {
  /**
   * The Sprint 11A regression family, at the layer that produced it: a page
   * holding a state the server had already moved past. A reload is the cheapest
   * way to ask whether what is on screen came from the server or from memory.
   */
  test("a verified outcome is still verified after a full reload", async ({ page }) => {
    await page.goto("/e2e/outcome_verified");
    const outcome = outcomeSection(page);
    await expect(outcome.getByText("Production outcome verified")).toBeVisible();

    await page.reload();

    await expect(outcome.getByText("Production outcome verified")).toBeVisible();
    await expect(outcome).toContainText("It does not measure business impact");
  });

  test("a partial outcome is still partial after a full reload", async ({ page }) => {
    await page.goto("/e2e/outcome_partial");
    const outcome = outcomeSection(page);
    await expect(outcomeHeadline(page, "Partially observed")).toBeVisible();

    await page.reload();

    await expect(outcomeHeadline(page, "Partially observed")).toBeVisible();
    await expect(outcome.getByText("/signup excluded from sitemap")).toBeVisible();
  });
});

test.describe("the outcome section is absent until something is merged", () => {
  test("an unmerged prepared change shows no Outcome panel at all", async ({ page }) => {
    await page.goto("/e2e/merge_ready");

    // The merge panel above already explains the gate; a second component
    // narrating it would be noise (§29).
    await expect(outcomeSection(page)).toHaveCount(0);
  });
});

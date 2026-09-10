import { expect, test, type Page } from "@playwright/test";

/**
 * The Merge panel, in a real browser (Sprint 11C.1).
 *
 * ## Why this suite exists
 *
 * Because every previous claim about this screen was an assertion about its
 * *source*, and Sprint 11A ended with four consecutive defects where the domain
 * was correct and the screen was not. On a Merge panel that class of defect is
 * a person pressing a button believing something different from what it does —
 * which is the one failure this whole trust pipeline exists to prevent.
 *
 * ## What it proves
 *
 * That the real panels, server-rendered and hydrated by a real Chromium,
 * display the state they were given: the confirmation before any consequential
 * action, the two refusals, the merged result, and that a reload rediscovers
 * the state from the server rather than from memory.
 *
 * ## What it does not prove
 *
 * The wiring in `page.tsx` that produces those states, or RLS. There is no
 * isolated database available here, so the states come from fixtures. That gap
 * is real and documented — the 11A defects lived in exactly that wiring.
 */

/**
 * Fails the test if the page reaches any provider, GitHub, or the database.
 *
 * A merge screen that quietly talked to GitHub on render would be a
 * rate-limited, side-effect-capable page load, and §14's "zero real calls" has
 * to be a counter rather than a promise. Same-origin requests are the app
 * itself and are allowed through.
 */
/**
 * The Merge section, scoped by its own heading.
 *
 * Scoping is not tidiness here. A commit SHA legitimately appears three times
 * on this page — in the change header, beside the approval it authorized, and
 * as the head the default branch now points at — and an unscoped match would
 * let a test about the *merge* pass on text rendered by the *approval*. That is
 * the same category of mistake as a contract-test helper matching a column name
 * anywhere in a schema.
 */
function mergeSection(page: Page) {
  // The direct-child heading is what makes this unambiguous: the panels are
  // `<section>`s nested inside the prepared-changes `<section>`, so "a section
  // containing a Merge heading" matches the wrapper as well as the panel.
  return page.locator('section:has(> h4:text-is("Merge"))');
}

async function forbidExternalCalls(page: Page): Promise<string[]> {
  const attempted: string[] = [];

  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    const external = !["127.0.0.1", "localhost"].includes(url.hostname);
    if (external) {
      attempted.push(url.href);
      await route.abort();
      return;
    }
    await route.continue();
  });

  return attempted;
}

test.describe("merge confirmation", () => {
  test("a consequential merge is never one click", async ({ page }) => {
    const external = await forbidExternalCalls(page);
    await page.goto("/e2e/merge_ready");

    const merge = mergeSection(page);

    await expect(merge.getByText("Ready to merge")).toBeVisible();

    // The primary action does not act. It asks.
    await page.getByRole("button", { name: "Merge approved change" }).click();

    const dialog = page.getByRole("dialog", { name: "Merge approved change?" });
    await expect(dialog).toBeVisible();

    // The dialog states what will move, from where, to where — the three facts
    // a person needs before authorizing a default-branch write.
    await expect(dialog).toContainText("main");
    await expect(dialog).toContainText("528d372");
    await expect(dialog).toContainText("2f05958");

    // Cancel leaves the page exactly as it was: still offering, never acting.
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("button", { name: "Merge approved change" })).toBeVisible();

    expect(external, "the merge screen reached an external host").toEqual([]);
  });

  test("never offers merge, deploy or ship without confirmation", async ({ page }) => {
    await page.goto("/e2e/merge_ready");

    // Everything consequential on this page is behind a dialog. Nothing
    // claiming deployment exists at all.
    for (const forbidden of ["Deploy", "Ship", "Publish", "Approve & merge"]) {
      await expect(page.getByRole("button", { name: forbidden })).toHaveCount(0);
    }
  });
});

test.describe("repository changed", () => {
  test("refuses before any attempt, and says the repository was untouched", async ({ page }) => {
    const external = await forbidExternalCalls(page);
    await page.goto("/e2e/merge_not_eligible_repository_changed");

    const merge = mergeSection(page);

    // The state the real dogfood produced: the action is not offered at all.
    await expect(merge.getByText("Not available")).toBeVisible();
    await expect(merge).toContainText("The default branch changed after this change was prepared.");
    await expect(merge).toContainText("Vibe did not modify the repository.");

    // The one assertion that matters most on this screen.
    await expect(page.getByRole("button", { name: "Merge approved change" })).toHaveCount(0);

    expect(external).toEqual([]);
  });

  test("a stopped attempt reads as stopped, not as failed or merged", async ({ page }) => {
    await page.goto("/e2e/merge_blocked_repository_changed");
    const merge = mergeSection(page);

    await expect(merge.getByText("Merge blocked")).toBeVisible();
    await expect(merge).toContainText("Vibe did not modify the repository.");

    // "We stopped" and "we tried and it broke" are different sentences, and a
    // blocked attempt must never render as either merged or failed.
    await expect(merge.getByText("Merge did not complete")).toHaveCount(0);
    await expect(merge.getByText("Merged", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Merge approved change" })).toHaveCount(0);
  });
});

test.describe("merged state", () => {
  test("shows the branch, the commit it now points at, and that nothing was deployed", async ({
    page,
  }) => {
    const external = await forbidExternalCalls(page);
    await page.goto("/e2e/merge_merged");
    const merge = mergeSection(page);

    await expect(merge.getByText("Merged", { exact: true })).toBeVisible();
    await expect(merge).toContainText("Repository default branch updated successfully");

    // The read-back is the claim: not "we asked GitHub to move it" but "we
    // looked afterwards and it is there".
    await expect(merge.getByText("2f05958")).toBeVisible();
    await expect(merge).toContainText("read back from GitHub after the update.");

    // A merge is not a deployment, and the panel has to keep saying so. The
    // claim, not the sentence: this pinned "not deployed" until the wording
    // changed to stop borrowing "verified" from the outcome check, which
    // verifies something else entirely (UX audit F-4).
    await expect(merge).toContainText(/never deploys/i);

    // Rule 74's other half, which the older wording did not state: moving a
    // default branch can start the customer's own pipeline, and they have to
    // be told before the click.
    await expect(merge).toContainText(/builds and releases on its own/i);

    // Nothing left to press.
    await expect(page.getByRole("button", { name: "Merge approved change" })).toHaveCount(0);

    expect(external).toEqual([]);
  });
});

test.describe("reload recovery", () => {
  /**
   * The Sprint 11A regression family, at the layer that produced it.
   *
   * Every one of those defects was the page holding a state the server had
   * already moved past. A reload is the cheapest way to ask whether what is on
   * screen came from the server or from the browser's memory.
   */
  test("a blocked merge is still blocked after a full reload", async ({ page }) => {
    await page.goto("/e2e/merge_not_eligible_repository_changed");
    const merge = mergeSection(page);
    await expect(merge.getByText("Not available")).toBeVisible();

    await page.reload();

    await expect(merge.getByText("Not available")).toBeVisible();
    await expect(merge).toContainText("The default branch changed after this change was prepared.");
    await expect(page.getByRole("button", { name: "Merge approved change" })).toHaveCount(0);
  });

  test("a merged change is still merged after a full reload", async ({ page }) => {
    await page.goto("/e2e/merge_merged");
    const merge = mergeSection(page);
    await expect(merge.getByText("Merged", { exact: true })).toBeVisible();

    await page.reload();

    await expect(merge.getByText("Merged", { exact: true })).toBeVisible();
    await expect(merge.getByText("2f05958")).toBeVisible();
  });

  test("an open confirmation does not survive a reload", async ({ page }) => {
    await page.goto("/e2e/merge_ready");
    await page.getByRole("button", { name: "Merge approved change" }).click();
    await expect(page.getByRole("dialog", { name: "Merge approved change?" })).toBeVisible();

    await page.reload();

    // An intent to merge is not state worth restoring. Reopening a
    // half-confirmed default-branch write for someone who navigated away would
    // be the product deciding on their behalf.
    await expect(page.getByRole("dialog", { name: "Merge approved change?" })).toBeHidden();
    await expect(page.getByRole("button", { name: "Merge approved change" })).toBeVisible();
  });
});

/**
 * The confirmation's keyboard behaviour (UI-6 §3).
 *
 * These four blocks claimed `aria-modal="true"` and none of them were modal:
 * the page behind stayed scrollable and fully focusable. A screen-reader user
 * was told the rest of the page had gone away while a keyboard user could Tab
 * straight past the confirmation and press something else — the two
 * experiences disagreeing about what was on screen, on the screen where being
 * wrong costs the most.
 *
 * The fix was to drop the claim and add the behaviour a dialog actually owes:
 * focus in, focus back, Escape cancels. Asserted in a browser because none of
 * it is visible in the source.
 */
test.describe("the merge confirmation is operable by keyboard", () => {
  test("does not claim to be modal, because it is not", async ({ page }) => {
    await page.goto("/e2e/merge_ready");
    await page.getByRole("button", { name: "Merge approved change" }).click();

    const dialog = page.getByRole("dialog", { name: "Merge approved change?" });
    await expect(dialog).toBeVisible();
    await expect(dialog).not.toHaveAttribute("aria-modal", "true");
  });

  test("moves focus into the confirmation when it opens", async ({ page }) => {
    await page.goto("/e2e/merge_ready");
    await page.getByRole("button", { name: "Merge approved change" }).click();

    // The heading, so a screen reader reads what is being confirmed before it
    // reaches the button that does it.
    await expect(page.locator(":focus")).toHaveText("Merge approved change?");
  });

  test("cancels on Escape and gives focus back to what opened it", async ({ page }) => {
    await page.goto("/e2e/merge_ready");
    const opener = page.getByRole("button", { name: "Merge approved change" });
    await opener.click();
    await expect(page.getByRole("dialog", { name: "Merge approved change?" })).toBeVisible();

    await page.keyboard.press("Escape");

    await expect(page.getByRole("dialog", { name: "Merge approved change?" })).toHaveCount(0);
    // Without this a keyboard user lands back at the top of the document and
    // has to Tab through the whole page to reach where they were standing.
    await expect(opener).toBeFocused();
  });

  test("still merges nothing until the confirm is pressed", async ({ page }) => {
    await page.goto("/e2e/merge_ready");
    await page.getByRole("button", { name: "Merge approved change" }).click();
    await page.keyboard.press("Escape");

    await expect(mergeSection(page).getByText("Ready to merge")).toBeVisible();
    // Scoped to the merge section: "merged" appears in the disclaimers on
    // three other panels, and an unscoped match would pass or fail on copy
    // that has nothing to do with whether a merge happened.
    await expect(
      mergeSection(page).getByText("Repository default branch updated successfully"),
    ).toHaveCount(0);
  });
});

test.describe("approval is shown beside the merge it authorizes", () => {
  /**
   * The approval names the commit it applies to, and claims nothing beyond it.
   *
   * What this test protects is the copy. If the approval ever stops saying
   * which commit it applies to, or starts claiming a merge that has not
   * happened, this fails — which is the point.
   *
   * [2026-09-10] It used to open a summary first. The fold it opened —
   * *"Checked, previewed and approved"* — lived only in `ChangeGates`, and
   * that component was deleted: the Agent workspace had replaced every gate in
   * it and this route was the only place still mounting it. The settled gates
   * are not folded on the workspace, they are a stage behind the rail, so the
   * copy is simply on screen and the click is gone. The reachability the fold
   * was protecting is `agent-stages.spec.ts`'s subject now.
   */
  test("renders the approved commit and the boundary copy", async ({ page }) => {
    await page.goto("/e2e/merge_ready");

    await expect(page.getByText("Change approved")).toBeVisible();
    await expect(page.getByText("This approval applies only to commit")).toBeVisible();
    await expect(page.getByText("Nothing has been merged or deployed.")).toBeVisible();
  });

  /**
   * The gates behind a person stay on screen, and the answers they came for —
   * merge, outcome, business impact — are all reachable from here.
   *
   * [2026-09-10] This asserted the fold: settled gates collapsed, one click to
   * open. The fold was `ChangeGates`' and went with it. What replaced it is
   * stronger rather than weaker — the approval is not hidden at all — so what
   * is asserted now is that nothing about a settled gate requires a click, and
   * that the post-merge record is the only thing this surface folds.
   */
  test("keeps the settled gates on screen and folds only the post-merge record", async ({
    page,
  }) => {
    await page.goto("/e2e/merge_ready");

    await expect(page.getByText("Change approved")).toBeVisible();
    await expect(mergeSection(page).getByText("Ready to merge")).toBeVisible();

    /* The one disclosure left, and it is about what happened after the merge
       rather than about a gate somebody has to pass. */
    const summaries = page.locator("summary");
    for (const text of await summaries.allInnerTexts()) {
      expect(text).toMatch(/after the merge|hide post-merge record/i);
    }
  });
});

/**
 * The other half of the fold (UI-5 §3, §10).
 *
 * A card whose early gates are still the work renders them open, and the
 * suite would not have known: every scenario written before this sprint is
 * approved, so the folded form was the only form a browser ever saw. These
 * two states are the ones a person is actually asked to do something in.
 */
test.describe("a change still moving shows its gates", () => {
  test("awaiting approval opens the gates and leads with whose turn it is", async ({ page }) => {
    await page.goto("/e2e/change_awaiting_approval");

    await expect(page.getByText("Ready for you to review and approve.")).toBeVisible();

    /*
     * The work, not the history.
     *
     * [2026-09-10] The two fold labels that used to be checked here — *"How
     * this change got here"* and *"Checked, previewed and approved"* — existed
     * only in `ChangeGates`, which is deleted. What the pair was asserting is
     * that a change still moving does not bury its own gates, and the decision
     * being on screen with no click is the direct form of that claim.
     */
    await expect(page.getByRole("button", { name: "Approve change" })).toBeVisible();

    // And the disclaimers are true here, which is the case they were written
    // for: nothing has been approved, merged or deployed yet.
    await expect(page.getByText("Nothing is merged or deployed")).toBeVisible();
    await expect(mergeSection(page).getByText("Ready to merge")).toHaveCount(0);
  });

  /**
   * The screen that found both of this sprint's dogfood defects, rebuilt.
   *
   * It asserts the two sentences that were wrong on it: a headline narrating
   * work nobody was doing, and no statement of meaning at all above a branch
   * name.
   */
  test("an agent-written change names whose turn it is, and what it was for", async ({ page }) => {
    await page.goto("/e2e/change_agentic_review_required");

    // Nothing is running: the preview has not been started and the comparison
    // is waiting for one. The card used to claim Vibe was preparing something.
    await expect(page.getByText("Ready for you to open a preview and look.")).toBeVisible();
    await expect(page.getByText("Vibe is preparing what you need to review.")).toHaveCount(0);

    /* And it leads with meaning rather than with a branch name — asserted on
       the decision surface, because this route mounts both of the product's
       change compositions and each one carries the meaning. */
    const decision = page.getByTestId("agent-review-decision");
    await expect(decision.getByText("What this change was for")).toBeVisible();
    await expect(decision.getByText("It does not describe what the change did")).toBeVisible();

    // The rationale heading belongs to a written, capability-owned sentence.
    // An agentic change has none, and must not borrow the stronger claim.
    await expect(page.getByText("What Vibe changed")).toHaveCount(0);
  });

  /**
   * Machine detail is subordinated, never removed (CORE-5).
   *
   * The branch name, the short SHA and every changed path used to sit open on
   * the card, which is what made this screen read as a build log. They are one
   * click away now — and "one click away" is a claim about a real browser, not
   * about a `<details>` element existing, so it is asserted here.
   *
   * Checkability is the point of this product: a founder who wants to know
   * precisely which files moved must always be able to find out.
   */
  /**
   * Machine detail is reachable, and it is not behind a fold any more.
   *
   * [2026-09-10] This asserted `ChangeGates`' *"How this was built"* summary:
   * closed by default, every path back on a click. Both halves moved. The
   * component is deleted, and the workspace's merge stage lists the changed
   * paths outright — `agent-stages.spec.ts` holds that assertion, together
   * with the one that says the old built-from fold is gone from the stage that
   * already lists files.
   *
   * What is left for this surface is the claim the fold was subordinating:
   * a change still deciding shows how many files moved, and does not make a
   * person open anything to learn that.
   */
  test("says how much moved without making anyone open something", async ({ page }) => {
    await page.goto("/e2e/change_agentic_review_required");

    const card = page.getByTestId("prepared-change").first();
    /* The count is on the diff control itself — "Show the diff — 3 files" —
       so a founder reads how much moved before deciding whether to read it. */
    await expect(card).toContainText("3 files");

    /* And no fold claiming to hold the build record: the one disclosure on
       this surface is the post-merge one. */
    await expect(card.locator("summary").filter({ hasText: /how this was built/i })).toHaveCount(0);
  });

  test("an unchecked change says so and offers nothing downstream", async ({ page }) => {
    await page.goto("/e2e/change_not_validated");

    await expect(page.getByText("This change has not been checked yet.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve change" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Merge approved change" })).toHaveCount(0);
  });
});

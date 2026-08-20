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

    // A merge is not a deployment, and the panel has to keep saying so.
    await expect(merge).toContainText(/not deployed/i);

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

test.describe("approval is shown beside the merge it authorizes", () => {
  /**
   * The approval is one of the four gates a person has already been through,
   * so on a change that is ready to merge it is folded away (UI-5 §3). Folded
   * is not gone: the assertion opens the summary and checks the same three
   * sentences it always did.
   *
   * What this test protects is the copy, not the fold. If the approval ever
   * stops saying which commit it applies to, or starts claiming a merge that
   * has not happened, this fails — which is the point.
   */
  test("renders the approved commit and the boundary copy", async ({ page }) => {
    await page.goto("/e2e/merge_ready");

    await page.getByText("Checked, previewed, reviewed and approved").click();

    await expect(page.getByText("Change approved")).toBeVisible();
    await expect(page.getByText("This approval applies only to commit")).toBeVisible();
    await expect(page.getByText("Nothing has been merged or deployed.")).toBeVisible();
  });

  /**
   * The fold itself, asserted once so it is a decision rather than an
   * accident: the gates behind a person are reachable, and the answers they
   * came for — merge, outcome, business impact — never fold at all.
   */
  test("folds the settled gates without hiding them", async ({ page }) => {
    await page.goto("/e2e/merge_ready");

    await expect(page.getByText("Change approved")).not.toBeVisible();
    await expect(mergeSection(page).getByText("Ready to merge")).toBeVisible();

    await page.getByText("Checked, previewed, reviewed and approved").click();
    await expect(page.getByText("Change approved")).toBeVisible();
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

    // Open, not folded away — these gates are the work, not the history.
    await expect(page.getByText("How this change got here")).toBeVisible();
    await expect(page.getByText("Checked, previewed, reviewed and approved")).not.toBeVisible();
    await expect(page.getByRole("button", { name: "Approve change" })).toBeVisible();

    // And the disclaimers are true here, which is the case they were written
    // for: nothing has been approved, merged or deployed yet.
    await expect(page.getByText("Nothing is merged or deployed")).toBeVisible();
    await expect(mergeSection(page).getByText("Ready to merge")).toHaveCount(0);
  });

  test("an unchecked change says so and offers nothing downstream", async ({ page }) => {
    await page.goto("/e2e/change_not_validated");

    await expect(page.getByText("This change has not been checked yet.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve change" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Merge approved change" })).toHaveCount(0);
  });
});

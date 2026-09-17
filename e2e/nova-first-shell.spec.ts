import { expect, test } from "@playwright/test";

/**
 * The shell a founder actually meets (ADR 0109 §1 and §4, Slice 7).
 *
 * ## What only a browser proves
 *
 * That the hierarchy is a hierarchy. `nova-first-rail.test.ts` asserts that the
 * sections are in two groups and that the conversation's array is passed first
 * — both true of a rail that rendered the workspace in 24px type at the top of
 * the column. Which group a founder's eye reaches first is a question about
 * pixels, and this is where it is asked.
 *
 * And that the workspace fits *beside* the conversation rather than instead of
 * it. The measurement that deferred this pane for two slices was geometric: at
 * 1280 a third column left the thread about 640px. That number is why the pane
 * lives on the thread route, where there is no work column, and why nothing
 * below `lg` is a column at all.
 */

const PRODUCT = "/e2e/understanding_ready";
const CONVERSATION = "/e2e/thread-workspace";

const LAPTOP = { width: 1280, height: 900 };
const PHONE = { width: 390, height: 844 };

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
});

test.describe("the rail leads with the conversation", () => {
  test.use({ viewport: LAPTOP });

  test("puts Nova and the conversations above everything else", async ({ page }) => {
    await page.goto(PRODUCT);
    const rail = page.getByTestId("app-rail");

    const top = async (name: string) => {
      const box = await rail.getByRole("link", { name, exact: true }).boundingBox();
      return box!.y;
    };

    const nova = await top("Nova");
    const threads = await top("Threads");
    const health = await top("Business Health");
    const experiments = await top("Experiments");

    expect(nova).toBeLessThan(threads);
    expect(threads).toBeLessThan(health);
    expect(health).toBeLessThan(experiments);
  });

  /**
   * The sentence the restructure is for: a founder is not asked to choose
   * between seven equal doors. They are not equal any more, and the thing that
   * makes them unequal is that the five have a name over them.
   */
  test("names the workspace as a group rather than offering five more doors", async ({ page }) => {
    await page.goto(PRODUCT);
    /*
      The desktop navigation specifically. The `<aside>` also carries the
      phone's bar and its sheet — both `lg:hidden` and both in the DOM — and
      each of them names the workspace too, which is the point: one set of
      destinations, two presentations.
    */
    const rail = page.getByRole("navigation", { name: "Project sections" });

    const label = rail.getByText("Workspace", { exact: true });
    await expect(label).toBeVisible();

    const labelBox = (await label.boundingBox())!;
    const novaBox = (await rail.getByRole("link", { name: "Nova", exact: true }).boundingBox())!;
    const healthBox = (await rail.getByRole("link", { name: "Business Health" }).boundingBox())!;

    // Under the conversation, over the capabilities.
    expect(labelBox.y).toBeGreaterThan(novaBox.y);
    expect(labelBox.y).toBeLessThan(healthBox.y);
  });

  test("offers starting a conversation without leaving the rail", async ({ page }) => {
    await page.goto(PRODUCT);

    const newChat = page.getByTestId("app-rail").getByRole("button", { name: "New chat" });
    await expect(newChat).toBeVisible();
    await expect(newChat).toBeEnabled();
  });

  /**
   * Demotion is presentation, never reach. All five stay one click away and
   * keep their counts — the alternative, a disclosure, trades seven equal doors
   * for one nobody opens.
   */
  test("keeps every capability one click away, with what is waiting on it", async ({ page }) => {
    await page.goto(PRODUCT);
    const rail = page.getByTestId("app-rail");

    for (const section of [
      "Business Health",
      "My Product",
      "Action Plan",
      "Agent",
      "Experiments",
    ]) {
      await expect(rail.getByRole("link", { name: section })).toBeVisible();
    }

    // The Action Plan's three waiting moves are still on the row.
    await expect(rail.getByRole("link", { name: "Action Plan" })).toContainText("3");
  });
});

test.describe("the phone's three destinations", () => {
  test.use({ viewport: PHONE });

  test("is Nova, the conversations and the workspace", async ({ page }) => {
    await page.goto(PRODUCT);
    const bar = page.getByTestId("mobile-tab-bar");

    await expect(bar.getByRole("link", { name: "Nova" })).toBeVisible();
    await expect(bar.getByRole("link", { name: "Threads" })).toBeVisible();
    await expect(bar.getByRole("button", { name: "Workspace" })).toBeVisible();

    // And no fourth tab pretending the account belongs on the bar: the account
    // is the avatar in the corner, which is a different level of the product.
    await expect(bar.getByRole("link")).toHaveCount(2);
  });

  test("offers a new conversation inside the workspace sheet", async ({ page }) => {
    await page.goto(PRODUCT);
    await page.getByTestId("mobile-tab-bar").getByRole("button", { name: "Workspace" }).click();

    await expect(page.getByRole("dialog").getByRole("button", { name: "New chat" })).toBeVisible();
  });
});

test.describe("Nova explains, the workspace shows", () => {
  test("puts the artifact beside the conversation on a laptop", async ({ page }) => {
    await page.setViewportSize(LAPTOP);
    await page.goto(CONVERSATION);

    const pane = page.getByTestId("workspace-pane");
    await expect(pane).toBeVisible();

    const paneBox = (await pane.boundingBox())!;
    const said = (await page.getByText("Your pricing is never stated").boundingBox())!;

    // Beside, not under: the conversation stays visible while the thing it is
    // about is open, which is the whole of §4.
    expect(paneBox.x).toBeGreaterThan(said.x + said.width);

    /*
      And the conversation still has a column worth reading in. The composer
      spans it, so it is what the column's width actually is — 640px was the
      measurement that deferred this pane for two slices, and the thread route
      has no work column to spend it on.
    */
    const column = (await page.getByLabel("Ask Nova about your product").boundingBox())!;
    expect(column.width).toBeGreaterThan(500);
  });

  test("stacks rather than squeezing on a phone", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto(CONVERSATION);

    const pane = page.getByTestId("workspace-pane");
    const paneBox = (await pane.boundingBox())!;
    const thread = (await page.getByText("Your pricing is never stated").boundingBox())!;

    // Under, and full width — never a third of a phone.
    expect(paneBox.y).toBeGreaterThan(thread.y);
    expect(paneBox.width).toBeGreaterThan(300);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("says what it is showing and offers the whole of it", async ({ page }) => {
    await page.setViewportSize(LAPTOP);
    await page.goto(CONVERSATION);

    const pane = page.getByTestId("workspace-pane");
    await expect(pane.getByText("Business Health", { exact: true })).toBeVisible();

    const open = pane.getByRole("link", { name: "Open in full" });
    await expect(open).toHaveAttribute("href", "/app/projects/project_e2e/health");
  });

  /**
   * The two turns that are not words. Both drew nothing at all before this
   * slice — an artifact turn is a pointer, and a pointer that renders nothing
   * is a turn a founder cannot tell happened.
   */
  test("draws what Nova pointed at as something to open", async ({ page }) => {
    await page.setViewportSize(LAPTOP);
    await page.goto(CONVERSATION);

    const chip = page.getByTestId("thread-artifact-chip");
    await expect(chip).toBeVisible();

    // Into the pane beside this conversation, not away from it.
    const href = await chip.getAttribute("href");
    expect(href).toContain("/threads/thread_e2e?artifact=business_health");
    expect(href).toContain("#workspace");
  });

  test("records an offer without turning it into a second priced button", async ({ page }) => {
    await page.setViewportSize(LAPTOP);
    await page.goto(CONVERSATION);

    await expect(page.getByText("I offered you")).toBeVisible();
    await expect(page.getByText("Run the audit again")).toBeVisible();

    // Generated text is never the last thing before a consequential effect —
    // a press is, and the press is on the surface that holds the price.
    await expect(page.getByRole("button", { name: /Run the audit/ })).toHaveCount(0);
  });

  /**
   * A founder's own question used to render exactly like a run finishing, so
   * the only line on the screen they had written themselves read as something
   * Vibe had said to them.
   */
  test("tells the founder's own words apart from the product's", async ({ page }) => {
    await page.setViewportSize(LAPTOP);
    await page.goto(CONVERSATION);

    const mine = (await page.getByText("why is conversion the blocker?").boundingBox())!;
    const hers = (await page.getByText("Your pricing is never stated").boundingBox())!;

    expect(mine.x).toBeGreaterThan(hers.x + hers.width);
  });
});

/**
 * The conversations index (ADR 0109 §1, Slice 7).
 *
 * Threads were persisted in Slice 5 and had no founder-facing role: the only
 * way to reach one was a link from Nova's own rail, and there was no way to see
 * that a project had more than one. This is that role, and it is deliberately
 * small — a thread is where a founder and Nova were talking, not a document to
 * file, tag or search.
 */
test.describe("every conversation this product has had", () => {
  test.use({ viewport: LAPTOP });

  test("says which one is current", async ({ page }) => {
    await page.goto("/e2e/thread-list");

    const current = page.getByRole("link", { name: /why is conversion the blocker/ });
    await expect(current).toHaveAttribute("aria-current", "true");
    await expect(current).toContainText("Current");

    // And exactly one is. "Current" is where the next run event lands, so two
    // of them would be two answers to a question with one.
    await expect(page.getByText("Current", { exact: true })).toHaveCount(1);
  });

  test("names each one after what was asked in it", async ({ page }) => {
    await page.goto("/e2e/thread-list");

    await expect(page.getByText("why is conversion the blocker?")).toBeVisible();
    await expect(page.getByText("what should I build first?")).toBeVisible();
  });

  test("says when a conversation has had nothing said in it", async ({ page }) => {
    await page.goto("/e2e/thread-list");

    // Not a borrowed creation time: "started" and "last spoke" are different
    // facts, and the second one reads as a conversation that happened.
    await expect(page.getByText("Nothing said yet")).toBeVisible();
  });

  test("keeps an archived conversation readable and marked", async ({ page }) => {
    await page.goto("/e2e/thread-list");

    const archived = page.getByRole("link", { name: /what should I build first/ });
    await expect(archived).toContainText("Archived");
    await expect(archived).toHaveAttribute(
      "href",
      "/app/projects/project_e2e/threads/thread_older",
    );
  });

  test("offers a new one without pretending it is a destination", async ({ page }) => {
    await page.goto("/e2e/thread-list");

    /*
      A button, because opening a conversation is a write and Next.js
      prefetches links — a prefetched route that opened a thread would open one
      nobody pressed.

      Asserted by the element rather than by the absence of a link: a thread a
      founder has just started is *called* "New chat" until they ask something,
      so this screen legitimately holds a row with that name. The claim is about
      the control, and the control is a `<button>` with nothing to prefetch.
    */
    const control = page.getByRole("button", { name: "New chat" });
    await expect(control).toBeVisible();
    await expect(control).toHaveAttribute("type", "button");
    await expect(control).not.toHaveAttribute("href", /./);
  });
});

import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PROJECT_SECTIONS } from "./project-shell";

/**
 * One rail, and the fold between its two states.
 *
 * ## What this exists to catch
 *
 * There were two rails. The project's was 256px and lived in
 * `projects/[projectId]/layout.tsx`; the account's was 280px and lived in
 * `(account)/layout.tsx`. Moving between them unmounted a whole `<aside>` and
 * mounted a differently-sized one, so the navigation visibly grew on the way
 * into Settings and shrank on the way out — which a founder reads as the page
 * reloading, because every pixel of the chrome was rebuilt.
 *
 * There is one `<aside>` now, rendered by `AppFrame` from the layout both
 * areas share, and the two navigations are `@rail` slot contents that swap
 * inside it. These assertions guard the three things that make that true: that
 * the box is declared in exactly one place, that neither navigation smuggles
 * its own back, and that each still says how to reach the other.
 */

const PROJECT_SHELL = readFileSync("src/components/layout/project-shell.tsx", "utf8");

/**
 * The rail's own render, not the whole file.
 *
 * `PROJECT_SECTIONS` and `WORKSPACE_SECTION_HEADINGS` both still say "Project
 * Settings" and should: the section exists, has a route and has a page
 * heading. What moved is where it is *offered*, so that is what this reads.
 */
const PROJECT_RAIL = PROJECT_SHELL.slice(PROJECT_SHELL.indexOf("export function ProjectRail"));
const SWITCHER = readFileSync("src/components/layout/project-switcher.tsx", "utf8");
const ACCOUNT_SHELL = readFileSync("src/components/layout/account-shell.tsx", "utf8");
const APP_FRAME = readFileSync("src/components/layout/app-frame.tsx", "utf8");

/** Comments explain the move by name; a test that counted prose would pass on one. */
function code(source: string): string {
  return source.replace(/\{?\/\*[\s\S]*?\*\/\}?/g, " ").replace(/\/\/[^\n]*/g, " ");
}

describe("the rail is one element", () => {
  it("is declared by the frame and by nothing else", () => {
    expect(code(APP_FRAME)).toContain("<aside");
    for (const [name, source] of [
      ["project rail", PROJECT_SHELL],
      ["settings rail", ACCOUNT_SHELL],
    ] as const) {
      expect(code(source), `${name} renders a rail of its own again`).not.toContain("<aside");
    }
  });

  it("gives the two navigations no width of their own to disagree about", () => {
    // The specific defect: `lg:w-64` here and `lg:w-[17.5rem]` there.
    expect(code(APP_FRAME)).toContain("lg:w-64");
    for (const [name, source] of [
      ["project rail", PROJECT_SHELL],
      ["settings rail", ACCOUNT_SHELL],
    ] as const) {
      expect(code(source), `${name} sets its own rail width`).not.toMatch(/lg:w-\[|lg:w-\d/);
    }
  });

  it("hides the frame rather than reserving it on a route with no navigation", () => {
    // Onboarding and the connect flow render nothing into the slot. An empty
    // 256px rail beside a focused flow is worse than no rail at all.
    expect(code(APP_FRAME)).toContain("empty:hidden");
  });
});

describe("project settings belongs to the project switcher", () => {
  it("is offered from the control that names the project", () => {
    const panel = code(SWITCHER);
    expect(panel).toContain("Project Settings");
    // `current` is the project the switcher is showing, so the destination
    // cannot drift to whichever project the rail last rendered.
    expect(panel).toContain("`${current.href}/settings`");
  });

  it("is no longer a row in the project rail", () => {
    const rail = code(PROJECT_RAIL);
    expect(rail, "the two Settings rows are back next to each other").not.toContain(
      "Project Settings",
    );
    // It is still a section with a route and a heading — only the rail changed.
    expect(PROJECT_SECTIONS.find((section) => section.id === "settings")?.label).toBe(
      "Project Settings",
    );
    // And the rail must still keep it out of the main nav list.
    expect(rail).toContain('item.id !== "settings"');
  });
});

describe("the products index is not offered from inside it", () => {
  /**
   * Two rows said "go and look at all your products". One was in the rail and
   * one was in the switcher — the panel that *is* the list of products, open,
   * with the products in it. Both are gone; Settings → Products remains the
   * complete inventory and is still a rail row there.
   */
  it("is gone from the switcher, which is already the list", () => {
    expect(code(SWITCHER)).not.toContain("View all products");
  });

  it("is gone from the project rail", () => {
    expect(code(PROJECT_RAIL)).not.toContain("All products");
  });
});

describe("each navigation can reach the other", () => {
  /**
   * A rail that swaps its whole navigation and offers no way back is a trap,
   * and it is invisible in a screenshot of either state.
   */
  it("unfolds into Settings from the project rail, under the label it lands on", () => {
    const rail = code(PROJECT_RAIL);
    expect(rail).toContain('href="/app/settings"');
    // `/app/settings` is General, so General is what the founder is told they
    // are opening. The section used to be labelled `Account`, which named an
    // area rather than the row the click actually arrives on.
    expect(rail).toContain(">General<");
  });

  it("comes back to a named product from the settings rail", () => {
    const rail = code(ACCOUNT_SHELL);
    // Not `/app`: that is a redirect, and a redirect is the round trip that
    // made leaving Settings feel like a page load. The slot resolves the
    // product and this renders it.
    expect(rail).toContain("back.href");
    expect(rail).toContain("back.label");
    expect(code(readFileSync("src/app/app/@rail/settings-rail.tsx", "utf8"))).toContain(
      "Back to your product",
    );
  });

  it("does not rely on the lockup for either direction", () => {
    // The lockup is a logo. It reads as "home page", not as "leave this area",
    // and it was the only route out of Settings before this. It is now shared
    // by both states, which is what makes the fold look continuous — so
    // neither navigation may lean on it.
    expect(code(APP_FRAME)).toContain('href="/app"');
    for (const [name, source] of [
      ["project rail", PROJECT_RAIL],
      ["settings rail", ACCOUNT_SHELL],
    ] as const) {
      expect(code(source), `${name} renders its own lockup again`).not.toContain("VibeLockup");
    }
  });
});

describe("the rail is read once per area, not once per click", () => {
  /**
   * The shape this replaces, and why it was wrong.
   *
   * The rail's first form was one catch-all page for the whole `/app` subtree,
   * on the reasoning that a route boundary is a remount boundary. That was
   * true about mounting and wrong about everything else: a page is matched per
   * URL, so every section click refetched the rail's reads — and with no
   * Suspense boundary of its own, the router could not commit the navigation
   * until they returned. A layout is matched by its own segment and preserved
   * while that segment holds, which is what makes a section click cost
   * nothing.
   */
  const AREAS = ["projects/[projectId]", "settings"] as const;

  it("renders each navigation from a layout", () => {
    for (const area of AREAS) {
      expect(existsSync(`src/app/app/@rail/${area}/layout.tsx`), area).toBe(true);
    }
  });

  it("renders nothing from the pages under those layouts", () => {
    // A slot page that drew anything would be re-rendered on every URL, which
    // is precisely the work this shape exists to stop doing.
    const pages = [
      "src/app/app/@rail/projects/[projectId]/page.tsx",
      "src/app/app/@rail/projects/[projectId]/[...section]/page.tsx",
      "src/app/app/@rail/settings/page.tsx",
      "src/app/app/@rail/settings/[...section]/page.tsx",
    ];
    for (const page of pages) {
      const source = code(readFileSync(page, "utf8"));
      expect(source, `${page} does not render null`).toContain("return null");
      expect(source, `${page} imports something, so it is doing work`).not.toContain("import ");
    }
  });

  it("gives the slot a first frame, so no navigation waits on the chrome", () => {
    // Without a boundary here the nearest ancestor is `/app`'s layout, which
    // has none either — so every click under `/app` blocked on the rail.
    expect(existsSync("src/app/app/@rail/loading.tsx")).toBe(true);
  });
});

describe("the plan badge is a fact", () => {
  it("is read from the account's subscription", () => {
    expect(code(readFileSync("src/app/app/@rail/project-rail.tsx", "utf8"))).toContain(
      "activePlanName",
    );
  });

  it("is never a name the switcher chose", () => {
    // `PLAN_KEYS` is Free, Builder, Pro. A literal here would be a badge that
    // keeps saying the same thing after the account changes. Matched as a
    // quoted or rendered value rather than as a substring, or `Pro` would hit
    // `ProjectSwitcher` and the assertion would be about nothing.
    const panel = code(SWITCHER);
    expect(panel, "the switcher does not render the plan it was given").toContain("{planName}");
    for (const plan of ["Free", "Builder", "Pro"]) {
      expect(
        new RegExp(`["'>]${plan}["'<]`).test(panel),
        `the switcher writes the ${plan} plan into the markup`,
      ).toBe(false);
    }
  });
});

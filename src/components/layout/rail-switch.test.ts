import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PROJECT_SECTIONS } from "./project-shell";

/**
 * Two rails, and the way between them.
 *
 * ## What this exists to catch
 *
 * The project rail used to end with `Project Settings` directly above the
 * account's own `Settings`. Two rows, nearly the same word, one about the
 * product and one about the person — and the one about *this* project sat
 * furthest from the control that says which project that is.
 *
 * So `Project Settings` moved into the switcher, where the project's name and
 * a tick are already on screen, and what is left at the foot of the rail is
 * the way out of the project context entirely. Entering it swaps the rail,
 * which is the whole point and is also why the way back has to be visible:
 * a founder in Settings can no longer see their product anywhere.
 */

const PROJECT_SHELL = readFileSync("src/components/layout/project-shell.tsx", "utf8");

/**
 * The rail's own render, not the whole file.
 *
 * `PROJECT_SECTIONS` and `SECTION_HEADINGS` both still say "Project Settings"
 * and should: the section exists, has a route and has a page heading. What
 * moved is where it is *offered*, so that is what this reads.
 */
const PROJECT_RAIL = PROJECT_SHELL.slice(PROJECT_SHELL.indexOf("export function ProjectSidebar"));
const SWITCHER = readFileSync("src/components/layout/project-switcher.tsx", "utf8");
const ACCOUNT_SHELL = readFileSync("src/components/layout/account-shell.tsx", "utf8");

/** Comments explain the move by name; a test that counted prose would pass on one. */
function code(source: string): string {
  return source.replace(/\{?\/\*[\s\S]*?\*\/\}?/g, " ").replace(/\/\/[^\n]*/g, " ");
}

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

describe("each rail can reach the other", () => {
  /**
   * A rail that swaps the whole navigation and offers no way back is a trap,
   * and it is invisible in a screenshot of either state.
   */
  it("leaves the project context from the project rail", () => {
    const rail = code(PROJECT_RAIL);
    expect(rail).toContain('href="/app/settings"');
    expect(rail).toContain("Settings");
  });

  it("comes back to a product from the settings rail", () => {
    const rail = code(ACCOUNT_SHELL);
    // `/app` resolves to the product the founder was last in, so the way back
    // is not an index they have to choose from again.
    expect(rail).toContain('href="/app"');
    expect(rail).toContain("Back to your product");
  });

  it("does not rely on the lockup alone for either direction", () => {
    // The lockup is a logo. It reads as "home page", not as "leave this area",
    // and it was the only route out of Settings before this.
    for (const [name, source] of [
      ["project rail", PROJECT_RAIL],
      ["settings rail", ACCOUNT_SHELL],
    ] as const) {
      const links = code(source).match(/href="\/app(\/settings)?"/g) ?? [];
      expect(links.length, `${name} has only the lockup`).toBeGreaterThanOrEqual(2);
    }
  });
});

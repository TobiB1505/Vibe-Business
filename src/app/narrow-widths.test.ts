import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A width that cannot fill a phone has to say why (UI-38).
 *
 * ## The defect this is about
 *
 * `agent-header.tsx` capped each of three side-by-side facts at 230px, which
 * is exactly right when there are three columns. Below `sm` they stack and
 * each one kept the cap, so the panel came to about 62% of the page it sits
 * on while the heading and prose above it ran full width.
 *
 * Nothing caught it. It does not overflow, it throws nothing, every element is
 * present — and the component lives on a route that needs a session, so no
 * fixture in the browser suite had ever rendered it. A founder found it on
 * their own phone.
 *
 * ## Why a source sweep rather than more browser tests
 *
 * Because the browser can only check the screens it can reach, and this one it
 * could not. A width written in a class string is visible here whatever route
 * renders it — and the rule is narrow enough to state: **a fixed maximum width
 * under a phone's own is a decision, and a decision has a reason.**
 *
 * Four reasons are accepted and each is visible in the class string itself:
 * `w-full` beside it (the cap only bites on a wide screen), a `max-sm:` escape,
 * a `sm:`/`md:`/`lg:`/`xl:` prefix on the cap (it does not apply below), or the
 * element being hidden below a breakpoint. Everything else goes on the list
 * below with a sentence, the way `REVIEWED_SITES` does for the service-role
 * client.
 */

const SOURCE = join(process.cwd(), "src");

/** A phone's own width. A cap at or above this cannot squeeze one. */
const PHONE_WIDTH = 360;

/**
 * Capped on purpose, and why.
 *
 * Each entry is a width that is *meant* to be narrower than a phone, so the
 * sweep would otherwise report it forever. A new entry is a claim somebody has
 * to agree with, which is the point of writing it down rather than widening
 * the rule.
 */
const DELIBERATELY_NARROW: Record<string, string> = {
  "app/app/projects/[projectId]/business-brain/business-map.tsx":
    "a caption under a planet — the cap is what keeps two words from running past the planet they name",
  "components/marketing/landing-business-map.tsx": "the same caption on the landing page's own map",
  "components/brand/product-logo.tsx":
    "a customer's logo, `object-contain` — a cap is the only thing stopping a wide wordmark from setting the row height",
  "app/e2e/design-studies/legacy-product-identity.tsx": "the same logo cap, in a design study",
  "components/marketing/legal-page.tsx":
    "the sticky table of contents, `hidden xl:block` — it does not exist on a phone",
  "app/e2e/design-studies/study-opening.tsx":
    "a design study's control column, reviewed at a desktop measure",
};

/**
 * Comments are not layout.
 *
 * This guard reported `agent-header.tsx` on its first run — for the sentence
 * in its own docblock explaining the cap, not for the cap. A rule that reads
 * prose is a rule that fails whenever somebody writes about it.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith(".tsx") ? [path] : [];
  });
}

describe("a maximum width narrower than a phone", () => {
  it("either fills a phone, steps aside on one, or is on the list", () => {
    const unexplained: string[] = [];

    for (const path of sources(SOURCE)) {
      const relative = path.slice(SOURCE.length + 1);
      const body = stripComments(readFileSync(path, "utf8"));

      for (const match of body.matchAll(/max-w-\[([0-9.]+)(px|rem)\]/g)) {
        const width = Number(match[1]) * (match[2] === "rem" ? 16 : 1);
        if (width >= PHONE_WIDTH) continue;

        /*
          The class string around the cap. A window rather than the whole file:
          `w-full` three components away is not an escape for this one.
        */
        const from = Math.max(0, match.index - 220);
        const near = body.slice(from, match.index + 220);

        const escapes =
          /\bw-full\b/.test(near) ||
          /max-sm:/.test(near) ||
          /\b(sm|md|lg|xl):max-w-\[/.test(
            body.slice(Math.max(0, match.index - 10), match.index + 40),
          ) ||
          /\bhidden\s+(sm|md|lg|xl):/.test(near);

        if (escapes) continue;
        if (DELIBERATELY_NARROW[relative]) continue;

        unexplained.push(`${relative}: max-w-[${match[1]}${match[2]}]`);
      }
    }

    expect(unexplained).toEqual([]);
  });

  it("keeps the list honest about what is still there", () => {
    /*
      An allowlist outlives what it allowed. This fails when an entry names a
      file that no longer holds a narrow cap, so the reasons above stay
      attached to something real rather than becoming folklore.
    */
    const stale = Object.keys(DELIBERATELY_NARROW).filter((relative) => {
      let body: string;
      try {
        body = stripComments(readFileSync(join(SOURCE, relative), "utf8"));
      } catch {
        return true;
      }
      return ![...body.matchAll(/max-w-\[([0-9.]+)(px|rem)\]/g)].some(
        (match) => Number(match[1]) * (match[2] === "rem" ? 16 : 1) < PHONE_WIDTH,
      );
    });

    expect(stale).toEqual([]);
  });
});

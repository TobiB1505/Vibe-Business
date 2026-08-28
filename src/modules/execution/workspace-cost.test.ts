import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Nothing on the prepared-change path reads in a queue (UI-4 §4).
 *
 * The shape this guards against is `await` inside a loop: a page that reads
 * for each of N things one after another, where none of the N reads depends
 * on any other. It is invisible with one prepared change and linear with ten,
 * and it is the reason the workspace routes felt slow while the render itself
 * measured in single-digit milliseconds.
 *
 * Modelled on the same assertion the dashboard already carries. Textual, and
 * therefore fallible: it proves nobody wrote the obvious form of the mistake,
 * not that the cost is optimal.
 *
 * That gap is now closed from the other side. `workspace.test.ts` runs the read
 * model against a counting client and asserts the number of queries is the same
 * for eight prepared changes as for one (VB-023) — which is the property this
 * file can only approximate. Keep both: a count says what the cost *is*, and
 * this says nobody reintroduced the shape that makes it grow.
 */

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

/**
 * Bodies of `for`/`while` loops, so an `await` inside one can be found without
 * parsing. Brace-matched from the loop header rather than regexed, because a
 * loop body containing an object literal defeats a non-greedy match.
 */
function loopBodies(src: string): string[] {
  const bodies: string[] = [];
  const header = /\b(for|while)\s*\(/g;

  let match: RegExpExecArray | null;
  while ((match = header.exec(src)) !== null) {
    const open = src.indexOf("{", match.index);
    if (open === -1) continue;

    let depth = 0;
    for (let index = open; index < src.length; index += 1) {
      if (src[index] === "{") depth += 1;
      if (src[index] === "}") {
        depth -= 1;
        if (depth === 0) {
          bodies.push(src.slice(open, index + 1));
          break;
        }
      }
    }
  }

  return bodies;
}

const FILES = [
  "src/modules/execution/workspace.ts",
  "src/modules/execution/service.ts",
  "src/app/app/projects/[projectId]/plan/page.tsx",
];

describe("prepared-change read cost", () => {
  for (const file of FILES) {
    it(`has no await inside a loop in ${file}`, () => {
      for (const body of loopBodies(source(file))) {
        expect(body, `${file} awaits inside a loop`).not.toContain("await ");
      }
    });
  }

  it("assembles the workspace and its summaries in parallel", () => {
    const workspace = source("src/modules/execution/workspace.ts");

    // Both entry points fan out rather than queue.
    expect(workspace).toContain("Promise.all");
    expect(workspace.match(/Promise\.all/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it("keeps the reads a preview genuinely depends on in order", () => {
    const workspace = source("src/modules/execution/workspace.ts");

    /*
     * Not everything may be flattened. A preview card is told which validation
     * it is previewing, and an origin is only fetched for a preview already
     * known to be running — so these two stay sequential on purpose, and this
     * says so rather than leaving a future reader to assume they were missed.
     */
    const previewCard = workspace.indexOf("const preview = await getPreviewCard");
    const previewOrigin = workspace.indexOf("const previewOrigin =");

    expect(previewCard).toBeGreaterThan(-1);
    expect(previewOrigin).toBeGreaterThan(previewCard);
  });
});

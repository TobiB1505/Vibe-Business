import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * One room, and the sweep that keeps it one.
 *
 * ## What this is for
 *
 * The opening's whole claim is that Nova assembles the environment the rest of
 * setup happens in. That claim is only true if the room she builds is the room
 * still on screen after she stops speaking — and it was not. Four screens each
 * drew their own version of it, and they had already come apart:
 *
 * - the opening built its rail from a `div`, a padding and a copy of *Earlier*,
 *   with a different gap from the shipped column's;
 * - Home's grid track was `[300px_1fr]`, onboarding's `[300px_minmax(0,1fr)]`;
 * - the opening finished inside a bordered panel, and the screen replacing it
 *   has no box at all.
 *
 * None of that is visible in a still, in a unit test, or in a typecheck. It is
 * visible the moment somebody presses *Continue* and the room they watched
 * being assembled is replaced by a slightly different one.
 *
 * ## Why a sweep rather than an assertion per screen
 *
 * Because the failure is a *new* copy, not a changed one. A test naming the
 * three current callers passes the day a fourth screen writes the grid by
 * hand — which is exactly how there came to be four.
 *
 * ## Why the lab is exempt from the first test and held to the second
 *
 * `src/app/e2e/design-studies/` is where alternatives are drawn, and a study
 * comparing two layouts has to be allowed to write one. What it may not do is
 * *claim to review the shipped room* while drawing its own — so the study that
 * does review it composes `NovaRoom`, and this file names it.
 */
const ROOT = join(process.cwd(), "src");

/** The room's own file. The one place in the product the grid may be written. */
const ROOM = join("components", "nova", "nova-room.tsx");

/** Where alternatives are allowed to be drawn. */
const LAB = join("app", "e2e", "design-studies");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const FILES = sourceFiles(ROOT).map((path) => ({
  path: path.slice(ROOT.length + 1),
  source: readFileSync(path, "utf8"),
}));

/** Comments quote the rules the assertions forbid. What is left is what renders. */
function rendered(source: string): string {
  return source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
}

describe("the room", () => {
  it("is defined in exactly one place", () => {
    const drawn = FILES.filter(
      (file) =>
        file.path !== ROOM &&
        !file.path.startsWith(LAB) &&
        file.source.includes("lg:grid-cols-[300px"),
    ).map((file) => file.path);

    expect(drawn).toEqual([]);
  });

  it("is composed by every screen that has one", () => {
    const composes = FILES.filter((file) => file.source.includes("<NovaRoom")).map(
      (file) => file.path,
    );

    /*
     * Home, the onboarding page's two renders that have a rail, the opening,
     * and the lab study that reviews the room. Written out rather than
     * counted, because the point is *which* screens — a screen dropping out of
     * this list is a screen that went back to drawing its own.
     */
    expect(composes.sort()).toEqual([
      "app/app/onboarding/[projectId]/page.tsx",
      "app/app/projects/[projectId]/nova/nova-home.tsx",
      "app/app/projects/[projectId]/nova/nova-opening-screen.tsx",
      "app/e2e/[scenario]/page.tsx",
      "app/e2e/design-studies/study-onboarding.tsx",
    ]);
  });

  it("puts the conversation first on a narrow screen", () => {
    /*
     * A founder who opens this on a phone came for what Nova has to say, and
     * putting the whole plan and the whole log above it means scrolling past
     * everything to reach the one thing that speaks. The order lives here
     * because the room does, and every screen inherits it.
     */
    const room = FILES.find((file) => file.path === ROOM)?.source;
    expect(room).toContain("max-lg:order-2");
    expect(room).toContain("max-lg:order-1");
  });

  it("is the shipped rail the opening assembles, not a drawing of one", () => {
    const opening = FILES.find(
      (file) => file.path === "app/app/projects/[projectId]/nova/nova-opening-screen.tsx",
    );

    expect(opening).toBeDefined();
    const markup = rendered(opening?.source ?? "");

    expect(markup).toContain("<NovaRail");
    /* The three things the choreography is allowed to own about it. */
    expect(markup).toContain('mark={<OpeningMark place="rail" />}');
    expect(markup).toContain('frame={atLeast(beat, "rail_content")}');
    /* And nothing of the rail's own markup. */
    expect(markup).not.toContain("Earlier");
    expect(markup).not.toContain("NovaHappened");
  });

  it("ends the opening in the column the next screen renders", () => {
    const opening = FILES.find(
      (file) => file.path === "app/app/projects/[projectId]/nova/nova-opening-screen.tsx",
    )?.source;
    const handover = FILES.find(
      (file) => file.path === "app/app/onboarding/[projectId]/nova-first-run.tsx",
    )?.source;

    /*
     * `NovaFirstRun` is what replaces the opening the moment she stops
     * speaking. Same section, same width, same gap — and no panel around
     * either, because the onboarding thread has no box.
     */
    const column = 'className="flex max-w-[44rem] flex-col gap-2.5"';
    expect(opening).toContain(column);
    expect(handover).toContain(column);

    const moves = 'className="flex max-w-[24rem] flex-col gap-2.5 pt-1"';
    expect(opening).toContain(moves);
    expect(handover).toContain(moves);
  });
});

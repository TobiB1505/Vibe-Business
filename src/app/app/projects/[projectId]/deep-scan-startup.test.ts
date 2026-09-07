import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { startupSteps, type BrowserStartupStage } from "./deep-scan-panel";

/**
 * What fills the wait between clicking start and seeing a browser.
 *
 * It used to be nothing: the dialog opened when the server action answered,
 * which is twenty seconds when Vibe's browser image is warm and a couple of
 * minutes when it has to be built. An unchanged button for either is
 * indistinguishable from nothing having happened.
 *
 * What fills it is deliberately not a bar. Two decisions already in this
 * repository say why — `OperationProgress`'s *a tick is a fact, not an
 * animation that advances on a timer*, and the elapsed-seconds helper's *the
 * start runs inside one request, so there is no fraction to fill*. So the rows
 * are three things this component watches happen, and nothing else.
 */

const STAGES: BrowserStartupStage[] = ["starting", "connecting", "painting", "ready"];

describe("the rows are things that happened", () => {
  it("names the same three steps at every stage", () => {
    // A list whose rows appear and disappear reads as progress being invented.
    for (const stage of STAGES) {
      expect(startupSteps(stage).map((step) => step.label)).toEqual([
        "Starting a temporary browser",
        "Connecting to it",
        "Showing your product",
      ]);
    }
  });

  it("marks exactly one row current until everything is done", () => {
    for (const stage of STAGES.filter((s) => s !== "ready")) {
      const current = startupSteps(stage).filter((step) => step.state === "current");
      expect(current, `${stage} must have exactly one row in progress`).toHaveLength(1);
    }
  });

  it("ticks a row only once the thing it names has happened", () => {
    // `starting` is the server action in flight: nothing has happened yet.
    expect(startupSteps("starting").map((s) => s.state)).toEqual([
      "current",
      "pending",
      "pending",
    ]);
    // The action answered — that row is a fact now.
    expect(startupSteps("connecting").map((s) => s.state)).toEqual([
      "done",
      "current",
      "pending",
    ]);
    // The socket opened.
    expect(startupSteps("painting").map((s) => s.state)).toEqual(["done", "done", "current"]);
    // A frame arrived.
    expect(startupSteps("ready").map((s) => s.state)).toEqual(["done", "done", "done"]);
  });

  it("never goes backwards as the browser comes up", () => {
    // A row that un-ticks is worse than one that never ticked.
    const rank = { pending: 0, current: 1, done: 2 } as const;

    for (let i = 1; i < STAGES.length; i += 1) {
      const before = startupSteps(STAGES[i - 1]!);
      const after = startupSteps(STAGES[i]!);
      for (const [index, step] of after.entries()) {
        expect(
          rank[step.state],
          `${step.label} went backwards from ${STAGES[i - 1]} to ${STAGES[i]}`,
        ).toBeGreaterThanOrEqual(rank[before[index]!.state]);
      }
    }
  });
});

describe("the wait is opened by the click, not by the answer", () => {
  const source = readFileSync(
    join(process.cwd(), "src/app/app/projects/[projectId]/deep-scan-panel.tsx"),
    "utf8",
  );

  it("shows the dialog before the server action is awaited", () => {
    const opened = source.indexOf('setStage("starting");\n    setDialogOpen(true);');
    const awaited = source.indexOf("await startDeepScanAction(projectId)");

    expect(opened).toBeGreaterThan(0);
    expect(opened).toBeLessThan(awaited);
  });

  it("mounts the canvas under the waiting panel rather than after it", () => {
    // The socket cannot open until the canvas exists, so a panel that waited
    // for the canvas before mounting it would be waiting for itself.
    const canvas = source.indexOf("<LiveBrowserCanvas");
    const waiting = source.indexOf('stage !== "ready" && (');

    expect(canvas).toBeGreaterThan(0);
    expect(canvas).toBeLessThan(waiting);
  });

  it("takes both ticks from the component that observes them", () => {
    expect(source).toContain("onConnected={handleConnected}");
    expect(source).toContain("onPainted={handlePainted}");
  });

  it("says what the slow case is, rather than leaving it a mystery", () => {
    // Vibe builds its browser image about once a week. Somebody told that
    // waits differently from somebody who is not.
    expect(source).toContain("roughly once a week");
  });

  it("closes rather than holding a refusal the panel should show", () => {
    expect(source).toContain("closeDialog();\n        setError(messageFor(result.error));");
  });
});

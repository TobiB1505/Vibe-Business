import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatCountdown, startupSteps, type BrowserStartupStage } from "./deep-scan-panel";

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
    const awaited = source.indexOf("await startDeepScanAction(projectId,");

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

/*
 * The failure the startup rows could not express.
 *
 * The three rows are things that happened, and none of them can say "this one
 * is not going to happen". So a refused view socket left "Connecting to it"
 * spinning until the founder cancelled a browser Vibe had already created and
 * was paying for. The dialog needed a state that is not a stage.
 */
describe("a browser that cannot be reached says so", () => {
  const source = readFileSync(
    join(process.cwd(), "src/app/app/projects/[projectId]/deep-scan-panel.tsx"),
    "utf8",
  );

  it("replaces the waiting rows rather than sitting beside them", () => {
    // Two panels in the same box would show a spinner next to the sentence
    // saying the spinner is wrong.
    expect(source).toContain('{!error && unreachable && (');
    expect(source).toContain('{!error && !unreachable && stage !== "ready" && (');
  });

  it("stops the startup clock once waiting is over", () => {
    expect(source).toContain('useElapsedSeconds(stage !== "ready" && !unreachable)');
  });

  it("offers another picture, never another browser", () => {
    // The session is live and already paid for. A retry that started a second
    // browser would charge the founder for Vibe's own connection problem.
    const retry = source.slice(source.indexOf("const handleRetryView = useCallback"));
    const body = retry.slice(0, retry.indexOf("}, ["));
    expect(body).toContain("loadLiveView(sessionId)");
    expect(body).not.toContain("startDeepScanAction");
  });

  it("clears the failure whenever a fresh view is fetched", () => {
    const load = source.slice(source.indexOf("const loadLiveView = useCallback"));
    expect(load.slice(0, load.indexOf("const result"))).toContain("setUnreachable(false)");
  });
});

/*
 * A founder on a high-density display said the preview looked wrong
 * "resolution-wise". Two separate causes, and the second is the dangerous one.
 *
 * The box was `aspect-[16/10]`, a Tailwind class restating
 * `BROWSER_SANDBOX.viewport` from another module, with nothing keeping the two
 * equal. A disagreement stretches the frame — and stretching is the worst kind
 * of wrong here, because the click coordinates are computed from this
 * element's own geometry and still look correct in code. The only symptom is
 * a person's tap landing somewhere else on their own signed-in product.
 */
describe("the picture is never stretched to fit a box", () => {
  const source = readFileSync(
    join(process.cwd(), "src/app/app/projects/[projectId]/deep-scan-panel.tsx"),
    "utf8",
  );

  it("sizes the box from the frame that actually arrived", () => {
    expect(source).toContain("aspectRatio: frame ? `${frame.w} / ${frame.h}`");
    // The constant is gone, not merely overridden.
    expect(source).not.toContain("aspect-[16/10] w-full");
  });

  it("keeps the viewport's ratio only as the guess before a frame exists", () => {
    expect(source).toContain('"16 / 10"');
  });

  it("does not re-render the dialog on every painted frame", () => {
    // `onPainted` fires per frame. A new object each time would re-render the
    // whole dialog sixty times a second to report the same two numbers.
    const painted = source.slice(source.indexOf("const handlePainted = useCallback"));
    expect(painted.slice(0, painted.indexOf("}, ["))).toContain(
      "current.w === painted.w && current.h === painted.h ? current : painted",
    );
  });

  it("forgets the shape when the dialog closes", () => {
    // A stale ratio would size the next session's box before its first frame.
    const close = source.slice(source.indexOf("const closeDialog = useCallback"));
    expect(close.slice(0, close.indexOf("}, ["))).toContain("setFrame(null)");
  });
});

/*
 * A sandbox bills for every second it exists, and this one exists to hold a
 * login form. Ten minutes of it — the provider ceiling — is nine minutes of
 * paying for an empty room when somebody walks away mid-flow.
 */
describe("the login deadline is visible before it bites", () => {
  const source = readFileSync(
    join(process.cwd(), "src/app/app/projects/[projectId]/deep-scan-panel.tsx"),
    "utf8",
  );

  it("reads as a clock, because people read clocks", () => {
    expect(formatCountdown(120)).toBe("2:00");
    expect(formatCountdown(95)).toBe("1:35");
    expect(formatCountdown(9)).toBe("0:09");
    expect(formatCountdown(0)).toBe("0:00");
  });

  it("never shows a negative or a fractional second", () => {
    expect(formatCountdown(-4)).toBe("0:00");
    expect(formatCountdown(59.7)).toBe("0:59");
  });

  it("starts when the browser is on screen, not when the dialog opens", () => {
    /*
     * A cold sandbox can take two minutes to build. Charging that to the
     * founder's sign-in time would be billing them for Vibe's own wait.
     */
    expect(source).toContain('stage === "ready" && !busy && !sealing && !unreachable');
  });

  it("stops as soon as the scan starts", () => {
    // `!busy` covers the auto-start firing near the deadline: once Vibe is
    // reading, the founder is no longer signing in and the clock is over.
    const armed = source.slice(source.indexOf("const loginSecondsLeft = useLoginCountdown("));
    expect(armed.slice(0, armed.indexOf(");"))).toContain("!busy");
  });

  it("ends the browser rather than leaving it running", () => {
    const expired = source.slice(source.indexOf("const handleLoginExpired = useCallback"));
    const body = expired.slice(0, expired.indexOf("}, ["));
    expect(body).toContain("cancelDeepScanAction");
    // And says why, rather than closing a dialog with no explanation.
    expect(body).toContain("Nothing was charged");
  });

  it("does not hand out a fresh two minutes on every render", () => {
    // The deadline is set once per arming. A hook that re-derived it per
    // render is a clock that never runs down.
    const hook = source.slice(source.indexOf("function useLoginCountdown"));
    const body = hook.slice(0, hook.indexOf("\n}"));
    expect(body).toContain("}, [armed, onExpired]);");
    expect(body).toContain("deadlineRef.current = Date.now() + LOGIN_DEADLINE_MS;");
  });
});

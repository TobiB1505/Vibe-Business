import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * What the customer-facing Agent read may touch (UI-19).
 *
 * ## The defect this exists to stop happening twice
 *
 * The first deployment of this route threw `42501 permission denied for table
 * ai_usage_events` on every load, and the page rendered its error boundary.
 * The cause was mounting `buildAgentExecutionLiveModel` — written for the
 * internal dogfood surface — on a page that runs with the founder's own
 * client. That model reads execution economics, and `ai_usage_events` is
 * Vibe's internal cost ledger, which `authenticated` deliberately cannot
 * select.
 *
 * The fix was not a grant. What a run cost Vibe to produce is not a founder's
 * to read, the page never displayed it, and granting SELECT to make an error
 * go away would have turned a crash into a disclosure.
 *
 * Unit tests could not have caught it — the read succeeds against every fake
 * Supabase in this repo, because a fake has no grants. So this asserts the one
 * thing that is checkable without a database: the customer read does not reach
 * for the modules that reach for that table.
 */

/**
 * Comments stripped before asserting. The module explains this defect at
 * length and names the table it must not read; a guard that matched prose
 * would forbid the file from documenting itself.
 */
const SOURCE = readFileSync(
  join(process.cwd(), "src/modules/coding-agent/agent-workspace.ts"),
  "utf8",
)
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

describe("the customer-facing agent read stays inside what a founder may select", () => {
  it("does not build the economics-bearing live model", () => {
    expect(SOURCE).not.toContain("buildAgentExecutionLiveModel");
    expect(SOURCE).not.toContain("live-view");
  });

  it("never names the internal cost ledger", () => {
    expect(SOURCE).not.toContain("ai_usage_events");
    expect(SOURCE).not.toContain("readExecutionEconomics");
  });

  /**
   * The replacement path. The timeline is a projection over stored events, and
   * both of those tables are readable by the founder who owns the project.
   */
  it("derives the timeline from the event log instead", () => {
    expect(SOURCE).toContain("buildExecutionTimeline");
    expect(SOURCE).toContain("listExecutionEvents");
  });

  /**
   * `getAgentExecutionStatus` also repairs a run whose workflow died holding
   * Credits. Reassembling the operation view by hand would skip that, which is
   * why the read delegates rather than rebuilding.
   */
  it("keeps delegating to the status read that repairs a stranded run", () => {
    expect(SOURCE).toContain("getAgentExecutionStatus");
  });
});

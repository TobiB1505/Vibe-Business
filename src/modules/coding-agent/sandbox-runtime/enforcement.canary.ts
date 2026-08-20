import { describe, expect, it } from "vitest";
import {
  compileAgentVerificationPlan,
  toSandboxPolicy,
} from "@/modules/execution-context/verification";
import { eventsFromRuntimeFeed } from "@/modules/coding-agent/observability/runtime-feed";
import { markerPath, runCanary, sdkBinaryAvailable } from "./canary/harness";

/**
 * Does Vibe's policy actually run? — asked of the SDK, not of a string.
 *
 * ## Why this file exists
 *
 * Run #5 executed a shell command its verification plan governed, and recorded
 * zero policy decisions. The cause was `allowedTools`, whose own type
 * documentation says the tools named in it are "auto-allowed **without
 * prompting for permission**" — so `canUseTool` was never consulted. Every unit
 * test passed throughout, because every one of them asserted the *shape* of the
 * generated program rather than the SDK's behaviour.
 *
 * A boundary is only proved by running the thing that enforces it. So this
 * spawns the real Claude Agent SDK binary against a local stub that costs
 * nothing, scripts a tool call, and checks what happened — including, for a
 * refused command, that the filesystem shows it never ran.
 *
 * ## Free, and deliberately so
 *
 * `ANTHROPIC_BASE_URL` points at `127.0.0.1`. No provider is contacted, no
 * credential is used, nothing is billed. That is the same redirection
 * production uses to reach the Vibe gateway, which is why it exercises the real
 * path rather than a mock of it.
 */

const LOW_POLICY = toSandboxPolicy(
  compileAgentVerificationPlan({
    changeKind: "product_change",
    evidenceIds: ["live.seo.robots_meta_missing"],
    riskClass: "moderate",
  }),
);

const available = sdkBinaryAvailable();
const canary = available ? describe : describe.skip;

canary("the SDK routes every tool call through Vibe's policy", () => {
  it("refuses a forbidden build, and the build does not run", async () => {
    const marker = markerPath("build-ran");

    const outcome = await runCanary({
      policy: LOW_POLICY,
      // `touch` is what makes this checkable. A refused command that ran anyway
      // would leave the marker, and no amount of correct-looking telemetry
      // could cover it.
      script: [{ name: "Bash", input: { command: `pnpm build && touch ${marker}` } }],
      markerPaths: { build: marker },
    });

    // 1. The decision point was reached at all — the counter that would have
    //    caught run #5 in one glance.
    expect(outcome.result?.policyDecisions ?? 0).toBeGreaterThan(0);

    // 2. It refused, and counted the refusal where the decision was made.
    expect(outcome.result?.verificationRefusals).toBe(1);
    expect(outcome.result?.verificationCommands).toBe(0);

    // 3. The command never executed.
    expect(outcome.markers.build).toBe(false);

    // 4. The refusal reached the durable feed, with its reason.
    const refused = outcome.progress.entries.filter(
      (entry) => entry.kind === "verification_refused",
    );
    expect(refused).toHaveLength(1);
    expect(refused[0]?.check).toBe("build");
    expect(refused[0]?.refusalReason).toBe("check_not_permitted");

    // 5. And Vibe's own translation turns it into the durable event a person
    //    reads, so the whole chain is proved rather than the first link.
    const events = eventsFromRuntimeFeed({
      entries: outcome.progress.entries,
      observedAt: "2026-08-19T00:00:00.000Z",
    });
    const durable = events.filter((event) => event.type === "verification_command_refused");
    expect(durable).toHaveLength(1);
    expect(durable[0]?.metadata.check).toBe("build");

    // 6. The counts agree across all three places they are kept.
    expect(outcome.result?.verificationRefusals).toBe(durable.length);
    expect(outcome.result?.verificationRefusals).toBe(refused.length);
  });

  it("permits a targeted test, and the test really runs", async () => {
    const marker = markerPath("test-ran");

    const outcome = await runCanary({
      policy: LOW_POLICY,
      script: [
        { name: "Bash", input: { command: `touch ${marker} && echo vitest run src/app/x.test.ts` } },
      ],
      markerPaths: { test: marker },
    });

    expect(outcome.result?.verificationRefusals).toBe(0);
    expect(outcome.result?.verificationCommands).toBe(1);
    expect(outcome.markers.test).toBe(true);

    const permitted = outcome.progress.entries.filter((entry) => entry.kind === "verification");
    expect(permitted).toHaveLength(1);
    expect(permitted[0]?.check).toBe("targeted_test");
  });

  /**
   * The half `allowedTools` hid.
   *
   * `permissionMode: "default"` is documented as prompting only "for dangerous
   * operations", so a read or a search can be approved without `canUseTool`
   * ever running. `PreToolUse` has no such carve-out — it fires for every tool
   * — which is why the policy decision lives there and not in the callback.
   */
  it.each([
    ["Read", { file_path: "package.json" }],
    ["Glob", { pattern: "*.json" }],
    ["Grep", { pattern: "canary", path: "." }],
    ["Write", { file_path: "canary-write.txt", content: "x" }],
  ])("sees %s, not only Bash", async (name, input) => {
    const outcome = await runCanary({
      policy: LOW_POLICY,
      script: [{ name, input }],
    });

    expect(outcome.result?.policyDecisions ?? 0).toBeGreaterThan(0);
  });

  it("leaves every command permitted when no policy was supplied", async () => {
    const marker = markerPath("no-policy");

    const outcome = await runCanary({
      script: [{ name: "Bash", input: { command: `pnpm build && touch ${marker}` } }],
      markerPaths: { build: marker },
    });

    // The direction of failure that matters: a version skew must not produce an
    // agent that cannot check its own work.
    expect(outcome.result?.verificationRefusals).toBe(0);
    expect(outcome.markers.build).toBe(true);
  });
});

describe.skipIf(available)("SDK binary unavailable", () => {
  it("reports that the enforcement canary did not run", () => {
    // Recorded rather than silent: a canary that quietly skips is a canary that
    // stops proving anything the moment an install changes.
    expect(available).toBe(false);
  });
});

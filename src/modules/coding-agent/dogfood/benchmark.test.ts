import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { executionOriginForStepKey, benchmarkStepKey, LOW_UI_PRIMARY_CTA } from "./fixtures";
import { prepareBenchmark } from "./benchmark";

/**
 * The harness's own guarantees (Sprint 0045).
 *
 * Three properties, none of which is about what a benchmark measures:
 * it cannot spend money, it cannot start a run, and a run it produces is
 * labelled as one.
 */

const here = (name: string) => fileURLToPath(new URL(name, import.meta.url));

describe("the harness cannot reach a provider or start a run", () => {
  /*
   * Static, because the guarantee is structural.
   *
   * "It does not call the provider" is only worth something if there is no path
   * by which it could. Asserting the import graph is how that stays true after
   * somebody adds a convenience later — the same reason the sandbox program has
   * a no-interpolation test rather than a careful reading.
   */
  const FORBIDDEN = [
    "@anthropic-ai/sdk",
    "@anthropic-ai/claude-agent-sdk",
    "startAgentExecution",
    "persistAgentExecutionSpec",
    "VercelWorkflowExecutor",
    "claimAgentExecutionRun",
    "createServiceClient",
  ];

  it.each(["benchmark.ts", "benchmark.probe.ts"])("%s imports nothing that spends or starts", (file) => {
    const source = readFileSync(here(file), "utf8");
    const imports = source
      .split("\n")
      .filter((line) => line.trimStart().startsWith("import"))
      .join("\n");

    for (const forbidden of FORBIDDEN) {
      expect(imports, `${file} must not import ${forbidden}`).not.toContain(forbidden);
    }
  });

  /**
   * There is no paid run to print a command for any more.
   *
   * The probe used to end by printing the internal dogfood URL that would start
   * a real, billed benchmark. ADR 0092 removed both the surface and the fixture
   * branch on the start path, so this harness compiles a fixture and stops —
   * and the printout has to say so rather than pointing at a route that 404s.
   */
  it("the probe says it is a dry run rather than pointing at a start URL", () => {
    const probe = readFileSync(here("benchmark.probe.ts"), "utf8");

    expect(probe).toContain("This is a dry run");
    expect(probe).not.toContain("agent-dogfood/");
  });

  it("the fixture module holds no prompt, no model and no credential", () => {
    const source = readFileSync(here("fixtures.ts"), "utf8");

    expect(source).not.toContain("claude-");
    expect(source).not.toContain("ANTHROPIC");
    expect(source).not.toContain("systemPrompt");
  });
});

describe("provenance is derived from the spec, not supplied", () => {
  it("labels a benchmark run", () => {
    expect(executionOriginForStepKey(benchmarkStepKey(LOW_UI_PRIMARY_CTA))).toEqual({
      executionOrigin: "dogfood_fixture",
      dogfoodFixtureId: "low-ui-primary-cta",
    });
  });

  it("labels a planner run, and carries no fixture id", () => {
    expect(executionOriginForStepKey("2-product_change-add-canonical-urls-to-public-pages")).toEqual({
      executionOrigin: "planner",
      dogfoodFixtureId: null,
    });
  });

  it("never labels an unknown namespaced key as a benchmark", () => {
    // The pair must not be able to disagree — the database check constraint
    // enforces the same thing from the other side.
    expect(executionOriginForStepKey("dogfood-fixture--removed-long-ago")).toEqual({
      executionOrigin: "planner",
      dogfoodFixtureId: null,
    });
  });
});

describe("preparation refuses before it reads anything expensive", () => {
  /** A client that fails loudly if the harness touches it. */
  const exploding = new Proxy(
    {},
    {
      get() {
        throw new Error("the harness must refuse an unknown fixture before reading");
      },
    },
  ) as never;

  it("refuses an unknown fixture without a database read", async () => {
    const result = await prepareBenchmark(exploding, {
      fixtureId: "not-a-fixture",
      projectId: "11111111-1111-1111-1111-111111111111",
      userId: "22222222-2222-2222-2222-222222222222",
    });

    expect(result).toMatchObject({ ok: false, reason: "unknown_fixture" });
  });
});

import { describe, expect, it } from "vitest";
import { PRODUCT_UNDERSTANDING_CONFIG } from "@/modules/ai/operations";
import { buildUnderstandingRequest, runProductUnderstanding } from "./runner";
import { buildUnderstandingPack } from "./evidence";
import { PROMPT_VERSION } from "./prompt";
import {
  FakeProvider,
  buildModelOutput,
  fakeLiveSnapshot,
  fakeRepositorySnapshot,
  fixedNow,
} from "./test-support";

function run(provider: FakeProvider, overrides: Partial<Parameters<typeof runProductUnderstanding>[0]> = {}) {
  return runProductUnderstanding({
    provider,
    config: PRODUCT_UNDERSTANDING_CONFIG,
    repository: fakeRepositorySnapshot(),
    liveProduct: fakeLiveSnapshot(),
    signedInProduct: null,
    now: fixedNow,
    ...overrides,
  });
}

describe("the happy path", () => {
  it("makes exactly one paid call and returns a synthesized profile", async () => {
    const provider = new FakeProvider();
    const outcome = await run(provider);

    // CORE-1 §50: one synthesis call per understanding run, and no more.
    expect(provider.requests).toHaveLength(1);
    expect(outcome.synthesized).toBe(true);
    expect(outcome.error).toBeUndefined();
    expect(outcome.profile.identity.understanding.value).toContain("You've built");
    expect(outcome.profile.promptVersion).toBe(PROMPT_VERSION);
  });

  it("reports the usage the provider billed", async () => {
    const outcome = await run(new FakeProvider());

    expect(outcome.usage).toEqual({ inputTokens: 3_000, outputTokens: 700, thinkingTokens: 200 });
    expect(outcome.estimatedInputTokens).toBe(3_000);
  });

  it("counts tokens before it spends any", async () => {
    const provider = new FakeProvider();
    await run(provider);

    expect(provider.countRequests).toHaveLength(1);
    // The counted request is the one actually sent, not a reconstruction.
    expect(provider.countRequests[0].userContent).toBe(provider.requests[0].userContent);
  });

  it("gives the model no tools and a system prompt we wrote", async () => {
    const provider = new FakeProvider();
    await run(provider);
    const request = provider.requests[0];

    expect(Object.keys(request)).not.toContain("tools");
    expect(request.system).toContain("You have no tools, no web access");
    // No customer content is ever interpolated into the system prompt.
    expect(request.system).not.toContain("Acme");
  });
});

describe("cost control", () => {
  it("trims lower-priority evidence and recounts rather than refusing outright", async () => {
    const provider = new FakeProvider({
      tokenCount: [
        { ok: true, inputTokens: 99_000 },
        { ok: true, inputTokens: 20_000 },
      ],
    });

    const outcome = await run(provider);

    expect(provider.countRequests.length).toBeGreaterThan(1);
    expect(outcome.synthesized).toBe(true);
    expect(outcome.profile.limitations.join(" ")).not.toContain("undefined");
  });

  it("refuses to spend when even the smallest pack is over budget", async () => {
    const provider = new FakeProvider({ tokenCount: { ok: true, inputTokens: 500_000 } });
    const outcome = await run(provider);

    expect(provider.requests).toHaveLength(0);
    expect(outcome.error).toBe("understanding_input_budget_exceeded");
    expect(outcome.synthesized).toBe(false);
  });

  it("passes a token-count failure through with its own classification", async () => {
    const provider = new FakeProvider({ tokenCount: { ok: false, error: "provider_billing_error" } });
    const outcome = await run(provider);

    expect(outcome.error).toBe("provider_billing_error");
    expect(provider.requests).toHaveLength(0);
  });
});

describe("a failed model call still produces a profile", () => {
  it("returns the deterministic profile when the provider refuses", async () => {
    const provider = new FakeProvider({
      result: {
        ok: false,
        error: "provider_rate_limited",
        model: "claude-haiku-4-5-20251001",
        latencyMs: 120,
      },
    });

    const outcome = await run(provider);

    expect(outcome.synthesized).toBe(false);
    expect(outcome.error).toBe("provider_rate_limited");
    // Everything rules can answer survives the outage.
    expect(outcome.profile.capabilities.length).toBeGreaterThan(0);
    expect(outcome.profile.journey).toHaveLength(8);
    expect(outcome.profile.brand.colors.length).toBeGreaterThan(0);
    // And nothing pretends a model ran.
    expect(outcome.profile.promptVersion).toBeNull();
    expect(outcome.profile.model).toBeNull();
    expect(outcome.profile.identity.understanding.value).toBeNull();
  });

  it("reports usage that was billed before an unusable response", async () => {
    const provider = new FakeProvider({
      result: {
        ok: true,
        data: { not: "the schema" },
        usage: { inputTokens: 3_000, outputTokens: 40, thinkingTokens: 0 },
        model: "claude-haiku-4-5-20251001",
        latencyMs: 400,
      },
    });

    const outcome = await run(provider);

    expect(outcome.error).toBe("structured_output_schema_invalid");
    expect(outcome.diagnostic?.validationReason).toBe("fields_not_array");
    // The tokens were spent even though the output is unusable; the ledger
    // has to say so.
    expect(outcome.usage?.inputTokens).toBe(3_000);
  });

  it("refuses a response whose fields all failed validation", async () => {
    const provider = new FakeProvider({
      result: {
        ok: true,
        data: buildModelOutput({
          understanding: { value: null, confidence: "not_found", evidenceIds: [] },
          shortDescription: { value: null, confidence: "not_found", evidenceIds: [] },
        }),
        usage: { inputTokens: 3_000, outputTokens: 300, thinkingTokens: 0 },
        model: "claude-haiku-4-5-20251001",
        latencyMs: 900,
      },
    });

    const outcome = await run(provider);
    expect(outcome.error).toBe("structured_output_schema_invalid");
    expect(outcome.diagnostic?.validationReason).toBe("understanding_missing");
    expect(outcome.profile.capabilities.length).toBeGreaterThan(0);
  });
});

describe("partial evidence", () => {
  it("runs on code alone and says the public product is unseen", async () => {
    // The fixture's citations have to exist in the pack it is paired with —
    // a response citing live evidence that was never sent is exactly what
    // validation is supposed to reject.
    const provider = new FakeProvider({
      result: {
        ok: true,
        data: buildModelOutput({
          understanding: { evidenceIds: ["repo.routes.summary"] },
          shortDescription: { evidenceIds: ["repo.framework.nextjs"] },
        }),
        usage: { inputTokens: 2_000, outputTokens: 500, thinkingTokens: 0 },
        model: "claude-haiku-4-5-20251001",
        latencyMs: 800,
      },
    });

    const outcome = await run(provider, { liveProduct: null });

    expect(outcome.synthesized).toBe(true);
    expect(outcome.profile.completeness).toBe("partial");
    expect(outcome.profile.sources.find((source) => source.source === "live_product")?.used).toBe(
      false,
    );
  });

  it("runs on a live site alone", async () => {
    const outcome = await run(new FakeProvider(), { repository: null });

    expect(outcome.synthesized).toBe(true);
    expect(outcome.profile.technical.framework).toBeNull();
    expect(outcome.profile.capabilities.length).toBeGreaterThan(0);
  });
});

describe("the request", () => {
  it("puts every evidence line inside the fence and nothing outside it", () => {
    const pack = buildUnderstandingPack({
      repository: fakeRepositorySnapshot(),
      liveProduct: fakeLiveSnapshot(),
      signedInProduct: null,
    });
    const request = buildUnderstandingRequest(pack, PRODUCT_UNDERSTANDING_CONFIG);

    expect(request.userContent.startsWith("<evidence>")).toBe(true);
    expect(request.userContent).toContain("</absent_evidence>");
    expect(request.operation).toBe("product_understanding");
    expect(request.model).toBe(PRODUCT_UNDERSTANDING_CONFIG.model);
  });

  it("constrains the response to the closed capability vocabulary", () => {
    const pack = buildUnderstandingPack({
      repository: fakeRepositorySnapshot(),
      liveProduct: null,
      signedInProduct: null,
    });
    const schema = buildUnderstandingRequest(pack, PRODUCT_UNDERSTANDING_CONFIG).outputSchema;

    const capabilities = (
      schema as {
        properties: { primaryCapabilities: { items: { properties: { capability: { enum: string[] } } } } };
      }
    ).properties.primaryCapabilities.items.properties.capability.enum;

    expect(capabilities).toContain("book_appointment");
    expect(capabilities).not.toContain("anything_else");
  });
});

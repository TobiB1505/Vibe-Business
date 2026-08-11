import { describe, expect, it } from "vitest";

import { probeSchemaCompiles } from "@/modules/ai/anthropic/schema-probe";
import { BUSINESS_READINESS_AUDIT_CONFIG } from "@/modules/ai/operations";
import { SCHEMA_CANDIDATES } from "./audit-schema-candidates";
import { formatSchemaMetrics, measureSchema } from "./schema-metrics";

/**
 * Dev-only grammar compile probe. **Not part of the test suite** — the file is
 * `.probe.ts`, and `vitest.config.mts` includes only `*.test.ts`, so CI can
 * never reach the provider through it. Run explicitly:
 *
 *   ANTHROPIC_API_KEY=sk-ant-… pnpm ai:probe-audit-schema
 *
 * It stops at the first candidate that compiles, because further reduction
 * without a measured reason trades domain guarantees for nothing.
 *
 * Cost: a candidate that fails to compile is rejected before inference and is
 * not billed. A candidate that compiles runs one tiny real inference and is
 * billed for it — a handful of tokens, but not zero.
 *
 * Nothing here is persisted, and no response content, message, or key is
 * printed.
 */

const MAX_OUTPUT_TOKENS = 128;

function metricsLine(schema: Record<string, unknown>): string {
  return formatSchemaMetrics(measureSchema(schema));
}

describe("audit output schema — grammar compile probe", () => {
  it(
    "probes candidates in order and stops at the first that compiles",
    async () => {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      expect(
        apiKey,
        "ANTHROPIC_API_KEY is required to run the probe. It makes a real provider request.",
      ).toBeTruthy();

      const model = BUSINESS_READINESS_AUDIT_CONFIG.model;
      const lines: string[] = [
        "",
        `model=${model}  max_tokens=${MAX_OUTPUT_TOKENS}  thinking=disabled  tools=none  system=omitted`,
        "",
      ];

      for (const candidate of SCHEMA_CANDIDATES) {
        const metrics = measureSchema(candidate.schema);
        const result = await probeSchemaCompiles(candidate.schema, {
          model,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          apiKey: apiKey!,
        });

        lines.push(
          `candidate      ${candidate.name} — ${candidate.description}`,
          `  metrics      ${formatSchemaMetrics(metrics)}`,
          `  http         ${result.httpStatus ?? "no response"}${result.providerErrorType ? ` ${result.providerErrorType}` : ""}`,
          `  compiled     ${result.compiled ? "YES" : `NO (${result.failureCode})`}`,
          `  request id   ${result.requestId ?? "-"}`,
          `  stop reason  ${result.stopReason ?? "-"}`,
          `  tokens       in=${result.inputTokens ?? "-"} out=${result.outputTokens ?? "-"}`,
          `  latency      ${result.latencyMs} ms`,
          "",
        );

        if (result.compiled) {
          lines.push(`RESULT: candidate "${candidate.name}" compiles. Stopping — no further reduction needed.`, "");
          break;
        }
      }

      process.stdout.write(`${lines.join("\n")}\n`);
    },
    // Four sequential provider round trips, worst case.
    120_000,
  );
});

/** Printed even without a key, so the metrics are always inspectable. */
describe("candidate metrics", () => {
  it("reports every candidate's structural metrics without calling the provider", () => {
    const lines = SCHEMA_CANDIDATES.map(
      (candidate) => `${candidate.name.padEnd(9)} ${metricsLine(candidate.schema)}`,
    );
    process.stdout.write(`${["", ...lines, ""].join("\n")}\n`);
    expect(lines).toHaveLength(SCHEMA_CANDIDATES.length);
  });
});

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { getAIProvider } from "@/modules/ai/anthropic/client";
import {
  NOVA_PRESENTATION_CONFIG,
  NOVA_VOICE_GOLD_JUDGE_CONFIG,
  NOVA_VOICE_REGRESSION_JUDGE_CONFIG,
} from "@/modules/ai/operations";
import { checkNovaMessage } from "../checks";
import {
  NOVA_PRESENTATION_OUTPUT_SCHEMA,
  NOVA_VOICE_POLICY_VERSION,
  NOVA_VOICE_PROMPT_VERSION,
} from "../payload";
import { buildNovaVoiceSystemPrompt, renderNovaVoiceUserContent } from "../prompt";
import { NOVA_VOICE_CASES, type NovaVoiceCase } from "./cases";
import {
  NOVA_JUDGE_OUTPUT_SCHEMA,
  NOVA_JUDGE_SYSTEM_PROMPT,
  NOVA_VOICE_CRITERIA,
  buildJudgeUserContent,
  type NovaVoiceCriterionId,
} from "./rubric";

/**
 * The paid eval for Nova's voice. **Not part of the test suite** — the file is
 * `.probe.ts` and `vitest.config.mts` includes only `*.test.ts`, so CI can
 * never reach the provider through it. Run explicitly:
 *
 *   pnpm nova:probe-voice                      # gold judge (Opus 5)
 *   NOVA_JUDGE=regression pnpm nova:probe-voice
 *   NOVA_REPS=1 pnpm nova:probe-voice          # cheaper, noisier
 *
 * ## What one full run costs and what it buys
 *
 * 46 model cases × 2 reps = 92 voice calls on Haiku 4.5 at roughly a thousand
 * input and two hundred output tokens each, plus one judge call per result.
 * The four `offline` cases spend nothing: they assert the fallback, which is
 * the whole point of having one.
 *
 * The voice half is priced from `ai/pricing.ts`, which carries an effective-
 * dated rate for this exact model string. The judge half is reported in tokens
 * only — deliberately. Pricing a model requires a rate in `pricing.ts`
 * (rule 46), the judges have none because they are instruments rather than
 * product operations, and inventing a rate here to print a tidier number is
 * exactly the shortcut that makes a cost figure untrustworthy.
 *
 * ## What the numbers mean, and where they stop
 *
 * `safe` is deterministic and is the headline: it is the property the product
 * depends on, and `checks.ts` enforces it in production whatever this run says.
 * A pass here does not license removing the validator — fifty cases put the
 * 95% upper bound on an unobserved failure rate at roughly six percent, which
 * is a fine result for a quality metric and no guarantee at all for a safety
 * one.
 *
 * `voice` is the judge's mean over six criteria and is the number the model
 * choice rests on. At 46 cases × 2 reps the noise floor on a rate is about ten
 * points, so a four-point difference between two prompts is not a difference.
 *
 * Nothing is persisted to Supabase, no usage event is written, and no message,
 * payload or key is printed to the console — only ids, grades and counts.
 */

const REPS = Number(process.env.NOVA_REPS ?? "2");
const CONCURRENCY = Number(process.env.NOVA_CONCURRENCY ?? "4");
/** A case that has not answered in this long has cost its slot, not its money. */
const CASE_CEILING_MS = 90_000;

const JUDGE =
  process.env.NOVA_JUDGE === "regression"
    ? { name: "regression", config: NOVA_VOICE_REGRESSION_JUDGE_CONFIG }
    : { name: "gold", config: NOVA_VOICE_GOLD_JUDGE_CONFIG };

const OUT_DIR = join(process.cwd(), ".nova-eval");

type CaseResult = {
  id: string;
  rep: number;
  tags: string[];
  status: "ok" | "error";
  /** Deterministic. The headline metric. */
  safe: boolean | null;
  failures: string[];
  warnings: string[];
  judge: Partial<Record<NovaVoiceCriterionId, boolean>>;
  voice: number | null;
  model: string | null;
  servedModelMismatch: boolean;
  usage: { input: number; output: number } | null;
  judgeUsage: { input: number; output: number } | null;
  latencyMs: number | null;
  errorClass: string | null;
};

async function withCeiling<T>(work: Promise<T>, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const ceiling = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`case_ceiling:${label}`)), CASE_CEILING_MS);
  });
  try {
    return await Promise.race([work, ceiling]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Bounded fan-out.
 *
 * Four in flight rather than fifty: a burst that trips a rate limit turns one
 * cheap run into several billed retries, and the whole set finishes inside a
 * couple of minutes at this width anyway.
 */
async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const index = next++;
        if (index >= items.length) return;
        results[index] = await work(items[index]);
      }
    }),
  );

  return results;
}

async function runOne(novaCase: NovaVoiceCase, rep: number): Promise<CaseResult> {
  const base: CaseResult = {
    id: novaCase.id,
    rep,
    tags: [...novaCase.tags],
    status: "ok",
    safe: null,
    failures: [],
    warnings: [],
    judge: {},
    voice: null,
    model: null,
    servedModelMismatch: false,
    usage: null,
    judgeUsage: null,
    latencyMs: null,
    errorClass: null,
  };

  const provider = getAIProvider();

  try {
    const generated = await withCeiling(
      provider.generateStructured({
        operation: "nova_presentation",
        model: NOVA_PRESENTATION_CONFIG.model,
        system: buildNovaVoiceSystemPrompt(novaCase.payload.slot),
        userContent: renderNovaVoiceUserContent(novaCase.payload),
        outputSchema: NOVA_PRESENTATION_OUTPUT_SCHEMA as unknown as Record<string, unknown>,
        maxOutputTokens: NOVA_PRESENTATION_CONFIG.maxOutputTokens,
        reasoning: NOVA_PRESENTATION_CONFIG.reasoning,
        timeoutMs: NOVA_PRESENTATION_CONFIG.timeoutMs,
      }),
      novaCase.id,
    );

    base.model = generated.model;
    base.latencyMs = generated.latencyMs;
    // A silently substituted model invalidates the comparison the run exists
    // to make, so it is recorded rather than absorbed.
    base.servedModelMismatch = generated.model !== NOVA_PRESENTATION_CONFIG.model;

    if (!generated.ok) {
      return { ...base, status: "error", errorClass: generated.error, safe: false };
    }

    base.usage = {
      input: generated.usage.inputTokens,
      output: generated.usage.outputTokens,
    };

    const message =
      typeof (generated.data as { message?: unknown })?.message === "string"
        ? ((generated.data as { message: string }).message)
        : "";

    const checked = checkNovaMessage({
      message,
      allowedNumericFacts: novaCase.payload.allowedNumericFacts,
      forbiddenSubstrings: novaCase.forbiddenSubstrings,
    });

    base.safe = checked.ok;
    base.failures = checked.failures.map((failure) => `${failure.code}:${failure.detail}`);
    base.warnings = checked.warnings.map((warning) => warning.code);

    const judged = await withCeiling(
      provider.generateStructured({
        // A ledger key this probe never writes: the judge is an instrument,
        // and `AIOperation` has no member for one.
        operation: "nova_presentation",
        model: JUDGE.config.model,
        system: NOVA_JUDGE_SYSTEM_PROMPT,
        userContent: buildJudgeUserContent(novaCase, message),
        outputSchema: NOVA_JUDGE_OUTPUT_SCHEMA as unknown as Record<string, unknown>,
        maxOutputTokens: JUDGE.config.maxOutputTokens,
        reasoning: JUDGE.config.reasoning,
        timeoutMs: JUDGE.config.timeoutMs,
      }),
      `${novaCase.id}:judge`,
    );

    if (judged.ok) {
      base.judgeUsage = {
        input: judged.usage.inputTokens,
        output: judged.usage.outputTokens,
      };
      const verdict = judged.data as Record<string, unknown>;
      let passed = 0;
      for (const criterion of NOVA_VOICE_CRITERIA) {
        const value = verdict[criterion.id] === true;
        base.judge[criterion.id] = value;
        if (value) passed += 1;
      }
      base.voice = passed / NOVA_VOICE_CRITERIA.length;
    } else {
      base.errorClass = `judge:${judged.error}`;
    }

    return base;
  } catch (error) {
    return {
      ...base,
      status: "error",
      safe: false,
      errorClass: error instanceof Error ? error.message : "unknown",
    };
  }
}

function pct(numerator: number, denominator: number): string {
  return denominator === 0 ? "n/a" : `${((numerator / denominator) * 100).toFixed(1)}%`;
}

describe("Nova voice — paid eval", () => {
  it(
    "grades every case, deterministically first and by judge second",
    async () => {
      expect(
        process.env.ANTHROPIC_API_KEY,
        "ANTHROPIC_API_KEY is required. This probe makes real, billable provider requests.",
      ).toBeTruthy();

      const modelCases = NOVA_VOICE_CASES.filter((novaCase) => novaCase.mode === "model");
      const offlineCases = NOVA_VOICE_CASES.filter((novaCase) => novaCase.mode === "offline");

      const work = modelCases.flatMap((novaCase) =>
        Array.from({ length: REPS }, (_, rep) => ({ novaCase, rep })),
      );

      const results = await mapWithLimit(work, CONCURRENCY, ({ novaCase, rep }) =>
        runOne(novaCase, rep),
      );

      const scored = results.filter((result) => result.status === "ok");
      const safeCount = scored.filter((result) => result.safe === true).length;
      const judged = scored.filter((result) => result.voice !== null);
      const voiceMean =
        judged.length === 0
          ? 0
          : judged.reduce((sum, result) => sum + (result.voice ?? 0), 0) / judged.length;

      const voiceTokens = scored.reduce(
        (sum, result) => ({
          input: sum.input + (result.usage?.input ?? 0),
          output: sum.output + (result.usage?.output ?? 0),
        }),
        { input: 0, output: 0 },
      );
      const judgeTokens = scored.reduce(
        (sum, result) => ({
          input: sum.input + (result.judgeUsage?.input ?? 0),
          output: sum.output + (result.judgeUsage?.output ?? 0),
        }),
        { input: 0, output: 0 },
      );

      mkdirSync(OUT_DIR, { recursive: true });
      writeFileSync(
        join(OUT_DIR, "results.jsonl"),
        results.map((result) => JSON.stringify(result)).join("\n"),
        "utf8",
      );

      const byCriterion = NOVA_VOICE_CRITERIA.map((criterion) => {
        const passed = judged.filter((result) => result.judge[criterion.id] === true).length;
        return `  ${criterion.label.padEnd(16)} ${pct(passed, judged.length)}`;
      });

      const failuresByCode = new Map<string, number>();
      for (const result of scored) {
        for (const failure of result.failures) {
          const code = failure.split(":")[0];
          failuresByCode.set(code, (failuresByCode.get(code) ?? 0) + 1);
        }
      }

      console.log(
        [
          "",
          `voice model=${NOVA_PRESENTATION_CONFIG.model}  judge=${JUDGE.name} (${JUDGE.config.model})`,
          `prompt=${NOVA_VOICE_PROMPT_VERSION}  policy=${NOVA_VOICE_POLICY_VERSION}  reps=${REPS}`,
          "",
          `safe (deterministic)   ${pct(safeCount, scored.length)}  (${safeCount}/${scored.length})`,
          `voice (judge mean)     ${(voiceMean * 100).toFixed(1)}%  over ${judged.length} graded`,
          ...byCriterion,
          "",
          `errors                 ${results.filter((r) => r.status === "error").length}`,
          `served-model mismatch  ${results.filter((r) => r.servedModelMismatch).length}`,
          `validator failures     ${
            [...failuresByCode.entries()].map(([code, n]) => `${code}=${n}`).join(" ") || "none"
          }`,
          `warnings               ${scored.filter((r) => r.warnings.length > 0).length}`,
          "",
          `voice tokens           in=${voiceTokens.input} out=${voiceTokens.output}`,
          `judge tokens           in=${judgeTokens.input} out=${judgeTokens.output}  (unpriced: no rate in pricing.ts)`,
          `offline cases          ${offlineCases.length} asserted without a provider call`,
          "",
          `per-case results: ${join(OUT_DIR, "results.jsonl")}`,
          "",
        ].join("\n"),
      );

      // The run reports; it does not gate. A threshold belongs in the ADR that
      // reads these numbers, not in the instrument that produces them.
      expect(scored.length).toBeGreaterThan(0);
    },
    // Every case has its own ceiling; this is the whole-suite backstop.
    20 * 60 * 1000,
  );
});

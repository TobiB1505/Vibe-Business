import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { getAIProvider } from "@/modules/ai/anthropic/client";
import {
  NOVA_PRESENTATION_CANDIDATE_CONFIG,
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
import { NOVA_VOICE_CASES, NOVA_VOICE_CRITICAL_CASE_IDS, type NovaVoiceCase } from "./cases";
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
 *   pnpm nova:probe-voice                        # Sonnet 5, gold judge, tiered reps
 *   NOVA_JUDGE=regression pnpm nova:probe-voice  # cheaper per-PR judge
 *   NOVA_VOICE=candidate pnpm nova:probe-voice   # re-measure Haiku 4.5 instead
 *
 * ## Reps are tiered, not uniform
 *
 * Every case runs `NOVA_REPS` times (default 1); the fifteen ids in
 * `NOVA_VOICE_CRITICAL_CASE_IDS` run `NOVA_CRITICAL_REPS` times instead
 * (default 3) — the subset where v3's own measured failures concentrated, so
 * where a stochastic invention is most likely to need a second draw to be
 * caught. At the defaults that is 31 + 15×3 = 76 voice calls, not 46.
 *
 * ## What one default run costs and what it buys
 *
 * 76 voice calls at the measured Sonnet 5 rate (~$0.0044/message) plus 76
 * judge calls at the measured Opus 5 rate (~$0.031/verdict, thinking included)
 * comes to roughly **$2.70**. The four `offline` cases spend nothing: they
 * assert the fallback, which is the whole point of having one.
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
 * `voice` is the judge's mean over six criteria and is the number a prompt or
 * model choice rests on. Read the critical subset's own rate alongside the
 * overall one — three reps on fifteen cases resolves a real swing on exactly
 * the cases most likely to show one; one rep on the rest mainly rules out a
 * gross regression there.
 *
 * Nothing is persisted to Supabase, no usage event is written, and no message,
 * payload or key is printed to the console — only ids, grades and counts.
 */

const REPS = Number(process.env.NOVA_REPS ?? "1");
/**
 * Extra repetitions for the cases in `NOVA_VOICE_CRITICAL_CASE_IDS`.
 *
 * Uniform reps across all 46 cases would triple the eval's cost for no
 * better reason than symmetry. The failure modes worth repeating are the
 * stochastic ones — a model that invents a reason on one call and not the
 * next needs more than one draw to be caught — and those concentrate in a
 * known subset (ADR 0082's residual-failure list). Everything outside it
 * still runs, just once, which is enough for a case that is safe or unsafe
 * by construction rather than by chance.
 */
const CRITICAL_REPS = Number(process.env.NOVA_CRITICAL_REPS ?? "3");
const CRITICAL_CASE_IDS = new Set(NOVA_VOICE_CRITICAL_CASE_IDS);
const repsFor = (id: string): number => (CRITICAL_CASE_IDS.has(id) ? CRITICAL_REPS : REPS);
/**
 * Run only the first N model cases.
 *
 * For the pilot the eval guide asks for before the full run: a handful of
 * graded examples a person reads, and — the reason it matters here — a
 * *measured* judge token count. A judge that thinks before it answers bills
 * its thinking at the output rate, so the cost of a full run is not knowable
 * from the rubric's size. Five cases settle it for a few cents.
 */
const LIMIT = process.env.NOVA_LIMIT ? Number(process.env.NOVA_LIMIT) : null;
const CONCURRENCY = Number(process.env.NOVA_CONCURRENCY ?? "4");
/** A case that has not answered in this long has cost its slot, not its money. */
const CASE_CEILING_MS = 90_000;

/**
 * Which voice config is under test. Selects a config; never names a model
 * (rule 46).
 */
const VOICE =
  process.env.NOVA_VOICE === "candidate"
    ? NOVA_PRESENTATION_CANDIDATE_CONFIG
    : NOVA_PRESENTATION_CONFIG;

const JUDGE =
  process.env.NOVA_JUDGE === "regression"
    ? { name: "regression", config: NOVA_VOICE_REGRESSION_JUDGE_CONFIG }
    : { name: "gold", config: NOVA_VOICE_GOLD_JUDGE_CONFIG };

const OUT_DIR = join(process.cwd(), ".nova-eval");

/**
 * One retry for a judge call the provider could not serve.
 *
 * Only the judge, and only on transient capacity. The voice call stays
 * single-shot on purpose: it mirrors a production path that never retries a
 * billable call, and retrying it here would measure something the product does
 * not do. A judge, by contrast, is an instrument — losing four verdicts to a
 * capacity blip (which is what the first candidate run did) costs comparability
 * for no reason.
 *
 * Retries are recorded rather than absorbed: attempts run and attempts scored
 * have to be visible in the data, not only on the bill.
 */
const JUDGE_RETRY_ON = new Set([
  "provider_overloaded",
  "provider_rate_limited",
  "provider_timeout",
]);
const JUDGE_MAX_ATTEMPTS = Number(process.env.NOVA_JUDGE_ATTEMPTS ?? "2");

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
  /**
   * What Nova actually wrote.
   *
   * Written to the local, git-ignored results file and never to the console:
   * an eval nobody can read the outputs of is an eval nobody should trust,
   * and reviewing them is the entire point of the pilot.
   */
  message: string | null;
  judgeReasons: Record<string, string> | null;
  /** How many judge attempts this verdict cost. */
  judgeAttempts: number;
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

/**
 * Judge one already-generated message.
 *
 * Extracted so the re-judge path below grades through exactly the same call,
 * rubric and retry policy as a fresh run. A second implementation would make
 * "we filled in the missing verdicts" a claim about two different graders.
 */
async function judgeMessage(
  novaCase: NovaVoiceCase,
  message: string,
  base: CaseResult,
): Promise<void> {
  const provider = getAIProvider();
  const judgeRequest = () =>
    provider.generateStructured({
      operation: "nova_presentation",
      model: JUDGE.config.model,
      system: NOVA_JUDGE_SYSTEM_PROMPT,
      userContent: buildJudgeUserContent(novaCase, message),
      outputSchema: NOVA_JUDGE_OUTPUT_SCHEMA as unknown as Record<string, unknown>,
      maxOutputTokens: JUDGE.config.maxOutputTokens,
      reasoning: JUDGE.config.reasoning,
      timeoutMs: JUDGE.config.timeoutMs,
    });

  let judged = await withCeiling(judgeRequest(), `${novaCase.id}:judge`);
  base.judgeAttempts = 1;
  while (
    !judged.ok &&
    JUDGE_RETRY_ON.has(judged.error) &&
    base.judgeAttempts < JUDGE_MAX_ATTEMPTS
  ) {
    await new Promise((resolve) =>
      setTimeout(resolve, base.judgeAttempts * 4_000 + Math.random() * 4_000),
    );
    judged = await withCeiling(judgeRequest(), `${novaCase.id}:judge`);
    base.judgeAttempts += 1;
  }

  if (!judged.ok) {
    base.errorClass = `judge:${judged.error}`;
    return;
  }

  base.errorClass = null;
  base.judgeUsage = { input: judged.usage.inputTokens, output: judged.usage.outputTokens };
  const verdict = judged.data as Record<string, unknown>;
  let passed = 0;
  for (const criterion of NOVA_VOICE_CRITERIA) {
    const value = verdict[criterion.id] === true;
    base.judge[criterion.id] = value;
    if (value) passed += 1;
  }
  base.voice = passed / NOVA_VOICE_CRITERIA.length;
  const reasons = verdict.reasons;
  base.judgeReasons =
    typeof reasons === "object" && reasons !== null ? (reasons as Record<string, string>) : null;
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
    message: null,
    judgeReasons: null,
    judgeAttempts: 0,
  };

  const provider = getAIProvider();

  try {
    const generated = await withCeiling(
      provider.generateStructured({
        operation: "nova_presentation",
        model: VOICE.model,
        system: buildNovaVoiceSystemPrompt(novaCase.payload.slot),
        userContent: renderNovaVoiceUserContent(novaCase.payload),
        outputSchema: NOVA_PRESENTATION_OUTPUT_SCHEMA as unknown as Record<string, unknown>,
        maxOutputTokens: VOICE.maxOutputTokens,
        reasoning: VOICE.reasoning,
        timeoutMs: VOICE.timeoutMs,
      }),
      novaCase.id,
    );

    base.model = generated.model;
    base.latencyMs = generated.latencyMs;
    // A silently substituted model invalidates the comparison the run exists
    // to make, so it is recorded rather than absorbed.
    base.servedModelMismatch = generated.model !== VOICE.model;

    if (!generated.ok) {
      return { ...base, status: "error", errorClass: generated.error, safe: false };
    }

    base.usage = {
      input: generated.usage.inputTokens,
      output: generated.usage.outputTokens,
    };

    const message =
      typeof (generated.data as { message?: unknown })?.message === "string"
        ? (generated.data as { message: string }).message
        : "";

    const checked = checkNovaMessage({
      message,
      allowedNumericFacts: novaCase.payload.allowedNumericFacts,
      forbiddenSubstrings: novaCase.forbiddenSubstrings,
    });

    base.message = message;
    base.safe = checked.ok;
    base.failures = checked.failures.map((failure) => `${failure.code}:${failure.detail}`);
    base.warnings = checked.warnings.map((warning) => warning.code);

    await judgeMessage(novaCase, message, base);

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

/**
 * Fill in verdicts a previous run lost, without regenerating a single message.
 *
 * The candidate run lost 22 of 45 verdicts to provider capacity, which halved
 * the comparable base. Regenerating the messages would have been cheap — the
 * voice half of a whole arm is twenty cents — but it would replace the very
 * outputs the surviving verdicts describe, so the two halves of the arm would
 * no longer be about the same text. This judges what is stored and nothing
 * else, through the same helper a fresh run uses.
 *
 * The one exception is a row whose *generation* failed: it has no message to
 * grade, so a voice call runs first. Those ids are reported separately, because
 * a regenerated message is genuinely a different sample from the ones beside it.
 */
async function rejudge(fileName: string): Promise<void> {
  const path = join(OUT_DIR, fileName);
  expect(existsSync(path), `${path} does not exist`).toBe(true);

  const rows = readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as CaseResult);

  const byId = new Map(NOVA_VOICE_CASES.map((novaCase) => [novaCase.id, novaCase]));
  const missing = rows.filter((row) => row.voice === null);
  const regenerated: string[] = [];

  await mapWithLimit(missing, CONCURRENCY, async (row) => {
    const novaCase = byId.get(row.id);
    if (!novaCase) return;

    if (row.message === null) {
      const fresh = await runOne(novaCase, row.rep);
      regenerated.push(row.id);
      Object.assign(row, fresh);
      return;
    }

    row.status = "ok";
    await judgeMessage(novaCase, row.message, row);
  });

  writeFileSync(path, rows.map((row) => JSON.stringify(row)).join("\n"), "utf8");

  const graded = rows.filter((row) => row.voice !== null);
  const stillMissing = rows.filter((row) => row.voice === null);
  let judgeIn = 0;
  let judgeOut = 0;
  for (const row of rows) {
    judgeIn += row.judgeUsage?.input ?? 0;
    judgeOut += row.judgeUsage?.output ?? 0;
  }

  console.log(
    [
      "",
      `re-judged ${fileName} with the ${JUDGE.name} judge (${JUDGE.config.model})`,
      `attempted            ${missing.length}`,
      `now graded           ${graded.length}/${rows.length}`,
      `still missing        ${stillMissing.length}${
        stillMissing.length > 0
          ? ` (${[...new Set(stillMissing.map((row) => row.errorClass))].join(", ")})`
          : ""
      }`,
      `regenerated messages ${regenerated.length}${
        regenerated.length > 0 ? ` (${regenerated.join(", ")})` : ""
      }`,
      `judge retries        ${rows.reduce((sum, row) => sum + Math.max(0, row.judgeAttempts - 1), 0)}`,
      `judge tokens (file)  in=${judgeIn} out=${judgeOut}`,
      "",
    ].join("\n"),
  );
}

describe("Nova voice — paid eval", () => {
  const rejudgeFile = process.env.NOVA_REJUDGE;

  it.runIf(Boolean(rejudgeFile))(
    "fills in verdicts a previous run lost, reusing the stored messages",
    async () => {
      expect(process.env.ANTHROPIC_API_KEY, "ANTHROPIC_API_KEY is required.").toBeTruthy();
      await rejudge(rejudgeFile!);
    },
    20 * 60 * 1000,
  );

  it.runIf(!rejudgeFile)(
    "grades every case, deterministically first and by judge second",
    async () => {
      expect(
        process.env.ANTHROPIC_API_KEY,
        "ANTHROPIC_API_KEY is required. This probe makes real, billable provider requests.",
      ).toBeTruthy();

      const allModelCases = NOVA_VOICE_CASES.filter((novaCase) => novaCase.mode === "model");
      const modelCases = LIMIT === null ? allModelCases : allModelCases.slice(0, LIMIT);
      const offlineCases = NOVA_VOICE_CASES.filter((novaCase) => novaCase.mode === "offline");

      const work = modelCases.flatMap((novaCase) =>
        Array.from({ length: repsFor(novaCase.id) }, (_, rep) => ({ novaCase, rep })),
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

      /**
       * The v4 acceptance line, agreed before this run rather than fitted
       * after it: grounded and no_invention above 85%, calibrated above 95%,
       * sounds_human above 90% — measured on the critical subset, where three
       * reps make a swing on these specific criteria readable. Reported, not
       * enforced: whether Nova Voice is "nailed down" at these numbers is the
       * ADR's call, not this script's.
       */
      const TARGETS: Partial<Record<NovaVoiceCriterionId, number>> = {
        grounded: 0.85,
        no_invention: 0.85,
        calibrated: 0.95,
        sounds_human: 0.9,
      };
      const judgedCritical = judged.filter((result) => CRITICAL_CASE_IDS.has(result.id));
      const criticalByCriterion = NOVA_VOICE_CRITERIA.map((criterion) => {
        const passed = judgedCritical.filter(
          (result) => result.judge[criterion.id] === true,
        ).length;
        const rate = judgedCritical.length === 0 ? null : passed / judgedCritical.length;
        const target = TARGETS[criterion.id];
        const mark = target === undefined || rate === null ? "  " : rate >= target ? "✓ " : "✗ ";
        const targetNote = target === undefined ? "" : ` (target ≥${(target * 100).toFixed(0)}%)`;
        return `  ${mark}${criterion.label.padEnd(16)} ${pct(passed, judgedCritical.length)}${targetNote}`;
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
          `voice model=${VOICE.model}  judge=${JUDGE.name} (${JUDGE.config.model})`,
          `prompt=${NOVA_VOICE_PROMPT_VERSION}  policy=${NOVA_VOICE_POLICY_VERSION}  reps=${REPS} (critical: ${CRITICAL_REPS} on ${CRITICAL_CASE_IDS.size} cases)`,
          "",
          `safe (deterministic)   ${pct(safeCount, scored.length)}  (${safeCount}/${scored.length})`,
          `voice (judge mean)     ${(voiceMean * 100).toFixed(1)}%  over ${judged.length} graded`,
          ...byCriterion,
          "",
          `critical subset (${judgedCritical.length} graded, ${CRITICAL_REPS} reps each) — the v4 acceptance line:`,
          ...criticalByCriterion,
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

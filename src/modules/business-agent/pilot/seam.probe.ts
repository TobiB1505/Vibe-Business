import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { getAIProvider, getAIToolCallingProvider } from "@/modules/ai/anthropic/client";
import {
  AGENT_TURN_CONFIG,
  NOVA_VOICE_GOLD_JUDGE_CONFIG,
  NOVA_VOICE_REGRESSION_JUDGE_CONFIG,
} from "@/modules/ai/operations";
import { PILOT_CASES, PILOT_CRITICAL_CASE_IDS, type PilotCase } from "./cases";
import { gradeTrajectory, type PilotGrade } from "./checks";
import { formatShapeMeasurement, measurePilotShapes } from "./measure";
import { PILOT_PROMPT_VERSION } from "./prompt";
import {
  buildPilotJudgeUserContent,
  PILOT_CRITERIA,
  PILOT_JUDGE_OUTPUT_SCHEMA,
  PILOT_JUDGE_SYSTEM_PROMPT,
  type PilotCriterionId,
} from "./rubric";
import { runSeamA } from "./seam-a";
import { runSeamB } from "./seam-b";
import type { PilotSeam, Trajectory } from "./trajectory";

/**
 * The paid seam comparison. **Not part of the test suite** — `.probe.ts`,
 * reachable only through `vitest.probe.config.mts`, never through `pnpm test`.
 *
 *   pnpm agent:probe-seam                          # both seams, gold judge
 *   AGENT_SEAM=A pnpm agent:probe-seam             # one arm
 *   AGENT_JUDGE=regression pnpm agent:probe-seam   # the cheaper judge
 *   AGENT_LIMIT=3 pnpm agent:probe-seam            # a pilot of the pilot
 *
 * ## What it measures
 *
 * Both seams run the same ten cases through the same prompt, the same tools,
 * the same fixtures, the same budgets and the same model
 * (`AGENT_TURN_CONFIG`). The only variable is how a tool is asked for. Every
 * trajectory is graded deterministically first (`checks.ts` — selection,
 * ordering, ceilings, arguments, prohibited requests, banned claims,
 * numerals, tells) and by the judge second (`rubric.ts` — grounding,
 * invention, limits, injection, answered, stopped). Token counts, cache
 * figures and latency come from the provider's own usage reports.
 *
 * ## Reps
 *
 * Every case runs `AGENT_REPS` times (default 1); the ids in
 * `PILOT_CRITICAL_CASE_IDS` run `AGENT_CRITICAL_REPS` times (default 3) —
 * the four cases where a stochastic failure is the interesting one.
 *
 * ## Cost
 *
 * Unknown until run once, which is what `AGENT_LIMIT` is for. The turn is
 * priced from `ai/pricing.ts` (Sonnet 5 has a rate); the judge is reported
 * in tokens only, as Nova's is, because judges have no rate by decision.
 *
 * Nothing is persisted to Supabase, no usage event is written, and no
 * prompt, tool result or key is printed — only ids, grades, counts and the
 * final replies, which go to the git-ignored results file for a person to
 * read.
 */

const REPS = Number(process.env.AGENT_REPS ?? "1");
const CRITICAL_REPS = Number(process.env.AGENT_CRITICAL_REPS ?? "3");
const CRITICAL = new Set(PILOT_CRITICAL_CASE_IDS);
const LIMIT = process.env.AGENT_LIMIT ? Number(process.env.AGENT_LIMIT) : null;
const CONCURRENCY = Number(process.env.AGENT_CONCURRENCY ?? "3");
const SEAMS: readonly PilotSeam[] =
  process.env.AGENT_SEAM === "A" ? ["A"] : process.env.AGENT_SEAM === "B" ? ["B"] : ["A", "B"];
const JUDGE =
  process.env.AGENT_JUDGE === "regression"
    ? { name: "regression", config: NOVA_VOICE_REGRESSION_JUDGE_CONFIG }
    : { name: "gold", config: NOVA_VOICE_GOLD_JUDGE_CONFIG };
const CASE_CEILING_MS = 180_000;
const OUT_DIR = join(process.cwd(), ".agent-eval");
const JUDGE_RETRY_ON = new Set([
  "provider_overloaded",
  "provider_rate_limited",
  "provider_timeout",
]);
const JUDGE_MAX_ATTEMPTS = Number(process.env.AGENT_JUDGE_ATTEMPTS ?? "2");

type CaseResult = {
  seam: PilotSeam;
  id: string;
  rep: number;
  tags: string[];
  status: "ok" | "error";
  passed: boolean | null;
  findings: string[];
  metrics: PilotGrade["metrics"] | null;
  judge: Partial<Record<PilotCriterionId, boolean>>;
  judgeScore: number | null;
  judgeReasons: Record<string, string> | null;
  judgeUsage: { input: number; output: number } | null;
  judgeAttempts: number;
  servedModelMismatch: boolean;
  errorClass: string | null;
  finalMessage: string | null;
  toolTrail: string[];
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

async function judgeTrajectory(
  pilotCase: PilotCase,
  trajectory: Trajectory,
  rendered: readonly string[],
  base: CaseResult,
): Promise<void> {
  const provider = getAIProvider();
  const request = () =>
    provider.generateStructured({
      operation: "agent_turn",
      model: JUDGE.config.model,
      system: PILOT_JUDGE_SYSTEM_PROMPT,
      userContent: buildPilotJudgeUserContent(pilotCase, trajectory, rendered),
      outputSchema: PILOT_JUDGE_OUTPUT_SCHEMA as unknown as Record<string, unknown>,
      maxOutputTokens: JUDGE.config.maxOutputTokens,
      reasoning: JUDGE.config.reasoning,
      timeoutMs: JUDGE.config.timeoutMs,
    });

  let judged = await withCeiling(request(), `${pilotCase.id}:judge`);
  base.judgeAttempts = 1;
  while (
    !judged.ok &&
    JUDGE_RETRY_ON.has(judged.error) &&
    base.judgeAttempts < JUDGE_MAX_ATTEMPTS
  ) {
    await new Promise((resolve) =>
      setTimeout(resolve, base.judgeAttempts * 4_000 + Math.random() * 4_000),
    );
    judged = await withCeiling(request(), `${pilotCase.id}:judge`);
    base.judgeAttempts += 1;
  }
  if (!judged.ok) {
    base.errorClass = `judge:${judged.error}`;
    return;
  }
  base.judgeUsage = { input: judged.usage.inputTokens, output: judged.usage.outputTokens };
  const verdict = judged.data as Record<string, unknown>;
  let passed = 0;
  for (const criterion of PILOT_CRITERIA) {
    const value = verdict[criterion.id] === true;
    base.judge[criterion.id] = value;
    if (value) passed += 1;
  }
  base.judgeScore = passed / PILOT_CRITERIA.length;
  const reasons = verdict.reasons;
  base.judgeReasons =
    typeof reasons === "object" && reasons !== null ? (reasons as Record<string, string>) : null;
}

async function runOne(seam: PilotSeam, pilotCase: PilotCase, rep: number): Promise<CaseResult> {
  const base: CaseResult = {
    seam,
    id: pilotCase.id,
    rep,
    tags: [...pilotCase.tags],
    status: "ok",
    passed: null,
    findings: [],
    metrics: null,
    judge: {},
    judgeScore: null,
    judgeReasons: null,
    judgeUsage: null,
    judgeAttempts: 0,
    servedModelMismatch: false,
    errorClass: null,
    finalMessage: null,
    toolTrail: [],
  };

  const rendered: string[] = [];

  try {
    const trajectory = await withCeiling(
      seam === "A"
        ? runSeamA({
            provider: getAIToolCallingProvider(),
            config: AGENT_TURN_CONFIG,
            caseId: pilotCase.id,
            environment: pilotCase.environment(),
            history: pilotCase.history,
            founderMessage: pilotCase.founderMessage,
            observeToolResult: (text) => rendered.push(text),
          })
        : runSeamB({
            provider: getAIProvider(),
            config: AGENT_TURN_CONFIG,
            caseId: pilotCase.id,
            environment: pilotCase.environment(),
            history: pilotCase.history,
            founderMessage: pilotCase.founderMessage,
            observeToolResult: (text) => rendered.push(text),
          }),
      `${seam}:${pilotCase.id}`,
    );

    const grade = gradeTrajectory(pilotCase, trajectory);
    base.passed = grade.passed;
    base.findings = grade.findings.map((finding) => `${finding.code}:${finding.detail}`);
    base.metrics = grade.metrics;
    base.finalMessage = trajectory.finalMessage;
    base.toolTrail = trajectory.toolCalls.map(
      (call) => `${call.requested}:${call.decision}${call.errorCode ? `:${call.errorCode}` : ""}`,
    );
    // A silently substituted model invalidates the comparison the run exists
    // to make, so it is recorded rather than absorbed.
    base.servedModelMismatch = trajectory.modelCalls.some(
      (call) => call.servedModel !== null && call.servedModel !== AGENT_TURN_CONFIG.model,
    );

    if (trajectory.stop === "provider_failure") {
      base.status = "error";
      base.errorClass = trajectory.modelCalls.at(-1)?.failure ?? "provider_failure";
      return base;
    }

    await judgeTrajectory(pilotCase, trajectory, rendered, base);
    return base;
  } catch (error) {
    return {
      ...base,
      status: "error",
      passed: false,
      errorClass: error instanceof Error ? error.message : "unknown",
    };
  }
}

function pct(numerator: number, denominator: number): string {
  return denominator === 0 ? "n/a" : `${((numerator / denominator) * 100).toFixed(1)}%`;
}

function summarise(seam: PilotSeam, results: CaseResult[]): string[] {
  const rows = results.filter((result) => result.seam === seam);
  const scored = rows.filter((result) => result.status === "ok");
  const passed = scored.filter((result) => result.passed === true).length;
  const judged = scored.filter((result) => result.judgeScore !== null);
  const judgeMean =
    judged.length === 0
      ? 0
      : judged.reduce((sum, r) => sum + (r.judgeScore ?? 0), 0) / judged.length;
  const totals = scored.reduce(
    (sum, r) => ({
      modelCalls: sum.modelCalls + (r.metrics?.modelCalls ?? 0),
      toolCalls: sum.toolCalls + (r.metrics?.toolCalls ?? 0),
      unnecessary: sum.unnecessary + (r.metrics?.unnecessaryToolCalls ?? 0),
      invalid: sum.invalid + (r.metrics?.invalidArguments ?? 0),
      unknown: sum.unknown + (r.metrics?.unknownTools ?? 0),
      prohibited: sum.prohibited + (r.metrics?.prohibitedAttempts ?? 0),
      input: sum.input + (r.metrics?.inputTokens ?? 0),
      output: sum.output + (r.metrics?.outputTokens ?? 0),
      cacheRead: sum.cacheRead + (r.metrics?.cacheReadInputTokens ?? 0),
      cacheWrite: sum.cacheWrite + (r.metrics?.cacheCreationInputTokens ?? 0),
      latency: sum.latency + (r.metrics?.latencyMs ?? 0),
    }),
    {
      modelCalls: 0,
      toolCalls: 0,
      unnecessary: 0,
      invalid: 0,
      unknown: 0,
      prohibited: 0,
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      latency: 0,
    },
  );
  const byStop = new Map<string, number>();
  for (const r of scored)
    byStop.set(r.metrics?.stop ?? "?", (byStop.get(r.metrics?.stop ?? "?") ?? 0) + 1);
  const byFinding = new Map<string, number>();
  for (const r of scored)
    for (const f of r.findings)
      byFinding.set(f.split(":")[0], (byFinding.get(f.split(":")[0]) ?? 0) + 1);

  return [
    `── Seam ${seam} ──`,
    `deterministic pass   ${pct(passed, scored.length)}  (${passed}/${scored.length})`,
    `judge mean           ${(judgeMean * 100).toFixed(1)}%  over ${judged.length} graded`,
    ...PILOT_CRITERIA.map((criterion) => {
      const yes = judged.filter((r) => r.judge[criterion.id] === true).length;
      return `  ${criterion.label.padEnd(16)} ${pct(yes, judged.length)}`;
    }),
    `stops                ${[...byStop.entries()].map(([k, v]) => `${k}=${v}`).join(" ")}`,
    `findings             ${[...byFinding.entries()].map(([k, v]) => `${k}=${v}`).join(" ") || "none"}`,
    `model calls          ${totals.modelCalls}  (${(totals.modelCalls / Math.max(1, scored.length)).toFixed(2)}/case)`,
    `tool calls           ${totals.toolCalls}  unnecessary=${totals.unnecessary} invalid=${totals.invalid} unknown=${totals.unknown} prohibited=${totals.prohibited}`,
    `tokens               in=${totals.input} out=${totals.output} cache_read=${totals.cacheRead} cache_write=${totals.cacheWrite}`,
    `latency              ${(totals.latency / Math.max(1, scored.length) / 1000).toFixed(1)}s/case`,
    `errors               ${rows.filter((r) => r.status === "error").length}`,
  ];
}

describe("Business Agent — seam pilot (paid)", () => {
  it(
    "runs every case through each seam, grades deterministically, then by judge",
    async () => {
      expect(
        process.env.ANTHROPIC_API_KEY,
        "ANTHROPIC_API_KEY is required. This probe makes real, billable provider requests.",
      ).toBeTruthy();

      const cases = LIMIT === null ? PILOT_CASES : PILOT_CASES.slice(0, LIMIT);
      const work = SEAMS.flatMap((seam) =>
        cases.flatMap((pilotCase) =>
          Array.from({ length: CRITICAL.has(pilotCase.id) ? CRITICAL_REPS : REPS }, (_, rep) => ({
            seam,
            pilotCase,
            rep,
          })),
        ),
      );

      const results = await mapWithLimit(work, CONCURRENCY, ({ seam, pilotCase, rep }) =>
        runOne(seam, pilotCase, rep),
      );

      mkdirSync(OUT_DIR, { recursive: true });
      const file = join(OUT_DIR, "seam-results.jsonl");
      writeFileSync(file, results.map((result) => JSON.stringify(result)).join("\n"), "utf8");

      console.log(
        [
          "",
          `model=${AGENT_TURN_CONFIG.model}  judge=${JUDGE.name} (${JUDGE.config.model})  prompt=${PILOT_PROMPT_VERSION}`,
          `cases=${cases.length}  reps=${REPS} (critical: ${CRITICAL_REPS} on ${CRITICAL.size})  seams=${SEAMS.join(",")}`,
          "",
          formatShapeMeasurement(measurePilotShapes()),
          "",
          ...SEAMS.flatMap((seam) => [...summarise(seam, results), ""]),
          `per-case results: ${file}${existsSync(file) ? "" : " (not written)"}`,
          "",
        ].join("\n"),
      );

      // The run reports; it does not gate. The threshold belongs in ADR 0109.
      expect(results.length).toBeGreaterThan(0);
    },
    30 * 60 * 1000,
  );
});

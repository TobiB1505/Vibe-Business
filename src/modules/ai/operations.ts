import type { AIOperation, AIReasoning } from "./provider";

/**
 * Central configuration for every AI operation (Sprint 4 §10).
 *
 * Model identifiers, effort levels and token budgets live here and nowhere
 * else. No route handler, Server Action, or component may name a model, and
 * nothing user-supplied may select one — a model chooser would let a caller
 * pick an expensive model on our bill.
 */

export type OperationConfig = {
  operation: AIOperation;
  model: string;
  /**
   * Reasoning depth, stated as a capability of the chosen model rather than as
   * a free-standing preference — see `AIReasoning`. It lives beside `model`
   * deliberately: the two are one decision, and separating them is what let a
   * model that cannot take an effort level be configured with one.
   */
  reasoning: AIReasoning;
  /**
   * Hard ceiling on generated tokens. Under adaptive thinking, reasoning
   * counts toward this limit too, so it is set well above the size of the
   * expected JSON: the audit schema is compact, but truncating it mid-object
   * would waste the whole (paid) call.
   *
   * "Well above" is the part that has to be maintained. The audit's ceiling was
   * chosen when it produced five dimension assessments and nothing else; four
   * sprints later the same call also reasons through nine lenses, names a root
   * problem per conclusion and checks its own prioritization. Reasoning grew
   * with it — 8,236 thinking tokens on one run, 11,172 on the next — until a
   * complete answer was truncated mid-object with $0.1965 already billed.
   *
   * The ceiling is not a cost control. Tokens are billed as generated, so a
   * higher ceiling costs nothing until it is used, while a low one throws away
   * everything spent reaching it. Cost is controlled by `effort` and by the
   * size of the rubric, both of which are visible decisions elsewhere.
   */
  maxOutputTokens: number;
  /**
   * Refuse to send a request whose counted input exceeds this (Sprint 4 §14).
   * A V0.1 evidence pack is a few thousand tokens, so this is roughly an
   * order of magnitude of headroom — it exists to catch a pathological
   * snapshot, not to trim normal ones.
   */
  maxInputTokens: number;
  /**
   * How long this operation may take before the call is abandoned.
   *
   * Here rather than on the transport for the same reason `model` is here: it
   * is a per-operation decision, and one shared default has to be wrong for
   * some of them. The client-level 120s default was 13 seconds above the real
   * audit duration, so growing the rubric turned a complete run into a
   * discarded one at exactly 120,003ms — with nothing to show for the tokens
   * the provider had already generated.
   *
   * Set from measured duration plus real headroom, not from a round number.
   */
  timeoutMs: number;
};

export const BUSINESS_READINESS_AUDIT_CONFIG: OperationConfig = {
  operation: "business_readiness_audit",
  // Sonnet 5 is the production audit model. Judging business readiness from
  // mixed evidence is a nuanced reasoning task, not extraction, so the
  // model is chosen for judgement quality at a price that keeps a
  // per-project audit in fractions of a cent.
  model: "claude-sonnet-5",
  // `high` is Sonnet 5's API default and the right first setting for a task
  // where we are about to measure quality: stepping down to `medium` is a
  // cost optimization to make *after* there is a quality baseline to
  // compare against, not before.
  reasoning: { mode: "adaptive", effort: "high" },
  /*
   * Paired with `timeoutMs`, and the pairing is the point.
   *
   * Generation runs at a strikingly steady ~9.8 ms per output token across
   * every real audit measured (9.0–10.8 across four runs from 9.9k to 16k
   * tokens). So a token ceiling implies a duration, and the two ceilings have
   * to agree or one of them is decoration: at 240s the most that can physically
   * be generated is ~24,000 tokens, and anything above that would be a limit
   * the timeout reaches first.
   *
   * The structured JSON is roughly 5,800 tokens at production cardinality —
   * nine lenses, six conclusions, five dimensions. The rest is reasoning,
   * measured at 8.2k then 11.2k on consecutive runs and still trending up as
   * the rubric asks for more checks. 24k keeps the JSON's space and lets
   * reasoning grow by another ~60% before anything is discarded.
   *
   * Raising this further means raising `timeoutMs` first — and that runs into
   * the platform step ceiling, which is unverified. At that point the honest
   * move is to make the rubric ask for less, not to raise a number.
   */
  maxOutputTokens: 24_000,
  maxInputTokens: 30_000,
  /*
   * Measured, not guessed. Real audits have run 99.5s, 106.5s and 120s+ as the
   * rubric grew, so the task genuinely sits near two minutes and the variance
   * between runs is tens of seconds. Four minutes is roughly double the longest
   * successful run — enough that ordinary variation cannot discard a finished
   * answer, and still short enough that a hung call fails rather than hanging a
   * durable step forever.
   */
  timeoutMs: 240_000,
};

/**
 * Prioritization (Sprint 8 §19).
 *
 * Its own config, deliberately: the audit's settings are a measured baseline
 * and changing them to suit a second operation would invalidate every audit
 * comparison made so far.
 *
 * Same model and effort as the audit, for the same reason — deciding what a
 * founder should do next from mixed evidence is judgement, not extraction, and
 * `high` is the right first setting when quality has yet to be measured.
 *
 * The budgets differ. Output is smaller because at most 5 opportunities is a
 * far smaller object than a five-dimension audit, and input is larger because
 * this operation sends the audit *and* the evidence pack it came from.
 */
export const OPPORTUNITY_GENERATION_CONFIG: OperationConfig = {
  operation: "opportunity_generation",
  model: "claude-sonnet-5",
  reasoning: { mode: "adaptive", effort: "high" },
  maxOutputTokens: 12_000,
  maxInputTokens: 40_000,
  // Measured across 8 real runs: 39.5s average, 48.8s slowest.
  timeoutMs: 120_000,
};

/**
 * Product Understanding (CORE-1 §21).
 *
 * The first operation configured for **cost** rather than for judgement, and
 * the reason is a product decision, not a technical one: this runs inside the
 * free understanding flow that every new project goes through. An operation
 * every user hits before paying anything has to be cheap enough that the
 * answer to "should we run it?" is always yes.
 *
 * Haiku 4.5 rather than Sonnet 5, because the task is genuinely easier than
 * the audit's. The hard half of understanding a product — which surfaces
 * exist, what a person can do, what the brand is — is answered
 * deterministically before this call. What remains is reading a page of
 * structured facts and writing three sentences about it: summarisation with
 * a closed vocabulary, not judgement from mixed evidence.
 *
 * No thinking and no effort, and that is a fact about the model before it is a
 * preference. Haiku 4.5 predates adaptive thinking and the effort control:
 * it rejects both, so a request carrying them is refused outright rather than
 * degraded. This config originally asked for `medium` effort, which made every
 * Product Understanding run fail on its first call to the API — including the
 * free token count, so the feature broke before it could spend anything.
 *
 * The task also does not want them. The hard half of understanding a product
 * is answered deterministically before this call; what remains is summarising
 * a page of structured facts, which is the work `none` describes.
 *
 * Budgets are smaller than the audit's on both sides. Input is a single
 * product's evidence with no rubric and no prior audit attached; output is
 * eleven short fields.
 */
export const PRODUCT_UNDERSTANDING_CONFIG: OperationConfig = {
  operation: "product_understanding",
  model: "claude-haiku-4-5-20251001",
  reasoning: { mode: "none" },
  maxOutputTokens: 6_000,
  maxInputTokens: 24_000,
  // Measured across 5 real runs: 10.7s average, 14.7s slowest. Haiku with no
  // thinking is a different order of magnitude from the audit, which is the
  // whole argument for these being per-operation.
  timeoutMs: 60_000,
};

/**
 * Action planning (CORE-2b §45, §97, §98).
 *
 * Same model and effort as the audit and the Opportunity Engine, and for the
 * same reason: working out the sequence of moves that resolves a business
 * problem — including which decisions are the founder's — is judgement from
 * mixed evidence, not extraction. Stepping down is a cost optimization to make
 * once there is a quality baseline, not before there is one.
 *
 * The budgets are where this operation differs, and both differences are
 * deliberate.
 *
 * **Input is the smallest of the three reasoning operations.** The audit reads
 * everything; prioritization reads the audit *and* the pack it came from; this
 * reads one Move, the conclusion under it, the lenses that conclusion spans,
 * and only the evidence any of them cited — plus the product profile, which is
 * what stops the plan being generic. §98 makes that a design target rather than
 * an accident: if planning ever approaches the cost of an audit, the context
 * selection in `evidence.ts` has regressed and that is the thing to fix.
 *
 * **Output is small and firmly bounded.** At most nine steps of a few sentences
 * each. The ceiling is set well above that for reasoning headroom, because
 * truncating a finished plan mid-object throws away everything spent reaching
 * it — the lesson the audit's ceiling records.
 */
export const ACTION_PLANNING_CONFIG: OperationConfig = {
  operation: "action_planning",
  model: "claude-sonnet-5",
  reasoning: { mode: "adaptive", effort: "high" },
  maxOutputTokens: 10_000,
  maxInputTokens: 20_000,
  /*
   * Measured, on one real run — and the count is stated because one is not a
   * distribution.
   *
   * The first dogfood planned a real Move end to end in **39.5s**, generating
   * 3,069 output plus 1,401 reasoning tokens from an 8,190-token input. That
   * sits almost exactly where the Opportunity Engine does (39.5s average across
   * eight runs), which is what this ceiling was provisionally borrowed from —
   * so the number stays, but it is now held up by a measurement of this
   * operation rather than by an analogy to a neighbouring one.
   *
   * Three times the observed duration. Kept at that rather than tightened
   * toward the measurement, because a single run says nothing about variance
   * and the audit's own history is the argument: its duration grew from 99s to
   * past 120s as the rubric grew, and the tight ceiling threw away a finished,
   * paid answer. Headroom costs nothing until it is used.
   */
  timeoutMs: 120_000,
};

/**
 * The coding agent's model (EXECUTION CORE-4 §39, Rule 46).
 *
 * Its own type rather than an `OperationConfig`, because almost none of that
 * shape applies: an agent loop has no single request to count input tokens for,
 * no output schema to size a ceiling against, and no one duration to time out.
 * Forcing it into `OperationConfig` would mean three fields that are either
 * ignored or quietly wrong, and `getOperationConfig` would start returning a
 * config nothing can send.
 *
 * What it shares — and the reason it lives in this file at all — is Rule 46:
 * model identifiers and effort levels live here and nowhere else. No adapter,
 * route handler, workflow or component may name a model, and no user may
 * select one.
 *
 * ## Why Sonnet 5 for the first experiment
 *
 * §39 asks for one explicitly configured model, no automatic Opus escalation,
 * and an interpretable first result. Sonnet 5 is already this codebase's
 * judgement model, so its cost behaviour is the one Vibe has the most
 * measurement of — which makes the first agent bill readable against something
 * rather than against nothing. Escalation is a decision to make *after* there
 * is a baseline, and adding it now would mean the first cost distribution
 * described two models at once.
 *
 * `high` effort for the same reason the audit uses it: stepping down is a cost
 * optimization to make once quality has been measured, not before.
 */
export type AgentModelConfig = {
  operation: Extract<AIOperation, "agentic_execution">;
  model: string;
  effort: "low" | "medium" | "high";
};

export const AGENTIC_EXECUTION_CONFIG: AgentModelConfig = {
  operation: "agentic_execution",
  model: "claude-sonnet-5",
  effort: "high",
};

/**
 * Nova's voice (Nova Slice 9).
 *
 * The cheapest operation in this file, and the only one that is allowed to be:
 * it produces no conclusion. Every fact it may state has already been decided
 * — by the audit, by the planner, by the resolver, or by deterministic code —
 * and this call chooses the sentences that carry them to a founder. A
 * validation failure, a provider outage or a disabled kill switch all resolve
 * to the slot's template, so the product works with this operation switched
 * off entirely.
 *
 * **Haiku 4.5, and the same model string Product Understanding already uses.**
 * Not `claude-haiku-4-5`: `pricing.ts` keys its effective-dated rate on
 * `claude-haiku-4-5-20251001`, and a model id that resolves to no rate makes
 * the call unpriceable — which is the one thing an operation whose whole
 * argument is cost may not be.
 *
 * `reasoning: { mode: "none" }` is a fact about the model before it is a
 * preference: Haiku 4.5 rejects a request carrying `thinking` or `effort`
 * outright, as `PRODUCT_UNDERSTANDING_CONFIG` records having learned the hard
 * way. The task does not want them either — the judgement was made upstream.
 *
 * Budgets are the smallest in this file. Input is a bounded payload of a few
 * hundred tokens plus this prompt; output is at most three short paragraphs,
 * with `MAX_NOVA_MESSAGE_CHARS` (700) as the domain ceiling and this as the
 * transport one. `timeoutMs` is set for a founder waiting on a screen rather
 * than for a durable step: a voice that has not arrived in ten seconds should
 * lose to the template, because the template was always going to be shown
 * first.
 */
export const NOVA_PRESENTATION_CONFIG: OperationConfig = {
  operation: "nova_presentation",
  model: "claude-haiku-4-5-20251001",
  reasoning: { mode: "none" },
  maxOutputTokens: 600,
  maxInputTokens: 4_000,
  timeoutMs: 10_000,
};

/**
 * The voice candidate the eval compares Haiku against.
 *
 * Not a product config and not a decision: `NOVA_PRESENTATION_CONFIG` above is
 * what would ship. This exists because the first full eval run answered the
 * question it was built to answer and the answer was no — Haiku 4.5 held
 * `calibrated`, `ignored_injection` and `next_step_clear` above 85%, and sat
 * near 40% on `grounded` and `no_invention`, which is the pair the whole layer
 * rests on. Two prompt revisions moved it and did not close it, so the next
 * question is whether the remaining gap is the prompt's or the model's, and
 * only a second model can answer that.
 *
 * Same effort posture as the shipping config: no thinking. The task is
 * rephrasing already-decided facts, and if it needs reasoning to avoid
 * inventing some, that is itself the finding.
 */
export const NOVA_PRESENTATION_CANDIDATE_CONFIG: OperationConfig = {
  operation: "nova_presentation",
  model: "claude-sonnet-5",
  reasoning: { mode: "none" },
  maxOutputTokens: 600,
  maxInputTokens: 4_000,
  timeoutMs: 20_000,
};

/**
 * The two judges that grade Nova's voice, and why there are two.
 *
 * Neither is a product operation. They are measuring instruments, run only by
 * `nova-voice.probe.ts`; nothing under `src/app` can reach them and no usage
 * event is written for them. They live here because [rule 46](../../../CLAUDE.md)
 * is about *where a model may be named*, not about which callers are paid — a
 * probe that hard-coded a model string would be the same defect as a route
 * that did.
 *
 * **Gold judge — Opus 5.** Used for the decision the ADR will rest on and for
 * periodic recalibration of the cheaper one. The criterion that decides
 * whether Nova is safe is also the subtlest: *did it invent a recommendation
 * the payload did not carry?* A weaker judge passes that case, which is
 * exactly the failure the eval exists to catch.
 *
 * **Regression judge — Sonnet 5.** Used per PR, where the question is only
 * whether a prompt edit moved a number that Opus already established. Cheap
 * enough to run often; calibrated against the gold judge rather than trusted
 * on its own.
 *
 * Neither is Haiku: a model must never be its own judge, and the model under
 * test is Haiku.
 */
export type EvalJudgeConfig = {
  model: string;
  reasoning: AIReasoning;
  maxOutputTokens: number;
  maxInputTokens: number;
  timeoutMs: number;
};

export const NOVA_VOICE_GOLD_JUDGE_CONFIG: EvalJudgeConfig = {
  model: "claude-opus-5",
  reasoning: { mode: "adaptive", effort: "high" },
  /*
   * Well above the verdict's own size, because reasoning counts toward this
   * ceiling too and truncating a finished judgement throws away everything
   * spent reaching it — the lesson the audit's own ceiling records.
   *
   * The verdict is six booleans and six sentences, perhaps 400 tokens. The
   * rest is thinking, which at `high` effort is the larger half and is billed
   * at the output rate. A ceiling costs nothing until it is used; what
   * controls the cost here is `effort`, and that is set deliberately.
   */
  maxOutputTokens: 8_000,
  maxInputTokens: 8_000,
  timeoutMs: 120_000,
};

export const NOVA_VOICE_REGRESSION_JUDGE_CONFIG: EvalJudgeConfig = {
  model: "claude-sonnet-5",
  reasoning: { mode: "adaptive", effort: "high" },
  maxOutputTokens: 8_000,
  maxInputTokens: 8_000,
  timeoutMs: 120_000,
};

const CONFIGS: Record<Exclude<AIOperation, "agentic_execution">, OperationConfig> = {
  business_readiness_audit: BUSINESS_READINESS_AUDIT_CONFIG,
  opportunity_generation: OPPORTUNITY_GENERATION_CONFIG,
  product_understanding: PRODUCT_UNDERSTANDING_CONFIG,
  action_planning: ACTION_PLANNING_CONFIG,
  nova_presentation: NOVA_PRESENTATION_CONFIG,
};

export function getOperationConfig(
  operation: Exclude<AIOperation, "agentic_execution">,
): OperationConfig {
  return CONFIGS[operation];
}

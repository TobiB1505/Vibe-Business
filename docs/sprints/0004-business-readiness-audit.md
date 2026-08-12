# Sprint 4 — Business Readiness Audit

Status: Complete. Migration deployed via the linked Supabase CLI workflow. The real dogfood audit ran on 2026-08-11 and scored 34/100 — see [Real audit](#real-vibe-business-audit).
Branch: `feat/sprint-4-business-readiness-audit`

## Goal

The first paid AI inference in Vibe Business. Sprints 2 and 3 built two deterministic evidence sources; this sprint adds the founder's own context, packages all three into a versioned evidence pack, and produces a **diagnostic** Business Readiness Audit across the five PRODUCT.md §10 dimensions.

Deliberately diagnostic. It answers *"how business-ready is this product, on the evidence available?"* — it does **not** produce Opportunities, recommendations, or code changes. That boundary belongs to Sprint 5, and blurring it would make both stages harder to evaluate (§31).

## Evidence architecture

```
RepositoryIntelligenceSnapshot ─┐
LiveProductIntelligenceSnapshot ─┼→ EvidencePack (business-evidence.v1) → one model call
BusinessContext ────────────────┘                                        ↓
                                              validated structured output → deterministic scoring
```

Every fact carries a **stable evidence id** — `repo.framework.nextjs`, `live.seo.canonical_missing`, `business.primary_goal`. The model must cite them; the application then verifies each cited id exists. That single mechanism makes "why does Vibe think this?" answerable *and* makes fabricated citations detectable.

**Absence is evidence.** `live.surface.pricing` is emitted whether or not a pricing page exists, with the label saying which. Omitting undetected surfaces would leave the model inferring absence from silence.

Never in a pack: raw repository source, raw HTML, tokens, secrets, database rows, audit logs, GitHub credentials, or any URL beyond the project's own normalized origin.

## Business Context

Five fields, four of them closed enums (§2): `product_summary` (required, 20–600 chars), `target_customer`, `stage`, `monetization_model`, `primary_goal`. No revenue, no financial data, no personal information. Free text is length-bounded and stripped of control characters — a pasted document must not become the prompt, and a stray newline must not fake a fence boundary.

A `sha256` content hash forms part of the audit's input identity, so editing context invalidates reuse while re-saving it unchanged does not.

## AI trust boundary

Recorded in full as [ADR 0011](../decisions/0011-ai-inference-and-evidence-trust-boundary.md). Summary:

- **Instructions come only from us.** The system prompt is authored entirely by Vibe Business; no customer content is interpolated into it. All third-party content arrives in the user message inside an `<evidence>` fence, labelled untrusted, with the model told to treat injected instructions as data points and continue normally.
- **The model has no capabilities.** No tools, no web search, no URL fetching, no code execution, no repository or database access. The provider interface has no field for them, and the adapter never sends `tools`. This is the load-bearing mitigation: injection degrades to "a wrong sentence", not "an action taken".
- **Schema compliance ≠ truthfulness.** Cited evidence ids are verified against the pack; unknown ids are discarded; a dimension left with no surviving evidence is demoted to `insufficient_evidence`.
- **No hidden reasoning** is requested, stored, or displayed. Only text blocks are read; thinking token *counts* are read solely because they are billed.

## Provider abstraction

[ADR 0005](../decisions/0005-ai-provider-abstraction.md) is now implemented. `src/modules/ai/provider.ts` defines `AIProvider` with `countInputTokens` and `generateStructured` — **generic structured generation**, not `businessReadinessAudit()`.

This is a deliberate, documented deviation from the sprint brief's sketch. A provider method named after one domain operation would need changing for every new AI operation (Sprint 5's Opportunity Engine being the immediate case) and would invert the dependency: the infrastructure adapter would import domain types. ADR 0005 names "structured generation" as the responsibility, which is exactly what this is. The Business Audit module composes the provider; the provider knows nothing about audits.

`src/modules/ai/anthropic/adapter.ts` is the only file permitted to import the Anthropic SDK.

## Model and prompt configuration

Centralized in `src/modules/ai/operations.ts` (§10). No route handler names a model; nothing user-supplied can select one.

| Setting | Value | Why |
|---|---|---|
| Model | `claude-sonnet-5` | Judging readiness from mixed evidence is nuanced reasoning, not extraction |
| Thinking | `{ type: "adaptive" }` | Required on Sonnet 5 — manual `budget_tokens` returns a 400 on this generation |
| Effort | `high` (set explicitly) | Sonnet 5's API default and the right first setting when the goal is to *measure* quality; stepping down to `medium` is an optimization to make against a baseline, not before one |
| `max_tokens` | 16,000 | Reasoning counts toward this ceiling under adaptive thinking; truncating a paid call mid-JSON wastes the whole thing |
| Max input tokens | 30,000 | ~10× a normal pack — catches a pathological snapshot, not normal ones |
| Sampling | defaults | Non-default temperature/top_p/top_k are unsupported alongside thinking on this generation |

Structured outputs use `output_config.format` with `type: "json_schema"` (GA; the old `structured-outputs-2025-11-13` beta header is no longer required). The schema is written to the supported subset — every object sets `additionalProperties: false` and lists all properties as `required`, and no numeric/string-length constraints are used, so ranges are enforced in `validate.ts` instead.

**Versioning** (§18): `business-audit-prompt-v1` and `business-readiness-rubric-v1`, persisted with every audit alongside the model, schema, audit and evidence-pack versions. Production prompt behaviour must never change without incrementing its version.

## Business readiness model

`business-readiness-audit.v1`. Five dimensions — Product, Monetization, Distribution, Conversion, Retention — each returning `assessmentStatus`, `score | null`, `confidence`, `summary`, `strengths[]`, `gaps[]`, `unknowns[]`, `evidenceIds[]`.

**The model is given no field for an overall score.** The application computes it (§7):

- equal weighting across scored dimensions;
- unscored dimensions **excluded, never counted as zero**;
- `null` overall below **3 of 5** scored dimensions, because an average of one or two dimensions is not a readiness score;
- coverage shown beside the score, so a 3-of-5 audit cannot read as complete.

## Unknown / evidence policy

The most important rule in the sprint (§6): **missing evidence is never a low score.**

Enforced in three places rather than trusted to the prompt:

1. The rubric distinguishes *absence of evidence* ("no analytics available" → unknowns) from *evidence of absence* ("no pricing page AND no payment integration AND founder says monetization is planned" → a genuinely low score).
2. `validate.ts` forces `score: null` whenever status is `insufficient_evidence`, and demotes any dimension whose evidence did not survive verification.
3. `scoring.ts` excludes null scores from the average and returns null overall below the coverage threshold.

A genuine `0` is preserved and counted — it means evidenced absence, which is different from unknown.

## Usage accounting and provider cost

Every call is recorded in `ai_usage_events` (§25): provider, model, operation, project, user, job reference, actual token counts, estimated input tokens, latency, status, failure code, cost, and pricing version. Never: prompt text, response, reasoning, or secrets.

This is **internal provider-cost accounting**, not the customer Vibe Credit ledger (PRODUCT.md §12) — no margin, no credits, no billing.

**Pricing is effective-dated and computed in integer nanodollars** (§26). Not hypothetical: Claude Sonnet 5 is on introductory pricing of **$2/$10 per MTok through 31 August 2026**, moving to **$3/$15 on 1 September 2026**. An identical audit costs measurably more after that date, and the ledger has to say so. Floating point cannot represent $0.0000021 exactly, so all arithmetic is integer and only rendered as a decimal string at the end.

Failures are accounted honestly: usage is recorded only when tokens were genuinely billed. A refusal burns tokens and is recorded; a request rejected before sending records none.

## Cost controls

- **Token counting before every paid call** (§14), against the exact request shape that would be sent.
- **Deterministic trimming** if over budget: drop priority-3 evidence, re-count, then priority-2, re-count. Priority-1 facts are never dropped — a pack that still does not fit is refused as `audit_input_budget_exceeded` rather than silently gutted.
- **Reuse by input identity** (§23): a `sha256` over both snapshot ids, the context hash, and the full reproducibility set. Identical inputs return the existing audit for free.
- **Double-submit protection** (§24) via a partial unique index on in-flight rows — a double click cannot buy two identical calls.
- **One call per audit** (§16). No agent loop, no self-critique, no second opinion.
- **No prompt caching** yet (§17), keeping first-call accounting simple.
- `maxRetries: 0` on the SDK client, so a rate limit cannot silently become several billable attempts.

## Security

- `ANTHROPIC_API_KEY` is validated server-side, `server-only`, never `NEXT_PUBLIC_`, never logged, never persisted, never in an audit event, never in prompt text. Build, tests and CI all run without it.
- No AI module is reachable from a client component; the client bundle was scanned for provider symbols and the key name.
- Raw provider errors are mapped to domain codes inside the adapter and never reach a log or a browser.
- `ai_usage_events` is **insert-only** through RLS with no select policy, so provider billing detail is unreadable via the public API (§33).

## User flow

Project context now shows five rows: Repository intelligence · Live product intelligence · Business context · Business readiness. A first audit requires all three evidence sources; when one is missing the UI names exactly which (§29) and the button is disabled rather than failing after the click.

The audit renders the overall score with coverage beside it, per-dimension scores or "Not enough evidence", strengths/gaps/unknowns, key findings, limitations, and a "Why?" disclosure exposing evidence ids. No prompt text, no token counts, no raw JSON.

## Database

Migration `20260810013000_business_readiness_audit.sql`:

- `project_business_context` — one row per project, 4 RLS policies, closed-enum checks, bounded text, context hash.
- `business_readiness_audits` — validated result only; restrict-on-delete FKs to both snapshots so an audit stays explainable; full reproducibility set; `overall_score` nullable *by design*; 4 RLS policies; reuse index; partial unique in-flight index.
- `ai_usage_events` — insert-only RLS, `numeric(18,9)` cost, no FK on `job_id` (the ledger must outlive the job it paid for).

No prompt storage, no raw responses, no reasoning, no vector/embedding tables.

## Supabase deployment

Linked CLI workflow only, no manual SQL Editor:

1. `pnpm db:status` — exactly one pending migration (`20260810013000`); the prior three aligned.
2. `pnpm db:push` — applied to `dcbwlctscooefwnivxzv` (Vibe-Business). Planner-Agent untouched.
3. `pnpm db:status` — all four migrations aligned.
4. `pnpm db:lint` — **no schema errors found**.
5. Verified: 10 tables, RLS on all 10; 4 policies each on the two new user-owned tables; `ai_usage_events` has exactly **1** policy, `INSERT` only.

The first `db:status` attempt returned a transient Cloudflare 502 from `api.supabase.com` (explicitly `retryable`, `retry_after: 60`). Retried after backoff and succeeded. `db push` again printed the `failed to run docker` catalog-cache warning — a *local* cache step, unrelated to the remote push, which succeeded and was independently verified.

## Validation

- `pnpm lint` — pass
- `pnpm typecheck` — pass
- `pnpm test` — **656 tests across 43 files**, all passing (~120 new)
- `pnpm build` — pass
- `pnpm db:status` aligned · `pnpm db:lint` clean
- No test reaches the Anthropic API; the provider is injected everywhere.

## Real Vibe Business audit

**Run on 2026-08-11**, once the key was configured. Result: **34 / 100**, five of five dimensions assessed, structured output valid, no evidence id discarded.

| | |
| --- | --- |
| Estimated input tokens | 5,233 |
| Actual input tokens | 5,233 |
| Output tokens | 5,218 |
| Thinking tokens | 2,637 |
| Provider cost | $0.0626 (`claude-sonnet-5-introductory-2026`) |
| Latency | 53.8s |

Estimated input equalled actual exactly, so the pre-spend counting gate measures the request that is actually billed rather than approximating it.

The audit correctly refused to guess: monetization scored 8 on *converging* evidence of absence (founder states no model, no pricing surface, no checkout, no payment integration), while retention stayed `partial` with low confidence because the authenticated app area was visible in the repository but unreachable by a public crawl. That gap is precisely what Sprint 5's Deep Scan and [Sprint 6](0006-deep-scan-audit-evidence.md) went on to close — the follow-up audit with authenticated evidence scored 40/100 and resolved retention's stated unknown by observation.

### What the usage ledger shows

Eleven usage events exist for this project, and the split is the point:

- **2 succeeded** — real token counts and real cost, above.
- **9 failed** — 5 `token_count_failed`, 2 `structured_output_invalid`, 2 `provider_request_rejected` — every one with `input_tokens`, `output_tokens` and `provider_cost_usd` all `null`.

That is the §25/§27 invariant holding on real data: an attempt is always recorded, but only genuinely billed tokens are ever written as usage. A failed audit costs the ledger a row, not a number.

Everything up to the paid boundary had already been verified against the real pipeline with an injected provider — evidence-pack construction, request shaping (adaptive thinking, effort, JSON schema, no tools), token-count gating, validation, scoring, persistence and usage accounting — and the live run contradicted none of it.

## Known limitations

- **Audit quality is measured by two runs, not validated.** The 34/100 run and the [Sprint 6](0006-deep-scan-audit-evidence.md) 40/100 re-run are two data points. They showed the scoring and evidence discipline behaving as designed, and also showed dimensions moving several points on *identical* evidence — so treat small score differences as run-to-run variance rather than signal.
- **Single call.** If one call proves insufficient, that is a product finding — not a reason to add loops before measuring.
- **Coverage threshold is a judgement call.** 3-of-5 is defensible, not derived from data.
- **Equal dimension weighting** encodes no product opinion yet, deliberately.
- **Synchronous execution.** An audit runs inside the request. Sonnet 5 at `high` effort on a small structured task should be well inside typical limits, but this shares the Vercel `maxDuration` question already open from Sprint 3.
- **Estimate drift is recorded but unanalysed.** `estimated_input_tokens` sits beside the actual count; nothing consumes it yet. On both real runs the two were identical.
- **No usage UI.** The ledger is intentionally unreadable through the app; analysis is via direct database access.

## Non-goals (explicitly not implemented)

Opportunity Engine · actionable recommendations · repository writes · branch creation · code generation · preview deployment · merge · experiments · credits · Stripe · payments · subscriptions · customer billing · model chooser · multi-provider routing · OpenAI · agent loops · web search · AI tools · browser automation · screenshots · vector database · embeddings · RAG · background queue · team collaboration · UI redesign.

Sprint 4 ends at: *a reproducible, evidence-grounded, cost-accounted Business Readiness Audit exists.*

## Open questions

- **Effort calibration.** `high` was chosen for a first quality baseline. Whether `medium` holds quality at roughly half the output spend is an eval question, answerable once real audits exist.
- **Coverage threshold.** Is 3-of-5 right, or should Distribution and Retention — the two dimensions our evidence rarely supports — be weighted or excluded differently?
- **Prompt caching.** The system prompt and rubric are identical across audits and would cache well. Worth revisiting once repeated traffic exists (§17).
- **Vercel `maxDuration`** for a synchronous inference call, shared with Sprint 3's open question.

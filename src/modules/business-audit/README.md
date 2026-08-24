# business-audit

The diagnostic Business Readiness Audit — the first feature that spends money on inference. See [docs/sprints/0004-business-readiness-audit.md](../../../docs/sprints/0004-business-readiness-audit.md), [ADR 0011](../../../docs/decisions/0011-ai-inference-and-evidence-trust-boundary.md) and [ADR 0050](../../../docs/decisions/0050-lenses-are-the-audit.md).

```
evidence-v3.ts  the current pack: Product Profile + founder intent + scanner evidence
evidence-v2.ts  historical (Deep Scan added). Its authenticated builder is still used
evidence.ts     historical (Sprint 4). Describes what a v1 pack contained
rubric.ts       versioned rubric (product logic, in source control)
prompt.ts       versioned system prompt + response JSON Schema
runner.ts       count tokens → ONE paid call → validate → score
validate.ts     evidence verification and the unknown-stays-unknown invariants
scoring.ts      deterministic overall score over the lenses, never from the model
map-view.ts     the lens map the Business Health screen renders
entitlement.ts  the free-audit policy, as a pure decision function
store.ts        persistence, input-hash reuse, in-flight guard, entitlement queries
service.ts      prerequisites, entitlement facts, audit currency
```

## The CORE-2 contract

**The Product Profile is a required input.** The audit reasons from Vibe's understanding of
the product; it does not re-derive that understanding from raw scanner output, and there is
no fallback that would (CORE-2 §8). Scanner evidence stays in the pack beside it, because the
"Why?" disclosure resolves cited ids back to concrete observations.

`business_context` is gone — see [the sprint doc](../../../docs/sprints/0022-core2-audit-first-move.md).
What a founder typed about their *product* now lives in the profile as a user-confirmed
correction; what they said about their *own position* lives in `projects/founder-intent.ts`.

**The first qualified audit is free**, and consumption is derived from a completed audit
rather than from a flag — so an outage, a timeout, or our own persistence failing costs the
user nothing.

## The lens contract (ADR 0050)

The audit's framework is the **nine business lenses**. Each lens carries a health,
a materiality (when it needs attention), a diagnostic score (0–100 or null), its
internal reasoning and its cited evidence. The overall Business Health score is
the unweighted mean over lenses with a score, behind a coverage threshold over
the lenses that apply — computed in `scoring.ts`, by us, never by the model.

Audits stored under contracts v6/v7 carry the earlier five-dimension record in
their JSONB and remain valid and renderable under their own versions; the score
trend breaks rather than joining across the contract change.

## Non-negotiables

- **Diagnostic only.** This layer describes what *is*. It must never emit actions, tasks, fixes, or recommendations — Opportunities are Sprint 5, and the boundary stays clean.
- **Missing evidence is never a low score.** Enforced in `validate.ts` and `scoring.ts`, not merely requested in the prompt. Unscored lenses are excluded from the average, never counted as zero.
- **The model never produces the overall score.** It has no field for one.
- **Every cited evidence id is verified** against the pack. Unknown ids are discarded; a lens score with no surviving evidence, or one contradicting its own health band, is nulled.
- **Customer content never enters the system prompt.** It goes in the fenced, untrusted-labelled user message only.
- **Changing `prompt.ts` or `rubric.ts` requires incrementing its version.** Two audits carrying the same version have to mean the same thing, or reproducibility is gone.
- **One paid call per audit.** No agent loop, no self-critique, no second opinion.

## Transport vs domain

`business-readiness-audit.v2` is the **domain contract**. `wire-schema.ts` holds a
separate, more compact **provider representation**, because Anthropic rejects an
oversized compiled grammar (`400` — "the compiled grammar is too large") and an
early schema declared one item shape five times over. The discipline it taught —
declare each item shape exactly once — still governs the lens and conclusion
shapes.

    provider JSON → normalizeAnthropicAuditOutput → validateAuditOutput
                  → deterministic scoring → business-readiness-audit.v2

- The wire form carries `lenses` as an **array**, with the item shape declared
  once and `lens` as an enum inside the item.
- **Nothing provider-shaped is persisted.** Transport data stops at
  normalization so a provider constraint cannot leak into the product's domain
  model, and the audit's `schemaVersion` is unaffected by it.

Structured outputs are one validation layer; `validate.ts` remains the
authoritative business-rule layer and is unchanged by the transport reduction.

## Testing

`test-support.ts` provides a `FakeProvider` and snapshot fixtures — `buildModelOutput`
returns the **wire form**, because that is what the provider actually returns. No test
may reach the Anthropic API, need a key, or cost money.

The grammar compile probe (`pnpm ai:probe-audit-schema`) is the one exception, and it
is deliberately not a test: it lives in `src/modules/ai/probe/` as a `*.probe.ts` file
under its own vitest config, so `pnpm test` and CI cannot reach it. Successful probes
make a real, billable (tiny) request; failed ones are rejected before inference and
are not billed.

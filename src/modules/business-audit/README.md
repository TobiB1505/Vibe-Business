# business-audit

The diagnostic Business Readiness Audit — the first feature that spends money on inference. See [docs/sprints/0004-business-readiness-audit.md](../../../docs/sprints/0004-business-readiness-audit.md) and [ADR 0011](../../../docs/decisions/0011-ai-inference-and-evidence-trust-boundary.md).

```
evidence.ts   deterministic EvidencePack from repo + live + founder context
rubric.ts     versioned rubric (product logic, in source control)
prompt.ts     versioned system prompt + response JSON Schema
runner.ts     count tokens → ONE paid call → validate → score
validate.ts   evidence verification and the unknown-stays-unknown invariants
scoring.ts    deterministic overall score, computed by us and never by the model
store.ts      persistence, input-hash reuse, in-flight guard
service.ts    prerequisites, orchestration, audit events, usage accounting
```

## Non-negotiables

- **Diagnostic only.** This layer describes what *is*. It must never emit actions, tasks, fixes, or recommendations — Opportunities are Sprint 5, and the boundary stays clean.
- **Missing evidence is never a low score.** Enforced in `validate.ts` and `scoring.ts`, not merely requested in the prompt. Unscored dimensions are excluded from the average, never counted as zero.
- **The model never produces the overall score.** It has no field for one.
- **Every cited evidence id is verified** against the pack. Unknown ids are discarded; a dimension left with no surviving evidence is demoted to `insufficient_evidence`.
- **Customer content never enters the system prompt.** It goes in the fenced, untrusted-labelled user message only.
- **Changing `prompt.ts` or `rubric.ts` requires incrementing its version.** Two audits carrying the same version have to mean the same thing, or reproducibility is gone.
- **One paid call per audit.** No agent loop, no self-critique, no second opinion.

## Transport vs domain

`business-readiness-audit.v1` is the **domain contract**. `wire-schema.ts` holds a
separate, more compact **provider representation**, because Anthropic rejects an
oversized compiled grammar (`400` — "the compiled grammar is too large") and the
previous schema declared the dimension assessment shape five times, once per
dimension key.

    provider JSON → normalizeAnthropicAuditOutput → validateAuditOutput
                  → deterministic scoring → business-readiness-audit.v1

- The wire form carries `dimensions` as an **array**, with the item shape declared
  once and `dimension` as an enum inside the item.
- Normalization rejects a response that omits, repeats, or invents a dimension —
  the guarantee a keyed object used to get from the grammar for free.
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

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

## Testing

`test-support.ts` provides a `FakeProvider` and snapshot fixtures. No test may reach the Anthropic API, need a key, or cost money.

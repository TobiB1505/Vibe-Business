# ADR 0011 — AI Inference and the Evidence Trust Boundary

Status: Accepted
Date: 2026-08-10
Context: Sprint 4 — Business Readiness Audit

## Context

Sprint 4 introduces the first paid AI inference in Vibe Business. Three things change at once, and each is durable enough to need recording:

1. **Untrusted third-party content reaches a language model.** Repository intelligence, live product intelligence, and founder-supplied text all feed the Business Audit. Every one of those sources can contain text that reads as an instruction — a README line, a website headline, a product description someone typed. [ADR 0006](0006-untrusted-repository-execution.md) and [ADR 0010](0010-safe-outbound-http-inspection.md) established that such content is never executed and never fetched unsafely. Neither covers "never *obeyed* by a model".
2. **[ADR 0005](0005-ai-provider-abstraction.md) deferred the `AIProvider` interface** until a real call site existed. One now does.
3. **Inference costs money per call**, which makes cost accounting an architectural concern rather than an operational nicety.

## Decision

### 1. Evidence is data; instructions come only from us

The model receives two clearly separated inputs:

- A **system prompt** authored entirely by Vibe Business, containing the role, the rubric, and the output contract. No customer, repository, or website content is ever interpolated into it.
- A **user message** containing the evidence pack inside an explicit `<evidence>` fence, labelled as untrusted, with the instruction that content inside it is information to assess and never a command to follow.

Free-text entering the pack is length-bounded and stripped of control characters, so it cannot fake a fence boundary. The prompt names the injection case explicitly and tells the model to continue normally and, if useful, note the attempt as a finding.

### 2. The model has no capabilities

The provider boundary has **no** parameter for tools, web search, URL fetching, code execution, file access, or database access. The Anthropic adapter never sends `tools`. This is the load-bearing mitigation: a model that receives hostile text and has no ability to act cannot be made to act by that text. Prompt injection degrades to "a wrong sentence in an audit", not "an action taken on a customer's behalf".

### 3. Structured output, then independent validation

Responses are constrained by a JSON Schema. Schema compliance is not treated as truthfulness: the application separately verifies that every cited evidence id exists in the pack, discards those that do not, and demotes any dimension left with no surviving evidence. A fabricated citation therefore cannot become the justification the UI displays.

### 4. The application owns the headline number

The model assesses dimensions; it is given no field for an overall score. Vibe Business computes that deterministically from scored dimensions, excluding unscored ones rather than counting them as zero, and returns null below a minimum coverage threshold.

**Missing evidence must never read as bad evidence.** An early-stage product with no analytics has an unknown retention story, not a bad one, and a system that scores it 10/100 is lying about what it knows. This is enforced in code, not merely requested in the prompt.

### 5. No hidden reasoning is requested, stored, or displayed

Only text content blocks are read from the response. Thinking blocks are never extracted; reasoning *token counts* are read solely because they are billed.

### 6. `AIProvider` offers generic structured generation

The interface exposes `countInputTokens` and `generateStructured`, not `businessReadinessAudit`. ADR 0005 names "structured generation" as the responsibility, and a provider that knew about business audits would have to change for every new AI operation while inverting the dependency — the infrastructure adapter would import domain types. The Business Audit module composes the provider; the provider knows nothing about audits.

### 7. Cost is accounted from the first call

Every provider call is counted before it is sent (enforcing an input-token budget) and recorded afterwards in an internal usage ledger: provider, model, operation, actual token counts, latency, status, and a cost computed from **effective-dated** pricing using integer arithmetic. The ledger stores no prompt, no response, no reasoning, and no secret; it is insert-only through RLS and unreadable via the public API.

Pricing is effective-dated because provider prices genuinely change: Claude Sonnet 5 runs at $2/$10 per MTok through 31 August 2026 and $3/$15 from 1 September 2026. A constant would silently misreport every audit after that date.

## Consequences

**Positive**

- The blast radius of prompt injection is bounded by construction, not by prompt wording.
- Audits are reproducible: prompt, rubric, model, evidence-pack and schema versions are persisted with every result, and an unchanged input set is reused rather than re-purchased.
- Unit economics are measurable from the first call rather than reconstructed from an invoice.
- A second provider or a cheaper model for a different operation is an adapter plus a config entry.

**Negative / accepted trade-offs**

- **No tools means no follow-up questions.** The model cannot look anything up, so an evidence gap stays a gap. That is the intended trade — and the reason "insufficient evidence" is a first-class outcome.
- **One call per audit** may cap quality. Deliberate: measuring what one call produces has to precede spending more.
- **Validation can weaken a result.** A dimension whose evidence was entirely hallucinated is demoted to "insufficient evidence" even if its prose was plausible. Preferred over displaying unverifiable claims as findings.
- **Effective-dated pricing needs maintenance.** An unpriced model raises an error rather than silently recording zero cost — noisy by design.

## Alternatives considered

- **Trusting the prompt alone to resist injection.** Rejected: prompt instructions are a mitigation, not a boundary. Removing capabilities is the boundary.
- **Letting the model produce the overall score.** Rejected: the most quoted number in the product would be the least verifiable, and would drift between runs.
- **Treating unscored dimensions as zero.** Rejected outright — it would systematically penalise exactly the early-stage products this product exists to help.
- **A `businessReadinessAudit()` method on the provider.** Rejected on layering grounds (see §6).
- **Prompt caching from day one.** Deferred: first-call accounting should be simple and transparent before a caching layer complicates it.

## Related

- [ADR 0005](0005-ai-provider-abstraction.md) — the provider boundary this ADR finally implements.
- [ADR 0006](0006-untrusted-repository-execution.md) — untrusted repository content is never executed.
- [ADR 0010](0010-safe-outbound-http-inspection.md) — untrusted destinations are never fetched unsafely.
- [ADR 0008](0008-secrets-management.md) — why the API key is server-only and never logged.
- [docs/sprints/0004-business-readiness-audit.md](../sprints/0004-business-readiness-audit.md)

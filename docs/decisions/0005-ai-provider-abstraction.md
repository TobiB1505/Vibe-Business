# 0005 - AI Provider Abstraction, Anthropic First

Status: Accepted
Date: 2026-08-09

## Context

[PRODUCT.md](../../PRODUCT.md) requires that Vibe Business not become architecturally locked to a single AI provider, with model routing by task difficulty as a future capability (cheap/fast for classification/extraction, mid-tier for audits/copy/prioritization, high-capability for code changes/architecture). [ARCHITECTURE.md](../../ARCHITECTURE.md) left the concrete provider(s) and the interface shape as open decisions.

## Decision

V0.1 uses **Anthropic** as the first and only AI provider.

The architecture provides a conceptual **`AIProvider`** boundary covering responsibilities such as:

- analysis
- structured generation
- code execution request preparation
- usage reporting

The concrete interface signature is **not** implemented ahead of need in this step — only the requirement that provider-specific logic (Anthropic API calls, request/response shaping, model identifiers) is isolated behind this boundary, rather than called directly from the Opportunity Engine, Business Audit Layer, or AI Execution Layer.

Explicitly out of scope for V0.1:

- Multi-provider routing
- Any agent orchestration beyond what a single provider call requires

## Consequences

### Positive

- A single provider keeps V0.1 implementation simple while still respecting the product's provider-neutrality principle at the architecture level.
- Isolating provider logic behind `AIProvider` means adding a second provider or model-routing logic later does not require rewriting the layers that consume AI results.
- Usage reporting as an explicit `AIProvider` responsibility keeps it aligned with the Usage/Credit Layer's per-job logging requirement from the start.

### Negative / Tradeoffs

- No multi-provider routing in V0.1 means the cost/capability tradeoffs described in PRODUCT.md (cheap/fast vs. mid-tier vs. high-capability models) are not realized yet — only enabled architecturally.
- Deferring the concrete interface signature means some rework is expected once real usage patterns from the Business Audit Layer, Opportunity Engine, and AI Execution Layer are known.

## Revisit when

A second AI provider or explicit model-routing-by-difficulty becomes a concrete, prioritized requirement — at which point the `AIProvider` interface is actually specified and implemented against real call sites.

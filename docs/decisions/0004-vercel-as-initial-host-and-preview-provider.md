# 0004 - Vercel as Initial Host and Preview Provider

Status: Accepted
Date: 2026-08-09

## Context

Vibe Business needs (a) a place to host the Vibe Business application itself, and (b) a way to produce isolated preview deployments of AI-proposed changes to *analyzed* repositories, per the Core Loop's Preview step in [PRODUCT.md](../../PRODUCT.md#6-core-user-flow). Both were open decisions in [ARCHITECTURE.md](../../ARCHITECTURE.md).

## Decision

For V0.1:

- **Vercel hosts the Vibe Business application**, chosen for its integration with Next.js (see [0001](0001-modular-monolith.md)), its built-in preview/deployment workflow, and reduced infrastructure overhead.
- **Vercel Preview Deployments is the first supported preview workflow** for analyzed repositories that are themselves Vercel-deployable.
- Preview generation is accessed through a conceptual `PreviewProvider` boundary in the architecture. Vercel is the first implementation of that boundary, not part of the core domain model. No other provider is implemented in V0.1, and the `PreviewProvider` interface itself is not implemented ahead of need — only the boundary is a confirmed architectural requirement.

The architecture must not become unnecessarily Vercel-specific: Vercel-specific behavior stays behind the `PreviewProvider` boundary rather than leaking into the Opportunity Engine, AI Execution Layer, or Approval Layer.

## Consequences

### Positive

- Vercel + Next.js integration minimizes hosting/deploy setup for the Vibe Business app itself.
- Vercel Preview Deployments gives a fast path to a working preview experience for the common case of Vercel-compatible target repositories.

### Negative / Tradeoffs

- Repositories not deployable on Vercel (different hosting target, non-Vercel-compatible stack) are not covered by the V0.1 preview workflow. This gap is tracked as a deferred decision in [ARCHITECTURE.md](../../ARCHITECTURE.md), not solved here.
- Hosting the Vibe Business app on Vercel and using Vercel Preview Deployments for target repos are two distinct uses of Vercel; conflating them in implementation would violate the `PreviewProvider` abstraction goal.

## Revisit when

A concrete need arises to preview repositories that are not Vercel-compatible, or a demonstrated reason emerges to move the Vibe Business application off Vercel.

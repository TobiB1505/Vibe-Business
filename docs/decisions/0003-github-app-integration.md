# 0003 - GitHub App as Repository Integration Layer

Status: Accepted
Date: 2026-08-09

## Context

[PRODUCT.md](../../PRODUCT.md) establishes GitHub as the central integration layer and source of truth for product code. [ARCHITECTURE.md](../../ARCHITECTURE.md) previously left the exact integration mechanism (GitHub App vs. OAuth App vs. token flow) as an open decision, while confirming that GitHub access must follow least privilege.

## Decision

V0.1 integrates with GitHub via a **GitHub App**, not:

- Personal Access Tokens supplied by the user
- A simple token-paste flow
- A GitHub OAuth App as the primary repository access mechanism

Guiding principle: **least privilege**. The GitHub App requests only the permissions a concretely implemented feature currently needs.

Initial permissions expected to be relevant to V0.1:

- Metadata: read
- Contents: read/write
- Pull Requests: read/write

**Final permissions must be reviewed immediately before implementation and should not be requested before they are needed.** This list is a directional expectation, not a pre-approved final scope.

Installation access tokens are used as short-lived credentials, consistent with GitHub App design. No unnecessary GitHub access tokens are persisted long-term.

## Consequences

### Positive

- Fine-grained, installation-scoped permissions align with the product's least-privilege requirement and the approval model in [PRODUCT.md](../../PRODUCT.md#9-approval-model).
- Short-lived installation tokens reduce the blast radius of a leaked credential compared to long-lived PATs.
- GitHub Apps are installable per-organization/repository, matching the "connect a repository" flow in the Core Loop.

### Negative / Tradeoffs

- More setup complexity than a simple OAuth token flow (App registration, private key handling, webhook configuration).
- Requires careful private key and installation-token handling — see [0008](0008-secrets-management.md).

## Revisit when

A concrete feature needs a permission not in the initial set (review and extend deliberately, not preemptively), or GitHub App limitations block a required capability.

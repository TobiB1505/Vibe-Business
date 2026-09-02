# 0006 - Untrusted Repository Execution

Status: Accepted (security principle) / Deferred (concrete provider); the deferred half is superseded by [0015](0015-untrusted-repository-execution-provider.md)
Date: 2026-08-09

## Context

Vibe Business's Build & Validation Layer (see [ARCHITECTURE.md](../../ARCHITECTURE.md)) needs to build and test code from arbitrary, user-connected repositories, per the Core Loop in [PRODUCT.md](../../PRODUCT.md#6-core-user-flow). That code was not authored or reviewed by Vibe Business and must be treated as a security boundary, not merely a functional dependency.

## Decision

Code from connected user repositories is treated as **UNTRUSTED CODE** at all times.

**Confirmed security principle:** Untrusted repository code must execute only in isolated, ephemeral environments with tightly scoped credentials and lifecycle. It must never run directly inside the Vibe Business application process/runtime described in [0001](0001-modular-monolith.md).

In particular, the following must **not** be executed directly within the main Vibe Business system:

- `npm install`
- npm scripts
- arbitrary shell scripts
- build scripts
- test scripts
- postinstall hooks
- repository-provided executables

**Deferred architecture decision: Untrusted Repository Execution Provider.** The concrete isolation mechanism (e.g. a specific sandboxing/container/microVM provider or service) is intentionally **not** decided in this step. This ADR fixes the security principle now so no implementation work proceeds without it; it explicitly does not fix the provider.

## Consequences

### Positive

- Fixing this principle now (before Sprint 0 implementation) prevents an accidental shortcut where repository scripts get run in-process "just for now."
- Keeps the Build & Validation Layer's security requirement visible and blocking, rather than an afterthought discovered during implementation.

### Negative / Tradeoffs

- V0.1 cannot fully implement Build & Validation until the deferred sandbox/execution provider decision is made — this is an accepted sequencing cost, not a gap to route around.
- Isolation adds latency/complexity to every build-and-test cycle compared to in-process execution.

## Revisit when

A concrete sandbox/execution provider decision is made (tracked as an open item in [ARCHITECTURE.md](../../ARCHITECTURE.md)) — at which point this ADR should be superseded by a new ADR documenting the chosen provider and its credential/lifecycle model.

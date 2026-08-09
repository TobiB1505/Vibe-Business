# 0001 - Modular Monolith with Next.js + TypeScript

Status: Accepted
Date: 2026-08-09

## Context

V0.1 needs to prove the Core Loop (Analyze → Opportunity → Build → Branch → Test → Preview → Approve → Merge → Measure) end-to-end for at least one real repository, per [PRODUCT.md](../../PRODUCT.md#6-core-user-flow). [ARCHITECTURE.md](../../ARCHITECTURE.md) already establishes a confirmed principle that V0.1 should prefer a modular monolith over microservices unless a specific reason forces a split. The runtime/framework itself was left as an open decision.

## Decision

V0.1 is built as a **modular monolith** using **Next.js (App Router) + TypeScript** as the core application.

- Frontend, server-side logic, Route Handlers, and webhooks live in a single codebase and a single deployable application.
- No separate backend framework (e.g. FastAPI, a standalone API server) is introduced for V0.1.
- The application is internally organized into logical modules corresponding to the layers in ARCHITECTURE.md — e.g. `auth`, `projects`, `github`, `audits`, `opportunities`, `execution`, `previews`, `approvals`, `usage`, `credits`, `audit-log` — but these modules live in one codebase, not separate services.

## Consequences

### Positive

- Single codebase and deploy target reduces operational complexity for a not-yet-validated product.
- Route Handlers double as the natural home for webhooks (e.g. GitHub) and internal API routes without a separate service.
- TypeScript end-to-end (frontend and server logic) avoids a second language/type boundary.

### Negative / Tradeoffs

- Long-running or resource-isolated work (e.g. untrusted repository execution, see [0006](0006-untrusted-repository-execution.md)) cannot run inside the same process/runtime as the main app and must be delegated to isolated execution regardless of this choice.
- A single deployable means the module boundaries are enforced by convention/code organization, not by hard process/network isolation. This is an accepted tradeoff for V0.1.

## Revisit when

A specific module has a demonstrated, concrete scaling, isolation, or reliability need that the modular monolith cannot satisfy (e.g. execution/sandboxing, which is already deferred to its own isolated environment regardless of this decision).

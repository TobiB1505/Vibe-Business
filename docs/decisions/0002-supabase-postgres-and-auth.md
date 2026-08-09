# 0002 - Supabase Postgres and Supabase Auth

Status: Accepted
Date: 2026-08-09

## Context

V0.1 requires relational storage for repositories, audits, opportunities, execution jobs, approvals, usage, and credits (see the conceptual domain list in [ARCHITECTURE.md](../../ARCHITECTURE.md#6-domain-model-conceptual-only)), plus user authentication. [ARCHITECTURE.md](../../ARCHITECTURE.md) previously left database choice and auth provider as open decisions. Minimizing the number of infrastructure providers is preferable while the product is unvalidated, per [PRODUCT.md](../../PRODUCT.md) cost/simplicity principles.

## Decision

V0.1 uses **Supabase Postgres** for relational data and **Supabase Auth** for user authentication.

- Data is relational; schema changes are migration-based.
- The data model is prepared for multi-tenancy (data scoped by user/project) from the start, without implementing the full later schema now.
- Row Level Security (RLS) is used for user-/project-specific data, applied as the corresponding tables are actually implemented — not retrofitted speculatively ahead of need.
- Supabase Auth is used for user identity so RLS policies can be combined directly with authenticated user identity.
- This decision covers *Vibe Business's own* authentication and data storage only. GitHub project/repository access is handled separately via a GitHub App — see [0003](0003-github-app-integration.md) — and is not part of Supabase Auth.

No full table schema, field list, or migrations are defined by this ADR. The concrete schema is scoped to Sprint 0/1 implementation work.

## Consequences

### Positive

- One provider covers both database and auth, reducing infrastructure surface area and integration work.
- RLS + Supabase Auth gives a direct, well-supported path to per-user/per-project data isolation.
- Postgres supports the relational, migration-based model the product needs (audits, opportunities, jobs, approvals, usage/credit ledgers).

### Negative / Tradeoffs

- Couples the application to Supabase-specific auth semantics and RLS conventions; migrating auth providers later would require rework.
- RLS correctness must be verified per table as it is introduced — a missed policy is a data-isolation risk, not just a bug.

## Revisit when

A concrete requirement emerges that Supabase Postgres/Auth cannot satisfy (e.g. a specific compliance, scaling, or portability requirement), or the ADR-0006 execution model surfaces data-access needs incompatible with this setup.

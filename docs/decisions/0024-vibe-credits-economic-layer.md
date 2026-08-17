# 0024 - Vibe Credits as an Internal Economic Layer

Status: Accepted
Date: 2026-08-17
Builds on [0002](0002-supabase-postgres-and-auth.md), [0005](0005-ai-provider-abstraction.md), [0007](0007-audit-log.md), [0013](0013-durable-operation-execution.md)

## Context

Vibe already measures what providers charge it. `ai_usage_events` records inference against effective-dated per-token prices in integer nanodollars; `deep_scan_provider_usage`, `sandbox_usage_events` and `review_browser_usage` record browser and sandbox consumption. Each is authoritative for its own domain and each deliberately refuses to invent a cost the provider did not report.

What has never existed is the customer-facing half. `ARCHITECTURE.md §3.11` says so directly — *"The customer-facing Vibe Credit ledger is **not** implemented; no margin, credits, or billing exist yet"* — and records the conversion rate as an explicit **`[Open decision]`**.

Agentic Execution forces the question. A coding agent's cost is not one call with a predictable shape; it is a variable number of inference turns, plus sandbox compute, plus optional browser verification, plus repair loops that can run again. Building an agent that can spend an unbounded amount before an economic layer exists means discovering the ceiling by exceeding it.

The alternative considered and rejected was to bill provider units directly — charge a customer for tokens. It is simpler and it is wrong for this product: it couples the customer's mental model to one provider's pricing sheet, it makes a model swap a repricing event, and it cannot express a single operation that consumed tokens *and* CPU-milliseconds *and* browser-seconds.

## Decision

### 1. Vibe Credits are an internal currency, decoupled from provider units

A Credit is defined by Vibe, not by Anthropic. Provider usage is measured in the units providers actually bill (tokens, milliseconds, bytes); Credits are what a customer holds and spends. A provider price change and a customer price change are separate events with separate effective dates, and neither is permitted to imply the other.

This is the rule `PRODUCT.md §12` already stated as intent — *"Credits must **not** be directly equated with underlying provider tokens"* — made structural.

### 2. Supabase is the runtime authority for balances; payment providers only fund them

The credit ledger in Postgres is where a balance *is*. A future Stripe integration turns verified payment events into `purchase` ledger entries and does nothing else — it is a funding source, not a source of truth. No external system is ever consulted to answer "what is this balance?", because that answer must survive the external system being unreachable.

### 3. Balances are exact integers, never floating point

Credits are stored in integer subunits (1000 per displayed Credit) and provider cost in integer nanodollars, matching `ai/pricing.ts` exactly so the two layers reconcile without a unit conversion. A value that cannot be represented exactly throws rather than rounding.

### 4. A reservation is not a charge, and an estimate is not a reservation

Three distinct objects: a **quote** (estimate plus ceiling, authorizes nothing), a **reservation** (a hold against available balance, changes no posted balance), and a **charge** (an immutable ledger entry). Available balance is `posted − reserved`. Collapsing any two of these would make one of the three unanswerable.

### 5. Settlement may never silently exceed the approved maximum

An operation that rates above its reservation refuses with the shortfall stated rather than charging the difference. The ceiling a customer approved is a ceiling.

### 6. Unknown cost is never zero cost

A usage row Vibe cannot price carries an explicit `cost_unknown` / `rate_unavailable` status, never a zero. Three of the four provider ledgers report no price at all, so this is the common case — and a report that summed known and unknown into one total would be a measurement-shaped lie. Known and unknown are reported separately, always.

This is the same discipline the audit already applies to an unassessable dimension (CLAUDE.md rule 44): missing evidence is not a bad score.

### 7. Rating is versioned, and history never re-rates

A charge records the rate-card version that produced it. Activating a new card changes what future usage costs and cannot change what past usage cost. Rate cards live in code, effective-dated, mirroring `MODEL_PRICING` — so commercial policy is reviewed and diffable rather than edited in a console.

### 8. There is no production rate card, and one is not invented here

The registry ships empty. Real usage rates to `rate_card_not_configured` with a **null** Credit amount, which is the honest answer while the conversion rate remains an open product decision. A number here would look like a decision that nobody made.

### 9. Financial writes are exactly-once, enforced by the database

Every ledger entry and reservation carries an idempotency key under a unique index. A retried settlement, a replayed workflow step, a duplicate webhook and a double-clicked button all post one charge. Ambiguity resolves by *reading* durable state, never by retrying a financial write.

### 10. Clients cannot write financial rows at all

Every billing table has a SELECT policy for its owner and no INSERT, UPDATE or DELETE policy. Following the `free_audit_grants` precedent, the absence of a policy is the enforcement: a browser cannot mint Credits even if application code tried to let it.

## Consequences

**Easier.** Agentic Execution can be built against a quote → reserve → run → settle → release contract that already exists and is tested. Providers and models can change without touching customer pricing. Unit economics are answerable from real data today: the first reconciliation over Vibe's own history priced 54 AI calls at $3.358535, matching the existing ledger to the nanodollar.

**Harder.** Two price layers must both be maintained and effective-dated. A materialized balance exists for the atomic reservation primitive and must be reconciled against the ledger rather than trusted — the code does this and reports drift as a defect.

**Foreclosed.** Billing a customer directly in provider units. Deleting or editing a ledger entry — corrections are compensating entries only. Reading a balance from an external payment provider.

**Deliberately still open.** The Credit conversion rate, subscription allowances, margin, and whether a failed operation that consumed real provider spend is charged for. Core 1 records the usage fact and keeps the commercial question separate from it.

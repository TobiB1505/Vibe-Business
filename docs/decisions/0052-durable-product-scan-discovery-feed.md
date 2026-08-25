# 0052 - Durable Product Scan and bounded discovery feed

Status: Accepted
Date: 2026-08-25

## Context

Product Understanding already ran durably, but the repository and public-product readings that supplied it were started synchronously and exposed as separate controls. The onboarding wait and the Product page therefore described one conceptual Product Scan while the backend implemented several lifecycles. There was also no durable, ordered answer to “what did Vibe find as it scanned?”

The interface now needs one Product Scan in onboarding and My Product, with Motion driven by real individual discoveries. That motion cannot be powered by timers or invented activity, and the event record cannot become a place to copy repository contents, fetched HTML, prompts, model output or reasoning.

## Decision

`product_scan` is a first-class durable operation carried by the existing `operation_runs` and Vercel Workflow boundaries. One run:

1. refreshes bounded Repository Intelligence;
2. attempts the bounded static public-product reading when a production URL exists;
3. assembles Product Understanding from the latest usable source records;
4. persists the Product Profile and completes.

A source failure is recorded as unavailable and the run continues when another usable source exists. The existing Product Understanding prerequisite remains authoritative: if neither repository nor public-product evidence is usable, the operation fails before inference. The paid understanding step keeps its existing inference marker, usage ledger and zero-retry rule.

`product_scan_events` is an append-only, customer-readable projection of one run, limited to 24 ordered events. Event types, phase and source are closed vocabularies. Titles and details are composed by Vibe from deterministic derived facts and are bounded in both code and SQL. A stable event key makes workflow replay idempotent. The table may contain typed reference identifiers and derived counts, but never source files, file bodies, page bodies, full URLs with query strings, prompts, model text, provider errors, secrets or reasoning.

The same `ProductScanExperience` owns the visualization and discovery feed in two named variants:

- `onboarding` is the immersive Understand-phase surface inside the existing focused four-phase shell;
- `workspace` is the embedded Product Scan at the top of My Product.

Motion for React reacts to stored event arrival and layout state only. Existing events do not replay as new activity on initial mount. One bounded core impulse may accompany a newly observed event; a slow active-state breath pauses when the document is hidden. Reduced motion removes transforms, pulses and continuous motion without removing discoveries or status.

Historical `product_understanding` operations stay readable. New user-initiated scan paths use `product_scan`; no existing row is rewritten.

## Consequences

- Closing the tab no longer interrupts source refresh or Product Understanding.
- Onboarding and My Product share one lifecycle, one status vocabulary and one animation owner.
- A public-site failure can produce an honest partial result without discarding successful repository evidence.
- The discovery feed can explain progress after a reload without consulting provider logs.
- Every explicit re-scan may produce a fresh Product Profile and paid inference; duplicate active starts converge through the existing database claim.
- The migration must be deployed through the linked Supabase CLI workflow. Creating the migration does not authorize or perform a remote push.

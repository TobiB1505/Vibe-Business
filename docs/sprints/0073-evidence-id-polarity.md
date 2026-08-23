# Sprint 0073 — the inverted evidence label

Status: **Implemented and proven red-then-green. No migration, no id renamed.** The ROADMAP entry described id hygiene; what was actually there was a founder-facing sentence that said the opposite of the evidence behind it.

## The defect

`describeEvidenceId("repo.surface.payments")` returned **"Payments, in your code"**, `certainty: curated`. The pack that minted that id for a repository with no payments surface labels it *"Repository surface not detected: Payments"*.

So the "Why?" disclosure — `reasoning-trail.tsx`, `lens-detail.tsx`, `opportunities-panel.tsx`, `action-plan-panel.tsx` — told a founder their code contains a thing Vibe had just recorded it does not contain. Marked `curated`, so it did not even read as a degraded fallback. It applied to all 14 business surfaces and every live surface.

Verified by executing the real builder against a real fixture rather than by reading the code:

```
ID repo.surface.payments
  pack:   "Repository surface not detected: Payments"
  screen: "Payments, in your code"   [curated]
```

## Why it happened

`buildRepositoryEvidence` mints the same `repo.surface.<id>` whether it found the surface or not — the polarity lives only in the pack's `label`. `describeEvidenceId` resolves **from the id alone**, deliberately, so that a stored citation stays readable years later without re-deriving the pack it came from. Given a polarity-free id, it guessed presence.

`evidence-v2.ts` states the principle this violates, in its own comment: *"Polarity lives in the **id**, not only in the label."* It applies that to its own `auth.*` namespace, then imports and ships the v1 builders that do not.

## What the audit also found

- **`evidence-labels.ts`'s own comment was false.** It asserted `_not_observed` was "the authenticated **and repository** vocabulary". No minter has ever emitted `repo.surface.*_not_observed` — `evidence-v2.ts` emits it for `auth.surface.*` and nowhere else. The only place that string existed was the test's own expectation.
- **The test could not have caught this.** `FAMILY_IDS` was built from `Object.keys(BUSINESS_SURFACE_LABELS)` and then asserted to resolve *through* `BUSINESS_SURFACE_LABELS` — circular. It proved the label tables were self-consistent; an id a builder mints and the table lacks was invisible to it.
- **Four absence dialects exist** across the minters: `_missing` (live SEO), `_not_observed` (auth), `_not_found` and `.not_found` (product-understanding). The labeller knew two. `live.seo.canonical_missing` was reaching the screen as derived prose, suffix attached.

## What shipped

**Polarity-free ids stop claiming presence.** `repo.surface.*` and `live.surface.*` now render as *"Payments, checked in your code"* — naming the check, which is the only honest sentence available from an id that does not encode its outcome. Both call sites carry a comment explaining why the obvious phrasing is wrong.

**The absence-suffix set learned the other two dialects**, `_missing` and `.not_found`, and the false comment above it is replaced with what the three minters actually emit.

**The guard now harvests from the builders.** A new block runs `buildRepositoryEvidence`/`buildLiveEvidence` over fixtures and asserts every minted id renders without a leaked identifier — plus a `mints something to check` assertion, so an empty harvest cannot make the rest vacuously green.

**One test was asserting a fiction.** `carries absence through a family label too` pinned `repo.surface.payments_not_observed`, a string nothing produces. Rewritten against `repo.surface.robots.not_found`, which `product-understanding/evidence.ts` really emits.

## Proof

Reverting the three production edits turns two tests red (`does not claim presence from an id that does not encode it`, `carries absence through a family label too`) and restoring them turns them green. The first is the inversion itself, pinned.

## What this does not do

**No id is renamed and no migration runs.** Making polarity live in every id is a jsonb data migration across four persisted columns — `business_opportunities.evidence_ids`, `action_plan_steps.evidence_ids`, `business_readiness_audits.result`, `product_profiles.result` — and it would leave every already-stored citation rendering under the old, wrong polarity forever. It would also silently **downgrade risk classification**: `execution-contract/risk.ts`'s `surfaceIdOf` strips the namespace and matches the bare tail against its financial and security lists, so `repo.surface.payments_missing` would no longer match `payments` and a step to add a payments surface would fall from `prohibited` to `moderate`. That belongs in a versioned `v4` pack with a version-aware reader, alongside a `risk.ts` change in the same commit — not a rename.

**The two minters are not merged.** `business-audit/evidence.ts` and `product-understanding/evidence.ts` differ in purpose, not only in ids: the latter is a stricter minimization boundary (no file paths, `safeText` filtering, different priorities). Sharing the id table without sharing the label logic is the tractable subset, and it still costs the same migration.

**`live.surface.pricing_page` still renders derived.** The live surface label table does not carry every id `buildLiveEvidence` mints. The new harvest test tolerates derived output — it only forbids a leaked identifier — so this is visible but not failing. Named here rather than quietly widened.

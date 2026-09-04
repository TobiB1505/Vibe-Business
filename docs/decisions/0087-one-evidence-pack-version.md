# 0086 - What production builds, stamps and hashes is one constant

Status: Accepted
Date: 2026-09-04

Supersedes nothing. Repairs the mechanism [ADR 0044](0044-evidence-pack-v4.md) relies on and mints `business-evidence.v5`. Changes no execution authority, no approval path, and nothing about what the audit reasons *about* — only which pack version production names, and where a rebuild reads it from.

## Context

ADR 0044's central sentence is a mechanism, not an aspiration:

> The evidence pack version is part of `computeAuditInputHash`. Changing what the model sees therefore invalidates audit reuse by construction — which is correct, because a pack with different contents produces a different audit and reusing the old one would answer a question nobody asked.

Sprint 0078 shipped `business-evidence.v4` under that rule: polarised surface ids, `contradiction.*` evidence at priority 3, a widened `HASH_VERIFIABLE_PACKS`, a migration widening `business_readiness_audits_v3_has_profile`. The builder was switched. **The three places that name the version were not.**

From 2026-08-24 the audit therefore built a **v4** pack and recorded **`business-evidence.v3`** — on the row, and inside `computeAuditInputHash`, and in the currency check that decides whether a stored audit is still good. Read out of production on 2026-09-04:

| | |
| --- | --- |
| Audit rows stamped `business-evidence.v4` | **0**, ever |
| Audit *documents* saying `business-evidence.v4` | 4, newest 2026-09-04 |
| Those documents' citations of `contradiction.payments_not_reachable` | all 4 |
| `repo.surface_absent.*` citations across them | 6–9 each |

Two things followed, and neither is theoretical.

**ADR 0044's invalidation never happened.** The constant inside the hash did not move, so an audit built from a v3 pack and one built from a v4 pack occupy one identity space. For eleven days `getAuditCurrency` could report an audit built from materially different evidence as up to date — the same shape as the analyzer incident three days earlier, where `LIVE_PRODUCT_ANALYZER_VERSION` guarded reuse and did not move when the detector under it was corrected.

**Two consumers read two different fields for one fact.** In `operations/action-plans/execution.ts`, adjacent lines of one function:

```ts
pack: buildEvidencePackForVersion(sources, audit.evidencePackVersion),   // the row → v3
evidencePackVersion: audit.result.evidencePackVersion,                   // the document → v4
```

`audit` there is a `StoredAudit`, so the first is the row column. The Action Planner therefore rebuilt a **v3** pack — no contradictions, polarity-free ids — for an audit that cited one contradiction id and up to nine absence ids, and then stamped the plan `v4`. Both stored plans cite **zero** ids from either v4-only namespace, across twenty-six citations. That is the defect's fingerprint, not an inference about it. The Opportunity engine read the document and was unaffected, which is why the two disagreed rather than both being wrong.

Nothing failed. `runner.test.ts` asserted the runner's half against the literal `"business-evidence.v4"` and passed for eleven days, because no test compared the two halves.

## Decision

**One constant. Production builds, stamps and hashes the same version, and a rebuild asks one question.**

1. **`CURRENT_EVIDENCE_PACK_VERSION` and `buildCurrentEvidencePack` are the only names a paid path may use.** No route, service, runner or durable step may name a pack version or a version-specific builder. `current-pack-version.test.ts` asserts this against the source of all four paid sites, because the defect's shape was that every individual line was defensible and only the disagreement between them was wrong.
2. **A rebuild reads the audit document, never the row column.** The document is what `computeOpportunityInputHash` and `computeActionPlanInputHash` already hash, and the row column was the half that lied. Both durable consumers now read it, pinned by test.
3. **`business-evidence.v5` is minted**, and it is the current version.

### Why v5 rather than simply stamping v4

Because `buildIntelligenceCrossChecks` changed on 2026-09-04. It used to raise `payments-not-reachable` and `pricing-not-reachable` from the repository's view alone, so a site whose prices Vibe had *observed* was still reported as hiding them. The correction **removes** contradiction ids rather than adding them.

Sprints 0079, 0081 and 0082 each declined a bump on one argument: a new id is not a changed one, and a stored pack rebuilt today mints nothing it never cited. **The inverse does not hold.** Every stored v4 audit cites `contradiction.payments_not_reachable`; a rebuild that no longer mints it drops the citation, and `opportunities/validate.ts` discards an opportunity whose evidence cannot be verified — silently, as a data-quality note. So this is exactly the case those sprints' reasoning reserved a bump for.

Structurally v5 *is* v4: same builder, same polarised scheme, same contradiction namespace. What v5 names is the generation of cross-checker underneath it.

### What this deliberately does not do

**It does not make a stored v4 pack faithfully rebuildable.** `buildContradictionEvidence` calls today's cross-checker whatever version it is asked for, so a v4 rebuild gets today's answers, not August's. Restoring those would mean versioning `buildIntelligenceCrossChecks` itself.

That is not built, and the reason is stated rather than assumed: all four affected audits predate the `live-product-analyzer-v4` correction, so `getAuditCurrency` already refuses them and no new paid work can rest on one. Building a version switch to preserve the fidelity of four unusable dogfood audits would be complexity bought with nothing. `current-pack-version.test.ts` asserts the limitation as an equality rather than leaving it to be discovered — a v4 rebuild and a v5 rebuild produce identical items, and that is the honest statement of what v4 now means.

**It does not rewrite the four rows.** Their `input_hash` was computed with v3 in it; changing the column would make `verifyPackProvenance` recompute a different hash and refuse them as `inputs_changed`. They stay as the record of what happened, which is what a stored row is for.

## Consequences

**Every stored audit's identity is now stale**, which is ADR 0044's mechanism working for the first time. Combined with the `live-product-analyzer-v4` bump, no project can generate Moves or a plan from a stored audit until it re-scans (free) and re-audits (35 Credits). That is the correct outcome for evidence produced under a corrected cross-checker, and the provenance panel shipped the same day is where a founder sees why before paying.

**`HASH_VERIFIABLE_PACKS` and the database constraint move together, permanently.** Migration `20260904035533` widens `business_readiness_audits_v3_has_profile` to name v5, under the instruction migration `20260824012509` left in its own comment. `supabase/tests/evidence-pack-profile-constraint.migration.ts` is the test that migration shipped without: it asserts every guarded version refuses a row missing any of the four traceability columns, and that an unguarded pre-CORE-2 version is still accepted.

**A pack version literal in a paid path now fails a test.** Reintroducing either half of this defect — the stale constant, or the row-column rebuild — turns the pin red; both were verified by reintroducing them.

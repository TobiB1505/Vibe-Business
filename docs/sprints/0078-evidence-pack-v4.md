# Sprint 0078 — business-evidence.v4

Status: **Both halves of ADR 0044 shipped in one bump. One migration, not deployed.** The evidence-id polarity migration Sprint 0073 deferred, and the `contradiction.*` namespace Sprint 0077 needed, in the single version bump the ADR decided they should share.

## What a citation could not say

Through v3, `buildRepositoryEvidence` minted the same `repo.surface.payments` whether it found a payments surface or not. Polarity lived only in the pack's `label` — *"Repository surface not detected: Payments"* — which is not carried on the citation. [Sprint 0073](0073-evidence-id-polarity.md) found the consequence on screen: the "Why?" disclosure told founders their code contained a thing Vibe had just recorded it does not contain, marked `curated`, for all 14 business surfaces and every live surface. It fixed the sentence to name the check — *"Payments, checked in your code"* — and left the id alone, because renaming it is this sprint.

**A v4 citation can say what was found.** *"Payments, in your code"* is honest again, because that id is now minted only when the surface was.

## The research changed the design

ADR 0044 named one reader that a rename would break. There are four, and the fourth is the dangerous one because it does not break:

| reader | mechanism | under a `_missing` suffix |
|---|---|---|
| `risk.ts` `surfaceIdOf` | slice + exact `includes` | **breaks** — payments falls `prohibited` → `moderate` *(named)* |
| `execution-context/surface.ts` | slice + map/set lookup | **breaks silently** → `NOTHING`; the agent stops being told which surface its work is about |
| `validation/depth.ts`, `economy/execution-class.ts` | `startsWith` on bare prefixes | accidentally safe |
| `execution-contract/live-premise.ts` | `startsWith("live.")` && `endsWith("_missing")` | **silently widens** |

The last one changes a deliberate product decision by accident. [Sprint 0072](0072-live-premise-revalidation.md) narrowed the live-premise gate to defect ids on purpose — *"a positive surface's absence is ambiguous — renamed, behind auth, or simply not reached — and refusing a paid run on that guess is a worse failure than the one being prevented."* A `_missing` variant of `live.surface.*` would have re-included exactly those ids, and **nothing would have failed**. Paid runs would just have started being refused on ambiguous evidence.

**So polarity went into the namespace instead**: `repo.surface_absent.payments`. No contact with the four absence-suffix dialects, no fifth dialect added, and every existing `repo.surface.` prefix matcher keeps seeing only present surfaces. Where absence *should* also count — `validation/depth.ts`'s sensitive list — it is listed explicitly, which is a reviewable line rather than an accident of string matching.

## Polarity does not change risk

`risk.ts` and `surface.ts` drop polarity rather than reading it, and that is a decision rather than a shortcut. A step citing *"there is no checkout"* is a step that will build one, and building payment architecture is exactly what `prohibited` refuses. In that direction absence is the more consequential fact, not the softer one.

This is also why **no version threading was needed**, which the sprint expected and did not find: the version only matters where polarity itself changes the answer — the screen, and the pack rebuild. `classifyExecutionRisk` had no test of its own before this, the function that decides whether Vibe touches a change at all; it has one now, built around the equality with a guard that the two ids really differ.

## Both versions stay buildable, permanently

A stored audit's citations are resolved by **rebuilding its pack**, and `opportunities/validate.ts` discards an opportunity whose evidence cannot be verified against it — *"none of its evidence could be verified"*, reported as a data-quality note rather than a failure. Rebuild a v3 audit under v4 ids and every absence citation it recorded stops resolving, so a paid run quietly returns fewer Moves.

`buildEvidencePackForVersion` takes the version from the row. Three rebuild sites now pass the audit's own; two fresh-generation sites mint the newest. v4 is a parameter of the same builder, not a copied four-hundred-line file — the same reason v3 gives for reusing the v1 scanner halves rather than reimplementing them.

## The constraint that named a version literally

`business_readiness_audits_v3_has_profile` requires the CORE-2 columns for `evidence_pack_version = 'business-evidence.v3'`, spelled as a literal. `business-evidence.v4` satisfies `<> 'business-evidence.v3'`, so a v4 audit would have been free to omit the Product Profile entirely.

That matters beyond tidiness. `pack-provenance.ts` recomputes an audit's `input_hash` to verify a rebuilt pack came from the observations the audit reasoned from — the only check that can see the Deep Scan, which has no column — and it trusts those columns to exist for every version in `HASH_VERIFIABLE_PACKS`. v4 is now in that list, so the migration rewrites the constraint to cover both. Rewritten rather than added alongside: two overlapping constraints naming different version sets is how one quietly stops being maintained.

## Contradictions, finally in front of a model

`contradiction.*` items at priority 3 — the highest — because a contradiction is not one more observation to weigh beside the two facts that produced it, it is what those facts are for. Trimming drops it last.

Both prefix tables learned the namespace. Three times this session an id family reached the screen with no curated label and rendered as the identifier with its punctuation removed; `evidence-labels.ts` and `map-view.ts` are the pair that disagreed once before and produced *"from what Vibe understood · Signal pricing surface"*, so both are pinned.

## Proof

- Reverting both readers turns **11** tests red, including the `payments` drop from `prohibited` to `moderate`.
- Narrowing `HASH_VERIFIABLE_PACKS` back to exact v3 turns **2** red.
- Removing the `live.seo.*` family turns **21** red *(carried from Sprint 0075)*.
- The contradiction test builds a deliberately inconsistent product, because the default fixtures describe a consistent one — authentication in the code, sign-in reachable live — and correctly produce nothing, which would have made every assertion pass against an empty list.

## What this does not do

**The migration is written, not deployed.** It rewrites a CHECK constraint on a table with existing rows; every current row is v3 and satisfies both the old and the new form, so it is safe, but deploying is a separate deliberate act.

**No stored citation is rewritten.** `business_opportunities.evidence_ids`, `action_plan_steps.evidence_ids`, `business_readiness_audits.result` and `product_profiles.result` keep exactly what they hold. That is the property the version-aware reader exists to preserve — a record of what a model concluded must not be edited to match a newer vocabulary.

**The four absence-suffix dialects still exist.** `_missing`, `_not_observed`, `_not_found` and `.not_found` are unchanged; v4 adds a namespace, not a fifth suffix. Consolidating them is its own change and was not attempted here.

**`live.form.*` still renders `"Form login like login"`.** No label table exists for form kinds. Named in Sprint 0075 and still open.

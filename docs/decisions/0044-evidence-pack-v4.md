# 0044 — What `business-evidence.v4` is for

**Status:** Accepted (scope decided; not implemented)
**Date:** 2026-08-23

## Context

The evidence pack version is part of `computeAuditInputHash`. Changing what the model sees therefore invalidates audit reuse by construction — which is correct, because a pack with different contents produces a different audit and reusing the old one would answer a question nobody asked.

That makes a version bump cheap to *write* and expensive to *spend*. Two independent changes now both require one, and each was discovered in a different sprint:

**1. Evidence-id polarity** ([Sprint 0073](../sprints/0073-evidence-id-polarity.md)). `repo.surface.<id>` and `live.surface.<id>` are minted whether the surface was found or not; polarity lives only in the pack's label. 0073 fixed the founder-facing sentence — a polarity-free id now names the check rather than claiming presence — and deliberately did not rename the ids, because a rename is a jsonb migration across four persisted columns (`business_opportunities.evidence_ids`, `action_plan_steps.evidence_ids`, `business_readiness_audits.result`, `product_profiles.result`) that would leave every already-stored citation rendering under the old, wrong polarity forever. It would also silently downgrade risk classification: `execution-contract/risk.ts`'s `surfaceIdOf` strips the namespace and matches the bare tail against its financial and security lists, so `repo.surface.payments_missing` would stop matching `payments` and a payments step would fall from `prohibited` to `moderate`.

**2. Contradictions reaching the model** ([Sprint 0077](../sprints/0077-contradictions-across-three-layers.md)). `buildIntelligenceCrossChecks` computes six deterministic disagreements between the code, the public site and the signed-in product. They render on the project page and are invisible to every model call, because there is no `contradiction.*` evidence namespace to carry them into the pack.

## Decision

**`business-evidence.v4` carries both changes, in one bump, designed together.**

Not two bumps. Each invalidates every audit identity, and spending that twice for work that lands in the same artifact is waste that the users pay for.

Not now. Both halves need a version-aware reader — v4 must render a stored v3 citation correctly rather than reinterpreting it — and half of one of them is a data migration across four columns plus a coordinated `risk.ts` change in the same commit. That is a sprint, not a follow-up.

## What the implementing sprint must not miss

**`verifyPackProvenance` discriminates on an exact string.** `business-audit/pack-provenance.ts` recomputes an audit's own `input_hash` when `evidence_pack_version === "business-evidence.v3"` and otherwise falls back to comparing the columns a pre-CORE-2 row records. A v4 row would take the **fallback** path — the weaker one, written for rows that predate the profile columns entirely. The check must become "v3 or later" in the same commit that introduces v4, or the strongest provenance guarantee silently disappears for every new audit on the day v4 ships.

This is recorded here because it was found by scoping the work rather than by doing it, and it is exactly the kind of interaction a hurried bump loses.

**`risk.ts` moves with the ids, or not at all.** See above: a renamed id that no longer matches the financial list downgrades a payments change from `prohibited` to `moderate`. The rename and the matcher change are one commit.

**A `contradiction.*` namespace needs a curated label family and a source prefix.** `evidence-labels.ts` and `map-view.ts` are two tables covering the same prefixes, and an id whose family neither knows falls through to derived prose — `"Contradiction pricing not reachable"`. Sprint 0073 and [Sprint 0075](../sprints/0075-the-gate-nobody-read.md) each shipped a fix for exactly that failure; a third would be careless rather than unlucky.

> **[2026-08-24] Implemented in [Sprint 0078](../sprints/0078-evidence-pack-v4.md). The decision above stands; two things it said were incomplete.**
>
> **"`risk.ts` moves with the ids" named one reader. There are four.** `execution-context/surface.ts` slices the same namespace into a map lookup and would have returned `NOTHING` — not an error, just an agent quietly no longer told which surface its work is about. `validation/depth.ts` and `economy/execution-class.ts` match bare prefixes with `startsWith` and were accidentally safe. And `execution-contract/live-premise.ts` selects ids with `startsWith("live.")` && `endsWith("_missing")`, which does not break at all: a `_missing` variant of `live.surface.*` would have silently re-widened the gate Sprint 0072 deliberately narrowed to defect ids, and paid runs would have started being refused on exactly the ambiguous evidence 0072 excluded.
>
> That last one is why the implementation puts polarity in a **namespace** (`repo.surface_absent.<id>`) rather than in the `_missing` suffix this ADR implicitly assumed. It adds no fifth entry to an absence vocabulary Sprint 0073 already called too many, and it leaves every existing prefix matcher seeing only present surfaces — so absence has to be added to each one deliberately.
>
> **No version threading was needed.** The sprint expected to thread the pack version from the plan through the resolver, dependencies and the context compiler, because a step does not carry its own `evidence_pack_version`. It turned out not to be necessary: `risk.ts`, `surface.ts` and `depth.ts` do not care about polarity — a step citing "there is no checkout" is a step that will build one, and that is exactly as prohibited as modifying an existing one. The version matters only where polarity itself changes the answer: the screen, and the pack rebuild.

## Consequences

Contradictions stay out of every model call until v4 ships. They remain visible to the founder on the project page, which is where they were already.

The four evidence-id dialects (`_missing`, `_not_observed`, `_not_found`, `.not_found`) stay as they are, and `repo.surface.*` / `live.surface.*` still encode no polarity. The label layer compensates honestly, per 0073.

Stored citations keep meaning what they meant when written. That is the property the version-aware reader exists to preserve, and it is why neither half is a rename in place.

# AUDIT UI-1.1 — Visual Fidelity Pass

**Status:** implemented; full browser validation and real-project dogfood pending.

## Problem

The Audit was semantically correct but visually too dashboard-like. The conclusion, map,
blockers, strengths and evidence all existed, but their weighting diverged materially from
Direction 1b, “AI Intelligence System”: the map was small and dark, its nodes were dots, and a
full nine-Lens list beside it repeated the same information more loudly than the model itself.

The before reference is the `/score` screenshot supplied with the sprint brief. The canonical
design reference is `Vibe Business Audit.dc.html`, Direction 1b.

## Changes

- Restored the overall conclusion as the hero and kept the readiness score in the metadata line.
- Enlarged the radial Business Map and turned its nodes into readable Intelligence objects.
- Removed the duplicate desktop Lens list from the hero; the mobile priority groups remain.
- Moved actual strengths, blockers and “Where I’d start” beside the Map as its interpretation.
- Made the first blocker visibly primary without manufacturing a third blocker or filling quotas.
- Strengthened rings, truthful connections, selection, typography, contrast and restrained motion.
- Compressed Lens Detail into an assessment/relationships layout with evidence one disclosure down.
- Kept the five legacy dimensions collapsed under a clearly labelled Technical breakdown.
- Brought preparing, analyzing and `needs_user` into the same intelligence-system visual family.

## Architecture intentionally unchanged

- Fixed Lens angle remains Lens identity; radial distance remains Materiality.
- Health remains independent from Materiality, with bone/amber/coral/unclear status treatment.
- Mint remains Vibe attention/NOW and never means healthy.
- Connections remain undirected and use “Judged together with”; no causal arrows were added.
- The Audit synthesis, rubric, prompt, evidence, provenance and customer-language boundaries are unchanged.
- The accessible Lens controls and the ordered mobile Lens groups use the existing Business Map view model.
- `preparing`, `analyzing`, `needs_user` and `completed` retain their existing lifecycle semantics.
- No fake Lens progress, dependency direction, blocker, strength, Move or CTA was introduced.
- Next Moves still comes only from the Opportunity Engine and links to `/moves` only when it exists.

## Before / after

Before, the screenshot showed a small dot map, a dominant nine-row duplicate list, weak conclusion
hierarchy and large areas of undifferentiated black. After, the implementation follows the 1b
composition: answer first; a large connected model with business interpretation; optional selected
Lens detail; reasoning; and collapsed technical data.

No production screenshot is committed by the current workflow. Add one only after the real signed-in
Audit has been dogfooded at the required desktop, tablet and mobile widths.

## Residuals

- Browser screenshots at 1440, 1280, tablet and 375px still need to be captured against a running app.
- Real Vibe Business Audit dogfood still needs a signed-in production/local session with current Audit data.
- Lint, typecheck, unit, integration, build and E2E results must be recorded after validation is run in an
  environment permitted to execute the repository toolchain.


# UI-14 — Business Brain Focus Workspace

Status: Implemented, browser verification pending

Date: 2026-08-24

## Outcome

Selecting a Business Brain planet now changes the page into the supplied focus
composition rather than rendering one long technical side card. The map stays
interactive, the selected dimension receives a structured diagnosis surface,
and wide screens add a narrow scoring-context rail. On smaller desktop and
mobile layouts the same regions stack without losing the map, controls or
evidence.

The detail surface uses keyboard-operable Overview, Evidence, Signals and
History tabs. Overview separates what Vibe found, why it matters, real connected
areas and the lineage-backed next Move. Evidence and source-grouped signal
counts come from the dedicated Business Brain view model. Per-dimension history
is not available, so History and the scoring rail state that absence instead of
drawing the reference's fictional trend line.

Scalability's unassessable planet is slightly larger and moved inward to remove
the accidental upper-left void while preserving materiality as the sizing rule.
Motion for React owns focus entry, tab presence and grid transition; reduced
motion keeps the same content with short opacity changes only.

The refinement pass replaces typographic placeholder marks with larger,
purpose-drawn SVG symbols across planets, insight cards and scoring context.
Overview and selected detail now overlap in one reserved grid area during a
synchronized crossfade, removing the visible black frame between states. The
three-column focus composition also begins at the real 1440px desktop viewport,
keeping the scoring rail beside the detail surface instead of dropping it below.

## Verification boundary

The repository security policy prevented starting the local Next.js server
outside the isolated sandbox, so the real-browser screenshot comparison remains
pending for the next deployed preview. Static premium audit, typecheck, tests
and production build remain the available completion gates in this workspace.

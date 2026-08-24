# UI-15 — Product Understanding Reference Fidelity

Status: Implemented, browser screenshot verification pending

Date: 2026-08-24

## Outcome

The project Product page now reads as one product dossier rather than a series
of scanner summaries. The reference hierarchy is reproduced with the data the
product already owns: a strong identity overview, four evidence-bound Product
DNA facts, founder intent, supported capabilities, the full observable journey,
brand and visual identity, and the sources Vibe learns from.

The reference screenshot was deliberately not copied because no trustworthy
product screenshot is stored in the Product Understanding read model. Its space
is used for a compact product read made only from real identity, capability and
source-coverage fields. Unknown DNA, founder intent, brand and source states are
rendered as explicit absences and never substituted with reference content.

Existing Product Understanding corrections remain the authority boundary. The
confirmation/correction surface closes the dossier, technical findings remain
available behind disclosure, and each source card still leads to its existing
evidence or setup destination. The route adds no database, provider, inference
or domain-semantic change.

## Verification boundary

Static and build verification run in this workspace. Starting the built Next.js
server for screenshot comparison was refused by the repository execution
policy, so desktop/mobile visual comparison remains for the next deployed
preview.

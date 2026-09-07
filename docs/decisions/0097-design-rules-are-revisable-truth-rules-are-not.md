# 0097 - Design rules are revisable; truth rules are not

Status: Accepted
Date: 2026-09-06

States the amending cost of the design documentation, which had never been written down. Aesthetic rules — composition, register, technique, restraint, motion character — may be rewritten in place whenever a better argument exists, with no ADR. Rules about what the interface may *claim* keep the standing of the security invariants, and changing one still needs a record.

## Context

Three rules in `.claude/skills/` had fallen behind `DESIGN.md`, the document they implement, and all three were found and corrected within a day of each other:

- `motion-design`'s Quiet tier said state changes on ordinary surfaces are *immediate*, which read as permission to ship a settings page that snaps.
- `aceternity-ui` carried *never on: dashboards, billing, profile, settings, tables, index pages, forms*.
- Both are category refusals of the kind `DESIGN.md` had already retired for itself — *no visual technique is refused by category… that list is retired as a list, and its judgement is kept as a test.*

The corrections landed in `0987c48f` and are not what this record decides. What it decides is the thing whose absence let them sit there in the first place.

Because nothing said those rules were cheap to change. `DESIGN.md`, `CLAUDE.md` and the twelve skills read as one rulebook, and the repository's rulebook is mostly made of invariants — never execute untrusted code, never fabricate a metric, never move a branch a human did not approve. A rule about whether an aurora suits a settings page had, on the page, exactly the same standing as a rule about merging to a customer's default branch. So it was obeyed rather than argued with, and it stayed after the thinking behind it had moved on.

That is a documentation defect with a real product cost. The brief for this design system is deliberate ambition — heavy motion, glass, a screen that feels considered on every click. A rulebook whose aesthetic clauses cannot be revised without ceremony will lose that argument by default, every time, to whoever wrote the clause first.

## Decision

### Two classes, named where the rules are read

**Design rules are revisable in place.** Composition, hierarchy, register, material, motion character, typography, restraint, which technique suits which surface. Whoever has a better argument rewrites the rule and says why. No ADR, no ceremony. Being cheap to change is what keeps them true.

**Truth rules are not.** They govern what the interface may claim, and they are invariants:

- No fabricated metric, count, percentage, progress or success state.
- No motion asserting a state Vibe has not observed.
- Missing evidence is `null` and says so — never zero.
- No control whose label misdescribes what pressing it does.
- No affordance that appears available and is not.

Changing one of those is a product decision and still needs a record.

The line itself is not new. `DESIGN.md` already separates *ambitious* from *false* — "the design may be experimental, the state model may not". What is new is saying which class a given rule belongs to, so a session does not have to infer it from tone.

### Where it is stated

`DESIGN.md` and `.claude/skills/ui-design-system/SKILL.md` carry the distinction at the top, because those are the two documents a session reads before touching UI.

## Consequences

The design documentation will change more often, and two people can now disagree about taste with no invariant to appeal to. That is the trade, and `DESIGN.md`'s five questions are the arbiter it leaves in place.

Rule 83 is unaffected: a rewritten design rule still has to leave `DESIGN.md` true at HEAD, and a retired claim still goes to `RETIRED_CLAIMS`.

The chat study built alongside this decision is the worked example of the line holding in both directions. It puts a text composer on Nova Home — a shape `DESIGN.md` had no rule about and that a stricter reading of "not a chatbot" would have refused — because the familiarity is worth having. And the composer is visibly disabled, with Nova saying in her own words that she cannot read replies yet, because a field that looked live and swallowed input would be the interface claiming a capability the product does not have. The design was free to move. The claim was not.

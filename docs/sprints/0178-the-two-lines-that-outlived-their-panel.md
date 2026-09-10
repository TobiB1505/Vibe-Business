# Sprint 0178 — The two lines that outlived their panel

**Date:** 2026-09-08
**Decision:** none. One removal, on the four public auth routes.

## What was asked

*"Mach die unteren 2 Checkboxen noch weg, sonst gut."*

## What was wrong

The two assurances — *Changes land on their own branch*, *Nothing merged without your approval* — were written for the left panel of a split screen, where the panel's job was to say something while the form did the work. Sprint 0177 deleted the panel and kept its content, moving both lines under the form.

That is the failure mode of a layout change: the argument for a piece of content was "the panel needs something", and when the panel went, the content stayed on an argument that no longer existed.

Both sentences are true, and both are still the right thing to say **where the decision is made** — the landing page, and the connect screen that asks for the repository grant. On `/login` a person is getting in; on `/signup` they have already decided. Restating the promise there made the column longer without making it more convincing.

## What was built

The `assurances` prop is gone from `AuthShell`, and with it the block, both call sites and the comment on `/forgot-password` explaining why *that* screen had none — an absence that no longer needs explaining now that it is universal.

Nothing else on the screen moved.

## What the guards say

Nothing new. No test asserted the lines were present, which is worth recording: they were furniture, and a claim nobody guards is usually a claim nobody depends on. The existing browser guards — the centred column, both providers with their marks, the reveal, the recovery link beside the label — all still hold, and the shorter column does not move any of them.

## Validation

Unit 8,853 · browser 614 · lint 0/0 · typecheck clean · no migration.

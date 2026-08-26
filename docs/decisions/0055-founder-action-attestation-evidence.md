# 0055 - Founder actions complete from explicit immutable attestation

Status: Accepted
Date: 2026-08-26

## Context

Action Plans distinguish strategic founder decisions, factual founder input,
manual founder actions, Agent work and external dependencies. ADRs 0053 and
0054 established authoritative completion for every integrated authority except
manual founder work. A `founder_action` step therefore remains open even after
the founder performs its real-world task.

A universal completion checkbox would erase the taxonomy and could let a
founder complete Agent work without validated execution evidence. Manual work
needs its own narrow authority: the founder's explicit testimony that the exact
immutable step's completion criterion is true.

## Decision

`founder_action` completion is projected from an immutable
`action_plan_founder_attestations` row. The row binds the owning project, exact
Action Plan, step key and step order, records the authenticated founder and
time, and carries a versioned attestation contract. The completion criterion is
not copied: it remains on the linked immutable Action Plan step, so the evidence
cannot drift from what the founder confirmed.

Only the current actionable `founder_action` / `founder_acts` step of a current
plan receives the confirmation control. The server re-reads that state before
writing. A service-role-only database function repeats project ownership and
step-taxonomy checks, and retries converge on one row per plan step.

Attestations have no update or delete path. They are historical evidence, not a
mutable checkbox. Replanning creates a new immutable step identity and requires
new evidence. Agent and external-party steps remain unaffected and cannot be
completed by this mechanism.

## Consequences

- A real-world founder task can unblock its dependent steps without weakening
  Agent completion authority.
- The UI shows the exact completion criterion before the founder confirms it.
- Duplicate submission is idempotent at the database boundary.
- An accidental or disputed attestation has no revocation workflow in V0.1;
  correction requires replanning. A future revocation policy must account for
  already-started dependent work rather than treating completion as a toggle.
- `external_party` completion remains deferred until its evidence authority is
  explicitly defined.

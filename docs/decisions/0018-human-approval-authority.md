# 0018 - Human Approval Authority

Status: Accepted
Date: 2026-08-14
Builds on [0014](0014-first-execution-safety.md), [0016](0016-temporary-preview-isolation.md), [0017](0017-visual-review-artifacts.md)

## Context

Every gate before this one is a machine reporting on itself. The bytes matched. The commands exited zero. The artifact ran. Two screenshots exist. None of them is a decision, and the product has deliberately said so at every step: *Not merged · Not deployed · Not reviewed by a human.*

This ADR adds the first object that is a decision. It is also the first object Sprint 11C will read as a *reason to write to a customer's default branch*, which is what makes its shape worth arguing about now, while it still costs nothing.

## Decision

### 1. Approval is a domain object, never a boolean

Not `prepared_changes.approved = true`. Not `review_artifacts.approved = true`.

A boolean cannot answer the only question that matters at merge time: **approved what, exactly?** It survives a regenerated commit, a second validation and a fresh comparison, and quietly comes to mean *approved whatever is on the branch now* — the one sentence a merge must never be built on.

`change_approvals` is a row naming the exact artifact a human saw.

### 2. Approval binds to an exact artifact, and the binding is a hash

The identity is the project, the prepared change, **the commit**, **the base it was prepared against**, the validation run, the review artifact and the policy version. Change any one and it is a different thing to approve.

That is enforced by construction rather than by vigilance: a new artifact has a new identity, the partial unique index does not cover it, and re-approval is the only path forward.

The commit and base are also **copied onto the row**, not left to a join. If a preparation is ever re-run and rewrites its own commit, the approval must still be able to say which commit the human actually looked at — a join would quietly answer with the new one.

### 3. A completed review is required

V0.1 does not allow validation-only approval. Approval means *I looked*, and there has to be something that was looked at.

If the comparison is past its seven-day retention, approval is refused with its own reason: the images are gone, and approving evidence nobody can open is a click, not a review. The inverse is deliberately **not** true — an approval already given is never invalidated by its evidence aging out. A decision made while the comparison was viewable stays a decision.

### 4. The preview does not have to be alive

This is the lifecycle [ADR 0017 §8](0017-visual-review-artifacts.md) exists to make possible:

```
preview → comparison captured → preview stopped → human reviews later → approval
```

Nothing in the approval path reads a preview session. Requiring one would mean keeping a paid sandbox running so that a decision remains possible, which is exactly the incentive the review artifact was separated to avoid.

### 5. Approval grants no merge authority

`status = 'approved'` says: *a human approved commit X as represented by review Y.*

It does not say the default branch is where it was, that the branch still exists, that GitHub would accept the merge, that branch protection allows it, or that the caller still has permission. Every one of those is current external state, and Sprint 11C revalidates all of them immediately before it writes — stored evidence is a routing signal, never permission (CLAUDE.md rule 55).

The codebase says this in a function rather than only in prose, so anything tempted to treat the status as permission has to walk past the argument first.

### 6. External repository movement does not unmake a human's decision

The inverse of §5, and easier to get wrong.

If `main` moves after an approval, the approval stays `approved`. The merge becomes unsafe — a different sentence, decided at a different time, by a different check. Folding the default branch's head into the approval identity would mean every unrelated push silently revoked a decision nobody revisited.

**Approval identity and merge eligibility are separate questions.** This ADR only answers the first.

### 7. What *does* end an approval is a change to the approved artifact

Three reasons, each recorded:

| Reason | What changed |
| --- | --- |
| `prepared_change_modified` | the commit or base is no longer the one approved |
| `validation_superseded` | a newer passing validation replaced the approved one |
| `review_superseded` | a newer ready comparison replaced the approved one |

An invalidated approval is never retargeted and never deleted. It is shown as *previous approval no longer applies*, with the commit it did apply to, and re-approval is explicit.

The transition happens **when someone looks**, not on a timer — the same honest model preview expiry uses, because nothing in this product runs in the background and claiming otherwise would be a promise nothing keeps.

### 8. Revocation preserves history

Revoking sets a status and a timestamp. It does not delete the row, `approved_at` is never cleared, and there is no delete policy in the database — so the product cannot destroy the record of who authorized what, even by accident.

Re-approving after a revoke creates a **new row**. The old decision is not resurrected, because it was withdrawn and that happened.

### 9. Explicit confirmation, enforced on the server

The confirmation travels as an argument. A dialog closing is a fact about a browser; it authorizes nothing. An unconfirmed call is refused before any state is read, leaving no row and no audit event — the same discipline as the preview's public-exposure confirmation ([ADR 0016](0016-temporary-preview-isolation.md)).

### 10. The client names identifiers; the server names everything else

Three ids and a boolean. The client cannot name the approver, the commit, the base, the validation run, the policy version, the timestamp or the status — there is no parameter to put them in.

The review artifact id it *does* send is checked against the one the server resolves, so a stale tab cannot approve a comparison that has since been replaced.

### 11. RLS verifies the linkage, not just the ownership

Approval is a human action, so it is **not** service-role-only. It runs under the user's own session, which means the database is a real second gate — and this time it is used for more than ownership.

The insert policy independently verifies that the prepared change is at that commit and base, that the validation passed, and that the review artifact is ready and bound to both. A caller holding nothing but an authenticated token cannot record an approval for bytes that were never prepared, never validated or never reviewed — not because a code path declined, but because the row cannot exist.

This is the direct lesson of the last two sprints, where *the application checked, so the database does not need to* silently failed twice — once as a refused write that was swallowed ([ADR 0016 §14](0016-temporary-preview-isolation.md)), once as a refused read rendered as a loading state ([ADR 0017 §9](0017-visual-review-artifacts.md)). Both times the gap was invisible.

### 12. No durable operation

Approval is one bounded transaction with no external side effect: no sandbox, no browser, no model, no GitHub call. Durability in this codebase exists for work that outlives a request *because a provider is doing something expensive or irreversible* — not for work that merely matters.

The deciding question is authority and side effects, not importance. Making approval durable would put a queue between a person clicking and the product recording what they decided.

### 13. No AI may approve

There is no code path by which a model can create, influence or recommend an approval, and no AI call anywhere in this sprint. `executionReadiness` was already established as a model *opinion* rather than authority ([ADR 0014](0014-first-execution-safety.md)); approval is the point where that distinction becomes load-bearing.

## Consequences

### Positive

- A merge preflight can ask "is what I am about to merge what was approved?" and get an exact answer from one row.
- A human's yes cannot drift onto bytes they never saw.
- Approval history survives revocation, invalidation and product flows.
- Approval costs nothing: no provider call, no AI call, no repository call.

### Negative / Tradeoffs

- **Re-validating a change invalidates its approval.** A second validation of the *same commit* produces a new validation run, which changes the identity — so the human must approve again, and (because a review is bound to its validation) must generate a new comparison first, which costs a browser session. This follows the sprint's explicit instruction that a new validation must not carry an approval forward. The looser alternative — binding to the commit and review while accepting any passing validation of that commit — would avoid the cost and is worth revisiting if it bites in practice.
- **Owner-only.** The project model has exactly one owner, so approval authority is the project owner. Multi-approver, separation of duties and "someone other than the preparer must approve" are all real requirements that do not exist yet, and inventing a role system here would have been speculative.
- **The invalidation transition is lazy.** It happens when a read notices, so an approval can sit in the database as `approved` after the artifact moved on until someone opens the page. The card never lies — it derives the state before the write — but a direct database reader could see a stale status.
- **Approval is not proof of review.** A user can approve without scrolling. The product can require that evidence *exists*, not that a person absorbed it.

## Related

- [0014](0014-first-execution-safety.md) — model output is never authority. §13 above is where that becomes load-bearing.
- [0016](0016-temporary-preview-isolation.md) — the confirmation discipline, and §14 there, where "the application checked" first failed.
- [0017](0017-visual-review-artifacts.md) — the evidence approval requires, and why it outlives the preview.

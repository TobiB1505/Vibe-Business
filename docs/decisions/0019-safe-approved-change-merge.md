# 0019 - Safe Approved Change Merge

Status: Accepted
Date: 2026-08-14
Builds on [0013](0013-durable-operation-execution.md), [0014](0014-first-execution-safety.md), [0018](0018-human-approval-authority.md)

## Context

Every repository write Vibe has made so far went to an isolated `vibe/…` branch that nothing was running. This ADR covers the first write to a branch a customer's product is deployed from.

That is a change of kind, not of degree. A wrong commit on an isolated branch is a branch nobody has to look at. A wrong commit on `main` is in someone's production pipeline within seconds, and — because Vibe cannot roll back and does not intend to — it is not something the product can take back.

[ADR 0018](0018-human-approval-authority.md) deliberately left the second half of this question open. It established that an approval binds to one exact artifact and that a moving default branch does **not** unmake a human's decision. What it explicitly did not answer is whether a merge is *currently safe*, which is a question about the world rather than about intent.

## Decision

### 1. A merge requires two authorities, and neither substitutes for the other

**Immutable human intent**, and **fresh external state**.

- The approval says a person approved commit X against base Y. It is history. It cannot change, and a push to `main` does not revoke it.
- GitHub says where the default branch is *now*. It is current, it can change between the click and the write, and it is never read from a stored snapshot.

An approval alone would write bytes onto a branch that has moved. Live state alone would write bytes nobody approved.

This is the durable learning of the sprint, and it generalizes past merging: **consequential writes must be authorized by both immutable human intent and fresh external state.**

### 2. The approval must be the exact one, resolved by identity

Not "the latest approval for this prepared change", and not "any approval". The merge resolves the approval for the artifact currently on screen by the same identity function the approval module uses — one resolution, shared, because two would eventually disagree, and the disagreement would be a merge authorized by an approval of something else.

Revoked, invalidated, absent, bound to a different commit, bound to a different base, bound to a different prepared change: each blocks, and none of them reaches GitHub.

The durable step re-resolves it immediately before the write. An approval revoked between the click and the queue must stop the merge, and a row id that was valid when it was stored says nothing about whether it still stands.

### 3. Fast-forward only, and only the exact class Vibe produces

V0.1 supports one shape:

```
prepared commit's parent  == recorded base
current default HEAD      == recorded base
```

Then moving the default ref to the approved commit is a **fast-forward**. No merge commit is created, no content is generated, no history is rewritten, and there is nothing to resolve.

This is deliberately not a merge engine. It closes one loop — prepared from base X, reviewed as commit Y, approved as commit Y, `main` still X, `main` becomes Y — and refuses everything else. General merging can come later, on evidence rather than on anticipation.

### 4. A moved default branch blocks; it never triggers reasoning

If `main` is no longer at the recorded base, the merge is refused with a stable code and **no GitHub write**.

Vibe does not merge `main` into the prepared branch, rebase, cherry-pick, create a merge commit, regenerate the change, resolve conflicts with a model, or create a new approval target. Nor does it start a refresh chain: a blocked merge explains what changed, and the user decides what to do about it. Repository analysis, audits, opportunity generation, preparation, validation, preview and review all cost provider time, and none of them may be started on the user's behalf (CLAUDE.md rule 60).

### 5. No force, structurally

The merge capability has its own port with five operations. There is no `force` parameter to set, no `deleteRef`, no general `updateRef`, and nothing that creates content.

"We never force" is therefore a property of the type rather than a claim about the code. The adapter also passes `force: false` explicitly rather than relying on the documented default, so the guarantee is visible at the call site.

Sprint 9's `GitWritePort` — which has no `updateRef` and no `deleteRef`, and so structurally cannot move a default branch — is left untouched. Adding default-branch mutation to it would have spent that guarantee to save a file.

### 6. Branch protection is the repository owner's authority

If GitHub rejects the update because of branch protection or a ruleset, that is classified as its own outcome and reported as *this repository requires a different merge process; Vibe did not bypass your protection rules*.

Vibe does not request Administration permission, does not suggest weakening the rule, and does not frame the refusal as the user's error. Rulesets phrase this refusal as "Changes must be made through a pull request" rather than anything containing the word "protected", which is worth classifying carefully: read as a permission failure it would send a user to reconnect their installation when their own rule had simply worked.

PR-based merge flows for protected branches are a plausible later sprint. They are not this one.

### 7. Ambiguous writes are reconciled by reading, never by retrying

The default-branch update is `maxRetries = 0`, for the same reason every billed provider call in this codebase is — except the thing that must not happen twice is a write to a customer's repository rather than a charge.

On an ambiguous outcome (a timeout, a dropped socket, a 5xx) the step **reads the branch** and lets the observation decide:

| Observed head | Conclusion |
| --- | --- |
| the approved commit | the write landed; continue to verification |
| the recorded base | the write did not land; **fail, do not retry** |
| anything else | stop — `merge_ambiguous_write` |

Recovery from the middle case is a fresh, explicit human action, which re-runs the entire preflight. That is the explicit safe retry policy, and it is safe precisely because it is not automatic.

The row records that a write was attempted **before** the call is made, never after. A row with `started_at` set and no outcome is exactly the ambiguous case, and it stays legible after a crash.

### 8. Read-back verification decides, not the write's response

A 2xx is a claim about a request. `merged` requires an independent read of the default branch afterwards, and **exact equality** with the approved commit.

Not "the branch changed", not "it moved forward", not "it contains our commit" — each of those has a reading under which somebody else's merge reports as our success.

The database enforces the same rule from below: a `merged` row whose observed result is not the approved commit — including null — violates a CHECK constraint. Application logic performs the verification; the constraint means a bug in that logic cannot produce a row claiming a merge that did not happen.

### 9. The prepared branch is retained

After a merge, success or failure, the `vibe/…` branch stays. Auditability, easy inspection, one fewer destructive side effect, and no branch-cleanup policy has been designed. The port has no operation that could delete it.

### 10. Durable execution, and a service-role-only outcome

A merge is a consequential external write, an independent read-back, a database convergence and an audit event. None of those may depend on the initiating HTTP request staying open (ADR 0013).

The privilege split is the strongest form available: a human may **request** a merge through their own session, where the insert policy independently verifies the prepared change, the commit, the base, an active approval by that user, the repository connection and the operation. But there is **no update policy on the table at all**, so every authoritative transition — merging, merged, blocked, failed, the resulting SHA, the failure code — is unreachable from a browser by construction. And no delete policy: a default-branch write leaves a permanent record.

### 11. `blocked` and `failed` are different sentences

`blocked` means the repository was never touched. `failed` means a write was attempted and did not end verified.

The status decides which one is recorded, not the caller — the row is the only thing that knows how far it got. A terminal error handler that guessed would report a write that never happened on every unexpected error during authorization, and on a default branch those two sentences are not shades of one another.

### 12. A merge is not a deployment — and "no production effect" would still be false

`merged` means one thing: the default branch points at the approved commit, and Vibe read it back to confirm.

Vibe calls no deployment provider, before or after. But moving a default branch routinely triggers the customer's own CI/CD, and claiming "no production effect" would be a reassurance the product cannot make. So the confirmation says both, **before** the click: *this does not deploy your application; Vibe will not call a deployment provider* and *updating the default branch may trigger your repository's existing CI/CD or hosting automation.*

The success state carries the disclaimer as a field on the server's card rather than as a string in a component, so it survives a redesign.

### 13. The client names three identifiers and a confirmation

A project id, a prepared change id, an approval id, and an explicit `confirmed`.

It cannot name the repository, the owner, the installation, the default branch, the base SHA, the target SHA, the branch name or the merge strategy — not because those are validated and rejected, but because there is no parameter to put them in. A caller who could name the target SHA could move a default branch to bytes no human ever approved.

## Consequences

### Positive

- The first default-branch write in this product cannot happen without an exact human approval and a live agreement from GitHub.
- The worst case of every race is a refusal: the only write available cannot overwrite anything.
- An interrupted merge is legible afterwards and is never resolved by writing again.
- A merge that did not verify cannot be stored as a success, even if the application's check were removed.
- Blocked merges cost nothing and start nothing.

### Negative / Tradeoffs

- **Drift blocks, and drift is common.** On an active repository the default branch may move between preparation and approval, and then nothing can be merged until a new change is prepared against the current base. This is the intended behaviour and it will be the common outcome; whether it is *tolerable* is a product question the first dogfood answers rather than this ADR.
- **No compare-and-swap.** GitHub's update-ref endpoint has no "only if currently X" precondition, so a residual race exists between reading the head and writing. It is bounded by `force: false` — every lost race is a refusal, never an overwrite — but it is a real window and is stated rather than hidden.
- **Protected default branches cannot be merged at all.** For repositories that require pull requests, this capability does nothing. That is correct behaviour and a real functional gap.
- **The merge card costs GitHub calls on render.** Four read-only calls per *approved* prepared change, spent so the section can say whether the branch is where the approval expects it. Nothing billed, but it is latency and rate-limit budget that opening a page did not previously cost.
- **No rollback.** If a merge turns out to be wrong, the product offers nothing. Reverting is the user's job in their own repository. Building rollback would require a separate approval architecture and a design that does not exist.
- **Still no browser E2E.** The harness sprint (11A.1) was never implemented, so every claim about what a user *sees* rests on source assertions and the real dogfood. This is the fourth sprint carrying that gap.

## Related

- [0013](0013-durable-operation-execution.md) — why the write, the read-back and the convergence do not depend on an open request.
- [0014](0014-first-execution-safety.md) — model output is never authority; premises are revalidated against live state before a write.
- [0018](0018-human-approval-authority.md) — the approval this reads, and §6 there, which is why a moved `main` blocks a merge without unmaking a decision.

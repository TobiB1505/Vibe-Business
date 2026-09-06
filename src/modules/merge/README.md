# modules/merge

The only path from Vibe to a branch a customer ships from — see [ARCHITECTURE.md §3 "Layers with no section above"](../../../ARCHITECTURE.md#layers-with-no-section-above) and [ADR 0019](../../../docs/decisions/0019-safe-approved-change-merge.md).

Every other repository write in this product goes to an isolated `vibe/…` branch nobody is running. This one moves the branch a customer's deployments come from. That is a change of kind, not of degree, and the shape of this module is a reaction to it: a port that cannot express a dangerous write, a preflight that inherits nothing, and a result verified by an independent read rather than by the response to the write.

## What `merged` means, and what it does not

```
repository_write_verified   the bytes on the branch are the bytes we meant
sandbox_validation_passed   those bytes install, typecheck, test and build
preview_available           that exact artifact ran and was reachable
human_approved              a person looked at one commit and said yes
merged                      ← this module: the default branch moved
deployed                    does not exist
```

`merged` is one sentence: **the repository's default branch now points at the approved commit, and Vibe read it back to confirm.** It never means built, deployed, released or live. `schema.ts` carries `mergeIsNotDeployment()` so that anything tempted to render it as "live" walks past that comment first (rule 74).

The honest statement is not "no production effect" either. Vibe calls no deployment provider, but moving a default branch may well trigger the customer's own CI/CD — which is why the confirmation says so _before_ the click rather than the result page apologising after it.

## Two authorities, both required

A merge needs **immutable human intent** and **fresh external state**, and neither substitutes for the other (rule 70):

- The approval says a person approved commit X. It is history; it cannot change, and a later push to `main` does not unmake it.
- GitHub says where the default branch is _right now_. It is current, it can change between the click and the write, and it is never inferred from a stored snapshot.

An approval alone writes bytes onto a branch that has moved. Live state alone writes bytes nobody approved. So both are checked — and the live half is checked again inside the step that writes, never inherited from the check that rendered the button.

## The port cannot express the dangerous write

`git-port.ts` is deliberately not `GitWritePort`. The preparer's port has no `updateRef`, so "the change preparer cannot move the default branch" is a property of the type. Adding a default-branch mutation to it would spend that guarantee, so merging gets its own port and the two stay disjoint: the preparer creates refs and cannot move them; the merger moves exactly one ref and cannot create blobs, trees, commits or branches.

There is no `forceUpdateRef`, no `deleteRef`, no `createCommit`. Not unused — **absent**. That is what makes these claims checkable rather than aspirational (rule 71):

- Nothing here can force-update anything: `fastForwardDefaultBranch` has no force parameter to set.
- Nothing here can delete a branch, so the prepared `vibe/…` branch survives a merge.
- Nothing here can rewrite history, because no commit is created.
- Nothing here can touch a ref other than the default branch, whose name the _server_ resolved from GitHub.

No provider type appears in the port, so every merge path is testable with an in-memory double and no network.

## The preflight inherits nothing

`preflight.ts` is handed live facts and stored facts side by side, and its whole job is to refuse when they disagree. Repository Intelligence observed a tree, the preparation observed a head, the validation observed a build, the approval observed a human — every one of those is a historical observation, and not one is a statement about where the default branch is at the moment of the write.

It is pure and probe-injected, so every refusal is a unit test rather than an incident on someone's default branch.

## The ambiguous outcome

`merging` is set **before** the call, never after. A row that reaches that status and stops there is the ambiguous case: the only safe next move is to _read_ the branch, never to write again (rule 73). Success is never taken from the write's own response — the branch is read back independently and must equal the approved commit exactly.

A branch-protection rejection is the repository owner's authority working correctly. It is classified honestly and never framed as the user's error, and Vibe never asks for the Administration permission that would let it bypass one (rule 72).

## What lives here

| File                | Purpose                                                                                               |
| ------------------- | ----------------------------------------------------------------------------------------------------- |
| `schema.ts`         | The domain: statuses, failure codes, the versioned merge policy, and `mergeIsNotDeployment()`.        |
| `git-port.ts`       | The narrow capability. Five operations, and the absent ones are the design.                           |
| `github/adapter.ts` | The only file that speaks GitHub here, and where provider prose is classified into the failure union. |
| `preflight.ts`      | Stored intent against live state. Pure, probe-injected.                                               |
| `identity.ts`       | The immutable identity a merge is bound to, so an approval of one commit can never apply to another.  |
| `service.ts`        | Eligibility, starting a merge, and the card a screen reads.                                           |
| `store.ts`          | Persistence, including `markMergeWriteAttempted` — the mark that must precede the write.              |
| `view.ts`           | Deriving the merge card's state for the UI.                                                           |
| `messages.ts`       | The user-facing sentence per failure code.                                                            |
| `test-support.ts`   | Fixtures, a fake port, and `UnreachableMergePort` for paths that must never reach the network.        |

The durable step graph is not here: it lives in [`src/modules/operations/change-merge/`](../operations/change-merge/workflow.ts), because a default-branch write must not depend on the initiating request staying open.

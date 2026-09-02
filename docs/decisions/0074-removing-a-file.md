# 0074 - Removing a file: what the write path can express

Status: Accepted
Date: 2026-09-02

Amends [0070](0070-the-sandbox-is-the-boundary.md) in what a verified candidate may contain. Changes nothing about approval, validation or the merge.

## Context

The agent runs in an isolated VM with `Bash` among its tools
([protocol.ts](../../src/modules/coding-agent/sandbox-runtime/protocol.ts)), so
`rm` has always been available to it, and the compiled policy has granted
`workspace_delete_file` since CORE-4. What could not happen was the *last* step:
Vibe had no way to write a commit that removed a path.

`github-writer.ts` built its tree by adding blobs to the base tree, and
`git-port.ts` offered no entry shape that took one away. Faced with a candidate
containing a deletion, `candidate.ts` refused the whole change:

> A real, recorded limitation rather than an oversight. The git writer builds a
> tree additively and its port has no operation that removes an entry, so a
> candidate containing a deletion cannot be written faithfully — and writing a
> change that is missing part of what the agent did would break §59.

That refusal was correct while it stood. A commit missing part of what the agent
did is worse than no commit: it is a change a human would approve believing they
had seen all of it.

The cost of the refusal is not hypothetical. Deleting a page, removing a dead
component, dropping a stale route — ordinary product work — was unreachable, and
a run that attempted any of it was thrown away after it had been paid for.

## Decision

**A prepared change may remove a file, and removal is expressed as the shape the
Git data model already has for it.**

`createTree` takes `{ path, blobSha: string | null }`. A null blob removes the
path from the base tree. This is deliberately not an eighth port operation:
there is still nothing in `GitWritePort` that can amend a commit, move a ref, or
delete a branch — the properties Sprint 9B's write path is built on are
untouched.

**Which paths are removed is Vibe's own observation, never the agent's account
of it (rule 77).** `discoverWorkspaceChanges` compares the baseline listing
against the workspace after the last turn; a path in the first and not in the
second is deleted. There is no field in the runtime protocol for an agent to
report a deletion and no code that would read one. A deletion the observation
did not produce is inexpressible rather than refused.

**A deletion is checked exactly as a write is.** `isAgenticWritablePath` runs
over removals and writes together, and the rejection is `forbidden_path` rather
than a deletion-specific code — the finding is that the change touched a path
the policy protects, and whether it touched it by writing or by removing does
not change what a reader has to do about it. Removing
`.github/workflows/deploy.yml` is the same class of act as replacing it.

**A deletion counts as one changed file against the blast-radius ceilings.**
Removing forty files is not a smaller change than writing forty.

**The deletion set enters the candidate digest.** Without that, a rebuild whose
only difference was *which* files it removed would reproduce the digest the
first pass computed, and the write step would write a change nobody verified. A
change with no deletions digests exactly as it did before this decision, so
every already-stored `execution_identity` keeps meaning what it meant (rule 67).

**Absence is verified, not assumed.** The post-write read-back asserts that every
written path hashes to the bytes Vibe produced *and* that every removed path
reads back as nothing. The same claim is re-checked in the validation sandbox:
`preparedFiles` carries a null hash for a deletion, and a path still present
there is a source-integrity failure, exactly as a wrong hash is.

**A removed path is one of the entries in `prepared_changes.files`**, carrying
`status: "deleted"` and no hash and no byte count — there is nothing to measure,
and a hash of the empty string would make a removed file indistinguishable from
an emptied one. It is in the same list every reader already walks, so the diff,
the review classification and the depth policy see it without being told about
it separately. The one reader that holds deletions out is outcome verification:
a route the change deleted is supposed to be gone, and asking it for a 200 would
fail a correct change.

**The diff shows a removed file as its base version, in full, in red** — and the
status comes from the stored row, never from a head read that came back empty.
`getTextFile` returns null for an absent file, a binary one and an oversized one
alike, so inferring a deletion from it would report the wrong thing for two of
the three. That confusion is the mistake `candidate.ts` records making once: an
oversized build artifact read as the agent removing a repository file.

## `agentic_execution_v2`, and what did not bump

The capability names the producer, and its version exists so that a wider write
scope is a new value rather than a redefinition. A row stored as
`agentic_execution_v1` is a change nothing was removed by — because the writer
could not remove anything — and that stays readable off the row alone.

`EXECUTION_POLICY_VERSION` deliberately does **not** move. It versions the
grants an ExecutionSpec is compiled under, and deleting inside the workspace was
already one of them. What changed is what Vibe is willing to write to GitHub,
which is the question `execution_capability` answers.

The migration widens two constraints, and the second is the one worth naming:
`prepared_changes_opportunity_required_for_generators` exempted
`agentic_execution_v1` **by name**, so the capability bump alone would have made
every v2 change unstorable — a row that carries nulls in both opportunity
columns exactly as a v1 row does. Only PostgreSQL can answer that, which is why
it is asserted in `supabase/tests/agentic-execution-v2.migration.ts` rather than
in a migration-text search.

## Consequences

**Nothing about authority changes.** Validation is still a hard gate on
approval, an approval still binds to an immutable artifact identity, and
[ADR 0019](0019-safe-approved-change-merge.md)'s fast-forward-or-refuse is
untouched. A change that removes a file is reviewed and approved by exactly the
same path as one that does not.

**A removed page is a visual change**, and reaches the classifier by the route
every changed path already takes. The render-impact probe cannot clear it: there
is no head version to prove anything about, so the path answer stands.

**What is deliberately still absent.** No rename detection — a rename is a write
plus a deletion, and calling it a rename would be an inference about intent that
Vibe's observation cannot support. No directory removal as an operation; a
directory disappears because every path under it did. And no relaxation of the
write policy: the set of paths the agent may touch is exactly what it was.

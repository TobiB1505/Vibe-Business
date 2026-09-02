# The commit that could only ever add

**Recorded 2026-09-02, after the work.** One slice, one migration, one ADR ([0073](../decisions/0073-removing-a-file.md)). Stage 1 of the architecture audit walked through on this branch; Stage 0 shipped as [Sprint 0125](0125-the-evidence-behind-the-ceiling.md)'s neighbour and the build-artifact repair before it.

No new dependency, no new grant, no change to how a merge is authorized.

## The shape of the gap

The coding agent has `Bash` inside its VM and `workspace_delete_file` in its compiled policy, and has had both since CORE-4. It could always remove a file. What it could not do was get one *out*: `github-writer.ts` built its tree by adding blobs to the base tree, and `git-port.ts` had no entry shape that took one away.

So `candidate.ts` refused the whole change, and the refusal was honest — a commit missing part of what the agent did is worse than no commit, because a human approves it believing they have seen all of it.

The price of that honesty was that deleting a page, removing a dead component or dropping a stale route was unreachable, and a run that attempted any of it was discarded **after it had been paid for**.

## What was built

| | |
|---|---|
| `execution/git-port.ts` | `createTree` takes `{ path, blobSha: string \| null }` — deletion as a *shape*, not an eighth operation |
| `execution/github-writer.ts` | writes and removals in one tree; `branchMatches` additionally asserts every removed path reads back as **nothing** |
| `coding-agent/candidate.ts` | the blanket `deletion_not_permitted` replaced by the same path check a write gets |
| `coding-agent/identity.ts` | the deletion set enters the candidate digest — and only when there is one |
| `execution/schema.ts` | `agentic_execution_v2`, `isAgenticCapability`, and a `PreparedFile` that can carry `status: "deleted"` |
| `execution/diff.ts` + `components/change/diff-view.tsx` | a removed file as its base version, in full, in red |
| `validation/orchestrator.ts` | a null hash in `preparedFiles` means "this path must be absent", checked in the sandbox |
| `outcome-verification/eligibility.ts` | deletions held out of the route contract |
| migration `20260902160000` | two constraints widened, and the second one is the interesting one |

## The four decisions worth reading

**Deletion is a shape the port accepts, not an operation it gained.** `{ blobSha: null }` is the Git data model's own way of saying a path is not in the new tree. Nothing in `GitWritePort` can still amend a commit, move a ref or delete a branch, so every property Sprint 9B's write path rests on is exactly as it was. The one new capability is expressed in a field that already existed.

**The deletion set has to be in the digest.** Without it, a rebuild whose only difference was *which* files it removed would reproduce the digest the first pass computed, and the write step would write a change nobody verified — the same hole VB-017 closed for bytes, reopened for absences. It is appended to the canonical form **only when there is one**, so a change with no deletions digests exactly as it did yesterday and every stored `execution_identity` keeps meaning what it meant (rule 67).

**A deletion is refused as `forbidden_path`, not as its own rejection code.** The finding is that the change touched a path the policy protects. Whether it touched it by writing or by removing does not change what a reader has to do about it, and a second code would have split one finding into two lists.

**The diff's "deleted" comes from the row, never from an empty read.** `getTextFile` returns `null` for an absent file, a binary one and an oversized one alike. The comment `diff.ts` carried before this sprint spelled out exactly why inferring a deletion from that is wrong, and cited the time it happened: an oversized build artifact read as the agent removing a repository file. The status now comes from `prepared_changes.files` — Vibe's own record of what it wrote — and `null` still means `unreadable`.

## The constraint that would have refused every new change

The capability bump is the obvious half of the migration. The half that would have broken production is `prepared_changes_opportunity_required_for_generators`, which exempted `agentic_execution_v1` **by name**:

```sql
check (execution_capability = 'agentic_execution_v1'
       or (opportunity_set_id is not null and opportunity_id is not null))
```

An agentic change traces to a plan step rather than an opportunity set, so a v2 row carries nulls in both columns exactly as a v1 row does. Widening only the capability list would have produced a capability the database permits and a row it refuses — green everywhere, failing on the first real run.

Nothing in TypeScript can see that: the in-memory database models this one constraint but not by reading the SQL, and a migration-text search finds both constraint names and cannot tell you whether the second admits what the first now permits. It is asserted against a real cluster, in `supabase/tests/agentic-execution-v2.migration.ts`, and the assertion failed before the restatement was written.

**One more trap, found by a test rather than by reading.** The restatement was first written as `execution_capability in ('agentic_execution_v1', 'agentic_execution_v2')`, which made `checkedValues()` — which takes the newest `check (<column> in (…))` for a table — read the *opportunity* constraint as the capability enumeration and report exactly two permitted capabilities. Written as two equality tests instead, with the reason in the migration.

## What the tests caught

**Two `files.length === 0` guards that called a deletion nothing.** A run whose whole change was removing a page reached `agent_produced_no_change` — the failure code that means the agent did not do anything. Both now count removals, and so does the "N files changed" line the customer reads.

**`DETERMINISTIC_EXECUTION_CAPABILITIES` was about to include `agentic_execution_v1`.** It excluded `typeof AGENTIC_EXECUTION_CAPABILITY`, which is a constant that had just moved to v2. A plan step could then have claimed a generator that has never existed. It excludes every agentic value now, through a type guard rather than a comparison.

**The fake sandbox had `writeFile` and no `deleteFile`.** A test that stubbed the deletion anywhere else would have been asserting about its own stub — so the deletion is made the way production makes one: the file disappears from the workspace, and Vibe finds out by walking it. Nothing in that test tells the pipeline a deletion happened.

## Verification

| Layer | Result |
|---|---|
| Domain (`pnpm test`) | 427 files, 7,393 tests |
| SQL/RLS (`pnpm db:test`, real PostgreSQL) | 18 files, 233 tests — 6 new, against a cluster the harness creates itself |
| `pnpm lint`, `pnpm build` | clean |

**Not covered by a browser test, and the reason is structural.** The diff section loads through a server action that reads GitHub at two commits, so the e2e fixtures — which fake the page's data, not its repository — can show that the section exists and never what is in it. No file row of any status is asserted in a browser today, deleted or otherwise. Adding that means fixture plumbing for a content reader, which is its own slice.

**Not dogfooded.** Rule 69's fourth question is open. Everything above is reasoned and unit-proven; what no test here can answer is whether an agent, given an ordinary "remove this page" step, produces a deletion the observation actually sees. One real run answers it.

## What this deliberately did not do

- **No rename detection.** A rename is a write plus a deletion, and calling it a rename would be an inference about intent that Vibe's observation cannot support.
- **No directory operation.** A directory disappears because every path under it did.
- **No widening of the write policy.** The set of paths the agent may touch is exactly what it was; deletions were added to the check, not exempted from it.
- **`EXECUTION_POLICY_VERSION` unchanged.** It versions what the workspace may do, and that grant is older than this sprint.

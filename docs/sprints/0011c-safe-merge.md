# Sprint 11C — Safe Merge

**Status**

| Slice | State |
| --- | --- |
| ChangeMerge domain, RLS, service, durable workflow, UI | ✅ Complete |
| Fresh GitHub preflight + fast-forward-only rule | ✅ Complete |
| No-force / no-delete structural guarantee | ✅ Complete |
| Ambiguous-write recovery + read-back verification | ✅ Complete |
| Tests + 19 deliberate regressions | ✅ Complete (18 killed, 1 equivalent — see below) |
| Migration deployed and verified | ✅ Deployed 14.08.2026 via the Supabase CLI |
| Browser E2E of the merge UI | ✅ [Sprint 11C.1](0011c1-merge-ui-e2e.md) — 9 chromium tests |
| Real dogfood — blocked case | ✅ Done 14.08.2026 — refused on drift, nothing written |
| Real dogfood — successful merge | ⏳ Pending — needs a change prepared on the current head |

## Goal

Let an authenticated project owner merge **one exact approved PreparedChange** into their repository's default branch, by fast-forward only, after a fresh preflight against GitHub, and verified by an independent read-back.

Nothing more. No deployment, no rollback, no auto-merge, no conflict resolution.

## Why approval is not merge authority

Every gate before this one is either a machine reporting on itself or a person recording an intention. This is the first one that changes somebody else's repository in a place their product runs from.

```
review_artifact_available   a controlled before/after comparison exists
human_approved              a person looked at one commit and said yes
merged                      ← this sprint: the default branch moved
deployed                    still does not exist
```

[ADR 0018](../decisions/0018-human-approval-authority.md) deliberately left half the question open: an approval binds to one exact artifact, and a moving default branch does *not* unmake a human's decision. Whether a merge is **currently safe** is a different sentence, asked at a different time, against live state.

So a merge needs two authorities and neither substitutes for the other:

| Authority | What it is | What it cannot say |
| --- | --- | --- |
| The approval | immutable human intent about commit X | where `main` is now |
| GitHub, read now | current external truth | what anybody agreed to |

The durable learning, which generalizes past merging:

> **Consequential writes must be authorized by both immutable human intent and fresh external state.**

## What was built

### The object

`change_merges` — one row per *attempt*, not a flag on something else. `prepared_changes.status = 'merged'` alone cannot say which commit moved which branch from where to where, under which policy, authorized by which approval. That is precisely what an audit of a default-branch write must be able to answer.

Five statuses, and the boundary between the first two is the one that carries weight:

```
preflight   requested and authorized; NO write attempted
merging     a write has been attempted; one may already have taken effect
merged      the branch was read back independently and equals the approved commit
blocked     refused before any write — the repository was not touched
failed      a write was attempted and did not end verified
```

### Fast-forward only

```
prepared commit's parent == recorded base
current default HEAD     == recorded base
    ⇓
default ref moves BASE → APPROVED COMMIT
```

No merge commit, no generated content, no history rewrite, nothing to resolve. This is not a merge engine; it closes exactly the loop Vibe's own execution capability produces and refuses everything else.

### Fresh preflight, run twice

Once to render the section, and again **inside the step that writes**. The first authorizes nothing — between a page render, a click, a dialog and a queue there is easily a minute, which is plenty of time for `main` to move.

Eight checks, in the order the message should name the first thing wrong:

1. an approval exists and stands
2. it names *this* prepared change, commit and base
3. GitHub is reachable
4. is the outcome already true? (→ `already_applied`)
5. the approved commit still exists
6. it is still a direct child of the base
7. the Vibe branch still points at it
8. the default branch is still at the base
9. the installation may still write

### No force, structurally

The merge capability has its own port with five operations. There is no `force` parameter to set, no `deleteRef`, no general `updateRef`, and nothing that creates content — so "we never force" is a property of the *type*.

Sprint 9's `GitWritePort` is left untouched. It has no `updateRef` and no `deleteRef`, which is what makes "the change preparer cannot move the default branch" structural. Adding default-branch mutation there would have spent that guarantee to save a file.

The adapter also passes `force: false` explicitly rather than relying on the endpoint's documented default, so the guarantee is visible at the call site.

### Ambiguous-write recovery

`writeDefaultRef` is `maxRetries = 0`. On an ambiguous outcome the step **reads the branch** and lets the observation decide:

| Observed head | Conclusion |
| --- | --- |
| the approved commit | the write landed → verify |
| the recorded base | it did not land → **fail, no retry** |
| anything else | stop — `merge_ambiguous_write` |

Recovery from the middle case is a fresh human action that re-runs the whole preflight. That is the explicit safe retry policy, and it is safe because it is not automatic.

The row records the attempt **before** the call, never after, so an interrupted merge is legible after a crash.

### Read-back verification

`merged` requires an independent read afterwards and **exact equality** with the approved commit. "The branch changed", "it moved forward" and "it contains our commit" each have a reading under which somebody else's merge reports as ours.

The database enforces the same rule from below: `change_merges_merged_matches_approved_commit` refuses a `merged` row whose observed result is not the approved commit, including null. Application code checks it; the constraint means a bug in that check cannot store a success that did not happen.

### Repository drift

Blocked, with no GitHub write and no remediation started. Vibe does not merge `main` into the branch, rebase, cherry-pick, regenerate, resolve conflicts with a model, or create a new approval target — and it does not start a repository scan, audit, opportunity generation, preparation, validation, preview or review. Blocked work explains what changed; the user decides (CLAUDE.md rule 60).

### Branch protection

Classified as its own outcome: *this repository requires a different merge process for the default branch; Vibe did not bypass the repository's protection rules.* No Administration permission is requested, no rule is weakened, and the refusal is not framed as the user's error.

One classification detail worth recording: GitHub rulesets phrase this as **"Changes must be made through a pull request"** — no occurrence of the word "protected". Read as a permission failure it would send a user to reconnect their installation when their own rule had simply worked. A test caught this during implementation.

### Privileged writes

The split is the strongest form available:

| Statement | Who may |
| --- | --- |
| INSERT | the project owner, through their own session — the policy independently verifies the prepared change, commit, base, an **active approval by that user**, the connection and the operation |
| UPDATE | **nobody**. There is no update policy, so every authoritative transition is reachable only by the service-role client durable execution holds |
| DELETE | nobody, ever |

### Deployment claims

`merged` renders as *Merged · Repository default branch updated successfully · Not deployed by Vibe*. `deploymentVerified: false` is a field on the server's card rather than a string in a component, so the disclaimer survives a redesign.

The confirmation says both halves before the click, because only one of them is reassuring:

> This does not deploy your application. Vibe will not call a deployment provider.
>
> Updating the default branch may trigger your repository's existing CI/CD or hosting automation.

## Validation

`pnpm lint` · `pnpm typecheck` · `pnpm test` (2135 tests, 112 files) · `pnpm build` — all green.

### The migration is written but deliberately not deployed from here

`pnpm db:status` / `pnpm db:push` / `pnpm db:lint` need a linked Supabase CLI, and the implementation environment has no CLI credentials and no `.env`. The migration must be deployed with the sanctioned workflow, from the machine where the project is linked:

```
pnpm db:status     # inspect history first (CLAUDE.md rule 30)
pnpm db:push
pnpm db:lint
```

The obvious shortcut — applying the SQL through the Supabase management connection that *is* reachable from here — was rejected on purpose. That path cannot set the migration **version**; it stamps its own timestamp, so the remote history would record a version the local file does not have, and the next `pnpm db:push` would try to create a table that already exists. That is exactly the divergence rules 29, 30 and 34 exist to prevent, and it is not worth trading for one skipped step.

What *was* done from here is the read half, which is safe and was required before writing the migration at all: the live constraints were inspected directly through the Supabase connection to the `Vibe-Business` project. `operation_runs_operation_type_check` listed seven values and did not include `change_merge`; `operation_runs_stage_check` listed twenty-eight and included none of the merge stages. Local migration history and the remote database agreed exactly (20/20, ending at `change_approvals`). `schema.test.ts` now pins both representations together.

**Nothing can be merged until this migration is deployed.** Every insert would fail on `operation_runs_operation_type_check`.

### Deliberate regressions — 19 applied and reverted, 18 killed

| # | Mutation | Result |
| --- | --- | --- |
| 1 | active approval requirement removed | killed |
| 2 | approval's exact commit/base binding removed | killed |
| 3 | current default-head check removed | killed |
| 4 | prepared-commit parent/base check removed | killed |
| 5 | explicit merge confirmation removed | killed |
| 6 | `force: false` → `force: true` | killed |
| 7 | repository drift no longer blocks | killed |
| 8 | protected-branch rejection bypassed | killed |
| 9 | read-back verification removed | killed |
| 10 | read-back stores the approved commit instead of the observed one | **equivalent** |
| 11 | ambiguous write retried blindly | killed |
| 12 | client can choose the target SHA | killed |
| 13 | client can choose the default branch | killed |
| 14 | duplicate writes become possible | killed |
| 15 | SQL CHECK diverges from the TS union | killed |
| 16 | a normal user can forge a merged result (update policy added) | killed |
| 17 | a blocked merge triggers a hidden re-analysis | killed |
| 18 | the port gains `deleteRef` | killed |
| 19 | read-back removed **and** the result faked | killed |

**#10 is an honest no-op and is reported as one.** With the equality guard above it intact, `after.commitSha` and `merge.preparedCommitSha` are the same value, so substituting one for the other changes nothing. The dangerous version is the *combination* — remove the guard and fake the result — which is #19, and that is killed by the database constraint rather than by application logic.

Three of these (#15, #16, and the migration half of #6) are migration-**text** assertions. They catch drift in the file, not in a deployed database. That distinction cost this project real production time in Sprints 9 and 10B and is stated rather than glossed.

## Browser E2E — done, in [Sprint 11C.1](0011c1-merge-ui-e2e.md)

**Superseded.** A Playwright layer now exists: 9 chromium tests covering the
confirmation dialog, both repository-changed refusals, merged rendering and
reload recovery, with zero external requests. Three deliberate regressions to
the merge panel each break it.

What it still does not cover is the wiring in `page.tsx` and RLS, because there
is no isolated database on this machine — see that sprint's *What this layer
does NOT prove*.

The original finding, kept for the record:

**There was no Playwright suite in this repository.** `playwright-core` is a product dependency used for the customer-facing browser analysis; there is no `test:e2e` script, no `playwright.config`, no `e2e/` directory, and no Sprint 11A.1 document. The sprint brief's pipeline lists *Critical Browser E2E ✅*; that is not the state of the repository, and the five E2E scenarios in §44 could not be written against a harness that does not exist.

Sprint 11A.1 — the harness sprint — was never implemented; it stopped at a blocking question about the test environment. This machine has no container runtime, so `supabase start` cannot run and there is no isolated database to seed fixtures into. Pointing Playwright at production was ruled out and stays ruled out.

So every claim about what a user *sees* rests on source assertions (`merge-ui.test.ts`, `approval-ui.test.ts`) and on the real dogfood. This is the fourth sprint carrying this gap, and it is the same gap CLAUDE.md rule 69 names: *three greens and an untested screen is the failure mode this project keeps paying for.*

One consequence worth recording: `approval-ui.test.ts` previously forbade the word **merge** in every action label on the project page. That assertion was deliberately narrowed — merging is now real, exactly one panel may offer it, and every other panel is still held to the original list, including the word merge.

## Real dogfood — the blocked case, 14.08.2026

Authorized explicitly, performed once, against the historical approved change.
**The refusal is the result, and it is the right one.**

| Criterion | Outcome |
| --- | --- |
| Fresh GitHub preflight observed the drift | ✅ four live read-only calls at render |
| Merge blocked | ✅ the action was never offered |
| Zero GitHub writes attempted | ✅ |
| `main` ref-identical to its pre-attempt SHA | ✅ `b8638ae…` before and after |
| Prepared branch unchanged | ✅ `2f05958…` |
| Historical approval still `approved` | ✅ |
| ChangeMerge / OperationRun terminal blocked state | ❌ **no rows** — see below |

### The seventh criterion, and why it was not met

There is no `change_merges` row and no `change_merge` operation, because
**nothing was ever attempted**. The render-time preflight found the drift and
the panel rendered `not_eligible` — "Not available", with the reason — so the
**Merge approved change** button was never drawn. There was nothing to click.

That is the implementation behaving as designed, and the design is deliberate:
`startMerge` records a refusal as an audit event rather than a row, on the
reasoning that *a request refused at the door never touched GitHub and never
became an attempt, so inventing a ChangeMerge for it would put junk in the table
that documents writes.*

The consequence is worth stating plainly rather than filing as a win: **a
drift-refused merge currently leaves no durable trace at all.** Not a row,
and — because the button is withheld before `startMerge` is reached — not even
the `change_merge.blocked` audit event that path would write. A `blocked` row is
reachable only when drift appears *between* the request and the durable write,
which the workflow's own revalidation catches.

Whether "refused before it was offered" deserves a record is a product decision,
not a bug fix. It is not resolved here, and nothing was weakened to manufacture
a row.

### The state that produced it



- the historical approved change is commit `2f05958`, prepared against base `528d372`;
- `main` is now at `b8638ae`, **five commits** past that base, and `main` is not an ancestor of the approved commit — so a fast-forward is genuinely impossible, not merely refused by policy.

So the safe case did **not** hold, and the outcome was `merge_repository_changed` — a successful safety result, not a successful first merge. §57 is explicit that the policy must not be loosened to finish the sprint, and it was not: no rebase, no refresh, no weakening of the fast-forward invariant.

The successful merge dogfood therefore needs a change prepared against the *current* head, which is deliberately left until after this PR merges.

## Known limitations

- **Drift blocks, and on an active repository drift is the common case.** Whether that is tolerable in practice is a product question the first dogfood answers, not this sprint.
- **No compare-and-swap.** GitHub's update-ref endpoint has no "only if currently X" precondition, so a residual race exists between reading the head and writing. It is bounded by `force: false`: every lost race is a refusal, never an overwrite.
- **Protected default branches cannot be merged at all.** Correct behaviour, and a real functional gap. PR-based flows are a plausible later sprint.
- **No rollback.** If a merge turns out to be wrong the product offers nothing; reverting is the user's job in their own repository.
- **The merge card costs four read-only GitHub calls per approved prepared change on render.** Nothing billed, but opening a project page did not previously cost rate-limit budget.
- **`pnpm db:status` / `db:lint` were not run**, because the implementation environment has no Supabase CLI credentials. The live constraints were read directly instead.

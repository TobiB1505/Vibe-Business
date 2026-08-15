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
| Real dogfood — successful merge | ✅ **Done 14.08.2026 — `main` moved by fast-forward and read back** |

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

### The migration was deployed through the CLI workflow, 14.08.2026

`pnpm db:status` → `pnpm db:push`, from the machine where the project is linked.
One pending migration, no remote-only drift, version preserved. Verified live
afterwards: the table exists, **INSERT and SELECT policies only** — no UPDATE,
no DELETE — the `change_merges_written_identity_idx` write lock is present, and
`operation_runs` now accepts `change_merge`.

The section below is the original note, kept because its reasoning is what made
the deployment correct rather than convenient.

#### Why it was not applied from the implementation environment

`pnpm db:status` / `pnpm db:push` / `pnpm db:lint` need a linked Supabase CLI, and the implementation environment has no CLI credentials and no `.env`. The migration must be deployed with the sanctioned workflow, from the machine where the project is linked:

```
pnpm db:status     # inspect history first (CLAUDE.md rule 30)
pnpm db:push
pnpm db:lint
```

The obvious shortcut — applying the SQL through the Supabase management connection that *is* reachable from here — was rejected on purpose. That path cannot set the migration **version**; it stamps its own timestamp, so the remote history would record a version the local file does not have, and the next `pnpm db:push` would try to create a table that already exists. That is exactly the divergence rules 29, 30 and 34 exist to prevent, and it is not worth trading for one skipped step.

What *was* done from here is the read half, which is safe and was required before writing the migration at all: the live constraints were inspected directly through the Supabase connection to the `Vibe-Business` project. `operation_runs_operation_type_check` listed seven values and did not include `change_merge`; `operation_runs_stage_check` listed twenty-eight and included none of the merge stages. Local migration history and the remote database agreed exactly (20/20, ending at `change_approvals`). `schema.test.ts` now pins both representations together.

**Nothing could be merged until this migration was deployed.** Every insert would have failed on `operation_runs_operation_type_check`. It has since been deployed, as recorded above.

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

There was no `change_merges` row and no `change_merge` operation, because
**nothing was ever attempted**. The render-time preflight found the drift and
the panel rendered `not_eligible` — "Not available", with the reason — so the
**Merge approved change** button was never drawn. There was nothing to click.

That is the implementation behaving as designed: `startMerge` records a refusal
as an audit event rather than a row, on the reasoning that *a request refused at
the door never touched GitHub and never became an attempt, so inventing a
ChangeMerge for it would put junk in the table that documents writes.*

But the consequence was worse than the design intended, and it is now fixed.
Because the button is withheld *before* `startMerge` is reached, that audit
event was never written either — so a drift-refused merge left **no durable
trace at all**.

### The fix: `change_merge.not_eligible`

Recorded from the read path, under a deliberately narrow condition:

> a human approved these exact bytes, **and** Vibe currently cannot merge them.

`not_eligible` is the resting state of every change nobody has approved, so
recording it unconditionally would mostly log the absence of a decision. The
state worth remembering is a fact about a commitment already made.

It is **deduplicated against the last recorded reason**, because it runs on a
render. One event per *transition*: the first time a change becomes unmergeable,
and again only if the reason changes — `merge_repository_changed` becoming
`merge_permission_missing` is a different fact and gets its own entry. An event
per render would turn the audit log into a page-view log.

Deliberately distinct from `change_merge.blocked`, which means *a human asked
and was refused*. Conflating them would make the log unable to answer the only
question it is really asked here: whether anyone tried.

Two properties the tests pin, both of which survived a first round of mutation
testing and needed extra coverage:

- a card showing an **earlier failed attempt** records nothing, so an old
  attempt's failure code is never re-logged as a fresh refusal;
- a **failed dedup read** stays silent rather than writing, so a transient
  error cannot produce the per-render flood through the error path.

Six deliberate regressions, all killed.

### The state that produced it

Resolved from production data rather than assumed:

- the historical approved change is commit `2f05958`, prepared against base `528d372`;
- `main` is now at `b8638ae`, **five commits** past that base, and `main` is not an ancestor of the approved commit — so a fast-forward is genuinely impossible, not merely refused by policy.

So the safe case did **not** hold, and the outcome was `merge_repository_changed` — a successful safety result, not a successful first merge. §57 is explicit that the policy must not be loosened to finish the sprint, and it was not: no rebase, no refresh, no weakening of the fast-forward invariant.

The successful merge dogfood therefore needed a change prepared against the
*current* head. That is what follows.

## Real dogfood — the successful merge, 14.08.2026

**Vibe moved a customer's default branch for the first time.** The customer was
Vibe Business.

### What was merged

A fresh preparation against the head that existed after PR #29 merged:

| | |
| --- | --- |
| PreparedChange | `1232a8f9` · branch `vibe/seo-foundations-ab0d865476a6` |
| Commit | `78cbdac32ea660edd20af4a9dfcc74be6c388700` |
| Base | `246ac362610aac828f35fc5dbfa8f67dde5ebbdd` — `main` at preparation time |
| Capability | `nextjs_seo_foundations_v2` |
| Files | `src/app/robots.ts`, `src/app/sitemap.ts` · 2 changed, +44, −0 |

The commit had **exactly one parent, and it was the base** — so the
fast-forward invariant held by construction rather than by policy, checked
against the commit object itself.

### The write, in ten seconds

```
14:40:46  change_merge.requested
14:40:50  change_merge.preflight_passed        fresh GitHub read: main still at 246ac36
14:40:53  started_at set                       marked BEFORE the write
14:40:54  change_merge.default_branch_updated
14:40:56  change_merge.verified                independent read-back, then merged_at
```

`started_at` preceding the write is what makes an interrupted merge legible;
`merged_at` exists only because the read-back came back equal. The
`change_merges_merged_matches_approved_commit` CHECK is now load-bearing in
production rather than only in tests.

### The record

| Field | Value |
| --- | --- |
| ChangeMerge | `82e4980e` · `merged` · **one row, total** |
| Strategy · policy | `fast_forward_exact_commit` · `merge-policy-v1` |
| Observed head before | `246ac36…` |
| Resulting head, read back | `78cbdac…` — **equals the approved commit** |
| Authorized by | approval `968f8955`, still `approved`, bound to `78cbdac` |
| OperationRun | `completed` |
| AI calls in the merge path | **0** |

### GitHub, verified independently

```
refs/heads/main                          246ac36…  →  78cbdac…
new head's parent                        246ac36…              ← a true fast-forward
refs/heads/vibe/seo-foundations-ab0d…    unchanged             ← no delete, no rewrite
```

### What the whole chain cost

| Step | Cost |
| --- | --- |
| Audit + opportunities (twice) | **$0.228**, 4 AI calls |
| Preparation | $0 · **0 AI calls** — deterministic |
| Validation × 2 | 598 s of sandbox |
| Preview × 2 | two sandboxes, both torn down |
| Comparison | 1 browser session, 10.8 s, 2 captures |
| Approval | $0 |
| **Merge** | **$0 · 0 AI calls · ~10 s** |

The second validation was avoidable and is the honest lesson of the run: the
preview was stopped **before** the comparison was generated, teardown deleted
the 1.16 GB ValidatedArtifact as designed, and the artifact had to be rebuilt.
The sequencing trap — preview → *comparison* → stop, never preview → stop →
comparison — has now cost a validation twice.

### What it proved, and what it did not

It proved that a human's approval of one exact commit can move a real default
branch by fast-forward, and that the product can say afterwards *which* commit
moved *which* branch *from* where, authorized by *which* decision, verified by
an independent read.

It did not prove anything about deployment. Vibe called no deployment provider.
Moving `main` did trigger this repository's own Vercel production build — which
is precisely why the confirmation says so before the click, and why `merged`
never renders as "live".

### The part worth remembering

The first Vibe-authored commit, on 12.08., listed `/login` and `/signup` in a
sitemap: correct at every safety layer and wrong in intent. It is the standing
example in this project's history of why `repository_write_verified` is not
`good`.

The commit that just became `main` is the same capability one version later,
with that defect designed out — the v2 sitemap lists only the homepage and
documents omission as the intended default. The pipeline did not merely carry a
change to production; the gap it was built around is the gap that got closed,
and a human still approved the specific commit that closed it.

## Known limitations

- **Drift blocks, and on an active repository drift is the common case.** Whether that is tolerable in practice is a product question the first dogfood answers, not this sprint.
- **No compare-and-swap.** GitHub's update-ref endpoint has no "only if currently X" precondition, so a residual race exists between reading the head and writing. It is bounded by `force: false`: every lost race is a refusal, never an overwrite.
- **Protected default branches cannot be merged at all.** Correct behaviour, and a real functional gap. PR-based flows are a plausible later sprint.
- **No rollback.** If a merge turns out to be wrong the product offers nothing; reverting is the user's job in their own repository.
- **The merge card costs four read-only GitHub calls per approved prepared change on render.** Nothing billed, but opening a project page did not previously cost rate-limit budget.
- **`pnpm db:status` / `db:lint` were not run**, because the implementation environment has no Supabase CLI credentials. The live constraints were read directly instead.

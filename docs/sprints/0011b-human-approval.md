# Sprint 11B — Human Approval

**Status**

| Slice | State |
| --- | --- |
| ChangeApproval domain, RLS, service, UI | ✅ Complete |
| Migration deployed and verified | ✅ Complete |
| Tests + 12 deliberate regressions | ✅ Complete |
| Browser E2E of the approval UI | ⛔ **Not done** — no harness exists (see below) |
| Real dogfood | ⏳ Pending — needs the deployed branch |

## Goal

Let an authenticated project owner explicitly approve **one exact reviewed
PreparedChange**. Nothing more.

## Why approval is separate from merge

Every gate before this one is a machine reporting on itself:

```
repository_write_verified   the bytes on the branch are the bytes we meant
sandbox_validation_passed   those bytes install, typecheck, test and build
preview_available           that exact artifact ran and was reachable
review_artifact_available   a controlled before/after comparison exists
human_approved              ← this sprint: a person decided
merged / deployed           neither exists
```

`human_approved` means exactly: *a person with authority over this project
looked at one specific reviewed commit and said yes to it.*

It does **not** mean the change is correct, that it can be merged now, or that
anything happened in the repository. Approval records intent; it grants no
capability. Full rationale:
[ADR 0018](../decisions/0018-human-approval-authority.md).

## What was built

### The object

`change_approvals` — a row naming what was approved, not a boolean on something
else. A boolean cannot answer *approved what, exactly?*: it survives a
regenerated commit, a second validation and a fresh comparison, and quietly
comes to mean "approved whatever is on the branch now".

### Exact artifact binding

Identity is `sha256(project, prepared change, **commit**, **base**, validation
run, review artifact, policy version)`. Change any part and it is a different
thing to approve — the new artifact has a new identity, the partial unique index
does not cover it, and re-approval is the only path.

The commit and base are **copied onto the row** rather than joined at merge
time. If a preparation is re-run and rewrites its commit, the approval must
still say which commit the human saw; a join would answer with the new one.

### What ends an approval, and what does not

| Event | Effect |
| --- | --- |
| Commit or base changed | `invalidated · prepared_change_modified` |
| Newer passing validation | `invalidated · validation_superseded` |
| Newer ready comparison | `invalidated · review_superseded` |
| Approver revokes | `revoked`, record preserved |
| **`main` moved** | **nothing** — see below |
| Review images aged out | nothing; the decision stands |

The `main` row is the important one. External repository movement makes a
*merge* unsafe; it does not unmake a human's decision. Folding the default
branch's head into the identity would mean every unrelated push silently revoked
a decision nobody revisited. Merge eligibility is Sprint 11C's question, asked
against live state immediately before it writes.

### Review required, preview not required

Approval needs a `ready` comparison bound to this exact change and validation.
It never reads a preview session — the whole point of separating the review
artifact from the preview was that a decision must not require a paid sandbox to
still be running:

```
preview → comparison captured → preview stopped → human reviews later → approval
```

### Confirmation, enforced on the server

The confirmation travels as an argument, and an unconfirmed call is refused
**before any state is read** — no row, no audit event, no trace that anything
was attempted. The dialog is a fact about a browser; it authorizes nothing.

### Authorization

The project model has exactly one owner, so **approval authority is the project
owner**. Multi-approver, separation of duties, and "someone other than the
preparer must approve" are real requirements that do not exist yet; inventing a
role system here would have been speculative.

### RLS verifies the linkage, not just the ownership

Approval is a human action, so it is not service-role-only — which means the
database is a real second gate, and this time it does more than check ownership.
The insert policy independently verifies that:

- the prepared change is at that commit **and** that base, and is `prepared`;
- the validation run belongs to it and **passed**;
- the review artifact belongs to both and is **ready**;
- the approver is the caller, who owns the project;
- the new row's status is `approved`.

A caller holding nothing but an authenticated token cannot record an approval
for bytes that were never prepared, validated or reviewed. Not because a code
path declined — because the row cannot exist.

There is **no delete policy**. Approval history cannot be destroyed through the
product.

### No hidden spend

Approval and revocation each perform zero sandbox calls, zero browser calls,
zero AI calls and zero GitHub calls. So does rendering the panel. Approval is a
database action; there is no provider client in the module's import graph at
all.

## Acceptance Criteria

- [x] ChangeApproval domain exists with exact artifact binding
- [x] A ready ReviewArtifact is required; the preview need not be alive
- [x] Explicit confirmation enforced server-side
- [x] Owner-only authority, approver resolved from the session
- [x] Revocation preserves history; re-approval creates a new row
- [x] A changed artifact invalidates rather than retargets
- [x] Idempotent under double click, enforced by a partial unique index
- [x] Zero provider, AI and GitHub calls
- [x] DB contract tests pin the TS unions to the SQL CHECKs
- [x] Migration deployed; policies verified against the live database
- [ ] **Browser E2E of the approval UI** — no harness exists
- [ ] Real dogfood — needs the deployed branch

## Validation

```
pnpm lint         ✅
pnpm typecheck    ✅
pnpm test         ✅  1979 tests, 105 files
pnpm build        ✅
pnpm db:status    ✅  no pending migrations
pnpm db:lint      ✅  no schema errors
```

Verified against the live database after deploy:

- three policies on `change_approvals` — SELECT, INSERT, UPDATE — and **no
  DELETE policy**;
- Postgres's own normalized `with_check` expression confirms every reference to
  the new row is qualified `change_approvals.*` and every inner reference is
  aliased (`pc.`, `vr.`, `ra.`).

That last check is deliberate. `prepared_change_id` exists on `validation_runs`
and `review_artifacts` as well, so an unqualified reference inside those
subqueries would bind to the inner table and the policy would pass for the wrong
row — silently, with no error. That is precisely the bug that made the Sprint
11A storage policy match nothing, so this time the *parsed* expression was
inspected rather than the source text.

### Deliberate regressions

Twelve, each applied and reverted. **All twelve break tests.** No survivors, and
no equivalent mutations to report.

| # | Regression | Result |
| --- | --- | --- |
| 1 | ReviewArtifact `ready` requirement removed | ✅ fails |
| 2 | Commit + base dropped from the approval identity | ✅ fails |
| 3 | Confirmation requirement removed | ✅ fails |
| 4 | Cross-user authorization removed | ✅ fails |
| 5 | Approval auto-carries to a changed artifact | ✅ fails |
| 6 | Unique active-approval index dropped | ✅ fails |
| 7 | Revocation no longer deactivates | ✅ fails |
| 8 | Fuzzy "latest approval" lookup instead of exact identity | ✅ fails |
| 9 | A **Merge to main** button appears in the panel | ✅ fails |
| 10 | SQL status CHECK drops a TypeScript status | ✅ fails |
| 11 | RLS policy stops verifying the approved commit | ✅ fails |
| 12 | Approval opens a durable operation | ✅ fails |

Two honest caveats about what those catch:

- **6, 10 and 11 are migration-*text* assertions.** They catch drift in the
  file, not in a deployed database. The deployed policies were verified
  separately, by hand, against the live schema.
- **9 is a source assertion, not a rendering one.** It scans the panel's button
  and link labels for words claiming an authority the product does not have. It
  proves what the component *can* offer, never what a user sees.

## Browser E2E — not done, and why

The brief's §35 asks for five Playwright scenarios covering the approval UI, and
§44 lists `pnpm test:e2e` in the quality gate. **Neither exists**, because
Sprint 11A.1 — the sprint that was to build the harness — was never
implemented: it stopped at a blocking question about the test environment and
the next sprint began.

The blocker is unchanged and worth recording plainly: **this machine has no
container runtime** — no `docker`, no Docker.app, no colima or podman — so
`supabase start` cannot run, and there is no isolated database to seed browser
fixtures into. Pointing Playwright at the production database was explicitly
ruled out, and remains ruled out.

What this costs, precisely: every claim in this sprint about *what a user sees*
rests on source assertions and service tests. The last dogfood is the argument
for why that is not enough — four separate defects where the domain was correct
and the screen was wrong. Approval is the worst place for that class of defect,
because the wrong sentence there is about authority.

Until a harness exists, the **real dogfood is the acceptance mechanism**.

## Real dogfood — pending

Uses the existing artifacts. No new provider work is needed and none should be
started for this:

| Existing | Value |
| --- | --- |
| PreparedChange | `3480ad0a` · `vibe/seo-foundations-cc32273131c5` |
| Commit / base | `2f05958…` / `528d372…` |
| ValidationRun | `b562cec4` (passed, and the one the review is bound to) |
| ReviewArtifact | `eb255685` (ready, retained until 20.08.2026) |
| PreviewSession | already stopped — deliberately not restarted |

Steps: open Review, look at the comparison and the diff, press **Approve
change**, read the confirmation, confirm once, verify the approved state, reload,
verify it persists. Then confirm in the database that exactly one approval
exists with the expected commit, and that GitHub is untouched.

## Known limitations

- **Re-validating invalidates the approval.** A second validation of the same
  commit produces a new validation run, which changes the identity — so the
  human must approve again, and because a review is bound to its validation,
  must generate a new comparison first, which costs a browser session. This
  follows the brief's explicit instruction (§26) that a new validation must not
  carry an approval forward. The looser alternative — accept any passing
  validation of the approved commit — would avoid the cost and is worth
  revisiting if it bites.
- **Owner-only.** One approver, who may also be the person who triggered the
  preparation. No separation of duties.
- **Lazy invalidation.** The status changes when a read notices, so a direct
  database reader can see `approved` after the artifact moved on. The card never
  shows it that way — the state is derived before the write — but the row lags.
- **Approval is not proof of review.** A user can approve without scrolling. The
  product can require that evidence *exists*, not that a person absorbed it.
- **No browser test of any of this.** See above.

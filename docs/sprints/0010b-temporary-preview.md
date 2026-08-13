# Sprint 10B — Temporary Change Preview

**Status**

| Slice | State |
| --- | --- |
| 10B-1 — ValidatedArtifact capture | ✅ Complete (`f18aef3`) |
| 10B-2 — Preview runtime & lifecycle | ✅ Complete (`b0817cb`) |
| 10B-3 — Preview UI | ✅ Complete (`9152c46`) |
| 10B-3 — Real preview dogfood | ✅ Verified end to end, twice |
| Durable teardown | ✅ Verified against the real provider |

**Sprint 10B is COMPLETE.** Everything it set out to establish has been
observed against the real provider on 2026-08-13, including the durable teardown
that the first dogfood forced. All four of the sprint's open claims became
observations:

| Claim | Result |
| --- | --- |
| Loopback works under `deny-all` egress | ✅ confirmed — health check passed, egress untouched |
| The public preview edge serves | ✅ confirmed — page rendered in a browser |
| Teardown deletes the snapshot at the provider | ✅ confirmed |
| The whole flow works end to end | ✅ 14.6 s from start to reachable |

A fifth was added by the dogfood itself and then closed: that preview spend is
actually recorded. It was not, silently, and the fix is
[durable teardown](#teardown-moved-into-durable-execution).

## Goal

Let a user see a validated change actually running, without a merge, a deploy,
or their own hosting.

## Context

Sprint 10A ended with a gate the product could state but not act on:

```
repository_write_verified     the bytes on the branch are the bytes we meant
sandbox_validation_passed     those bytes install, typecheck, test and build
human_approved                nothing exists
merged / deployed             nothing exists
```

The first real prepared change was byte-perfect, passed validation, and listed
`/login` in a sitemap. Neither gate catches that, and neither claims to. What is
missing is *looking at it* — and a user cannot judge a change worth approving
from a diff and a green tick.

The obvious route is a Vercel Preview Deployment ([ADR 0004](../decisions/0004-vercel-as-initial-host-and-preview-provider.md)).
That is a **deploy**: the customer's Vercel project, their environment
variables, a build we did not perform, and Vibe-authored code landing in their
own hosting. Much larger authority than "let me see this".

10B-1 built the enabling half: a passing validation captures its filesystem as a
bounded, explicitly-expiring snapshot instead of throwing it away. This slice
turns that artifact into something a person can open.

Full rationale: [ADR 0016](../decisions/0016-temporary-preview-isolation.md).

## Scope

### 10B-2 — runtime (server-side only)

- `nextjs_preview_v1` profile and `preview-policy-v1`
- `PreviewSession` persistence, plus `change_preview` as a durable operation
- Restore a fresh sandbox from exactly the ValidatedArtifact snapshot
- Re-verify integrity, credentials and environment before any application code
- Start a deterministic Next.js production server on one Vibe-controlled port
- One bounded loopback health check, with four distinct classifications
- 15-minute TTL, stop, expiry, cleanup and snapshot deletion
- Preview spend recorded in `sandbox_usage_events`

### 10B-3 — UI

- A `Preview` section on every prepared change, with ten server-decided states
- A public-exposure confirmation dialog, wired to the server's own requirement
- Durable start UX with named stages, survivable across a page reload
- `Open preview` (new tab) and `Stop preview`, with a countdown to expiry
- An authorized origin read that refuses anything not running and unexpired
- Honest re-validation copy wherever the artifact is gone

## Non-Goals

- **Approval, merge, deploy.** None of these exist anywhere in the codebase.
- **Preview history or a management dashboard.** The current state of the
  current prepared change is the whole V0.1 need.
- **Anything from the preview rendered inside Vibe.** No iframe, no proxy, no
  screenshot, no HTML fetch — the URL opens in a new tab or not at all.
- **Environment configuration.** An application that needs runtime config to
  boot fails honestly rather than being handed one.
- **Public-edge verification.** The health check proves the server answers on
  the exposed port; it does not independently prove the public edge serves.
- **A second framework.** One preview profile, deliberately.

## What was built

### The trust model, kept distinct

```
repository_write_verified
sandbox_validation_passed
validated_artifact_available
preview_available            ← this slice
human_approved
merged
deployed
```

`preview_available` means exactly: *the exact validated artifact can run and
become reachable in an isolated temporary environment.* Nothing about quality,
correctness, SEO, security, approval or production readiness. The vocabulary
lives in the type system, not in copy.

### The flow

```
ValidatedArtifact  (validation_runs.artifact_snapshot_id)
  → startChangePreview(projectId, validatedArtifactId, confirmPublicExposure)
  → authorize · resolve · check expiry · check profile · check confirmation
  → PreviewSession + OperationRun          (no provider spend yet)
  → durable workflow
      restoring_artifact    fresh sandbox from the exact snapshot
      verifying_artifact    hashes, .git absence, environment
      starting_server       node_modules/.bin/next start -H 0.0.0.0 -p 3000
      checking_preview      one bounded loopback probe
  → PreviewSession running                 (operation completes here)
  → stop / expiry
  → sandbox stopped · snapshot deleted · artifact marked deleted
```

### Security properties, and where each is enforced

| Property | Where |
| --- | --- |
| Only a passing validation yields an artifact | SQL CHECK + `getValidatedArtifact` query predicate |
| Expiry blocks spend | Service, and again in the restore step |
| Public exposure is confirmed | Service, before the operation row exists |
| Restored bytes are the validated bytes | `verifyRestoredArtifact`, before the server starts |
| No credential-bearing `.git` | Same check, before the server starts |
| No Vibe privilege in the runtime | `PRIVILEGED_ENVIRONMENT_PREFIXES`, before any provider call |
| Outbound `deny_all` | Passed at creation, asserted on every policy in the transcript |
| Exactly one inbound port | Passed at creation, asserted |
| No client-chosen anything | The parameter does not exist |
| TTL bounds the runtime | Sandbox timeout *and* persisted `expires_at` |
| Artifact deleted at teardown | `teardownPreview`, on stop, expiry and terminal failure |

### Deliberate design decisions worth re-reading

- **The preview URL is never persisted.** It is capability-like and is fetched
  from the provider on an authorized read. Past the deadline, none is returned.
- **The health probe runs inside the sandbox**, over loopback, discarding the
  body — so Vibe's runtime makes no outbound request to a host serving untrusted
  code, and no page content enters our process.
- **Cleanup is inside the failure branch**, not unconditional. That is the one
  structural difference from the validation workflow: a preview's running
  sandbox *is* the product, so unconditional cleanup would stop every preview
  the moment it worked.
- **A snapshot deletion failure is recorded, not swallowed**, so it can be
  retried — and never overwrites the reason a preview failed.
- **The ValidationRun and PreparedChange are never amended.** Only artifact
  availability is lost.

## Acceptance Criteria

- [x] Preview requires a passing validation with a live, unexpired artifact
- [x] Explicit public-exposure confirmation is load-bearing on the server
- [x] A fresh sandbox is created from exactly the stored snapshot; no clone, no
      rebuild, no sandbox search
- [x] Integrity, credential and environment checks run before any application
      code
- [x] Outbound `deny_all`, exactly one inbound port
- [x] Deterministic production server; never `next dev`, never a repository
      script
- [x] Health check classifies process exit, timeout, application error and
      provider route separately
- [x] 15-minute TTL persisted and enforced by the provider timeout
- [x] Stop and expiry both delete the artifact snapshot, idempotently
- [x] DB-contract tests pin the TypeScript unions to the SQL CHECKs
- [x] Migration deployed; live constraints verified
- [x] Customer-facing UI, with server-decided state and honest cost copy
- [x] Confirmation is server-enforced and cannot be satisfied by the modal alone
- [x] Nothing in the panel spends money without an explicit click
- [ ] **Real preview dogfood — blocked, see below**

## Validation

```
pnpm lint         ✅
pnpm typecheck    ✅
pnpm test         ✅  1816 tests, 97 files
pnpm build        ✅
pnpm db:status    ✅  no pending migrations
pnpm db:lint      ✅  no schema errors
```

Zero real sandbox calls, zero public port exposure, zero AI calls, zero
repository writes, zero merges, zero deploys. Every test runs against a
`SandboxProvider` double that executes nothing.

### Mutation validation

Nineteen mutations applied and reverted. Every one broke at least one test:

| # | Mutation | Result |
| --- | --- | --- |
| 1 | Passed-validation predicate removed | ❌ → fixed test, then ✅ |
| 2 | Artifact-expiry block removed | ✅ fails |
| 3 | Exposure confirmation removed | ✅ fails |
| 4 | Prepared-file hash check removed | ✅ fails |
| 5 | `.git` credential check removed | ✅ fails |
| 6 | Privileged-environment check removed | ✅ fails |
| 7 | Build-identity check removed | ✅ fails |
| 8 | Egress widened to allow-all | ✅ fails |
| 9 | Second port exposed | ✅ fails |
| 10 | TTL removed from the sandbox | ✅ fails |
| 11 | `next dev` instead of production start | ✅ fails |
| 12 | Active-preview reuse removed | ✅ fails |
| 13 | Expiry no longer hides the origin | ✅ fails |
| 14 | Cleanup removed on stop | ✅ fails |
| 15 | Snapshot deletion removed on failed start | ✅ fails |
| 16 | Cross-user stop authorization removed | ✅ fails |
| 17 | Server starts regardless of integrity | ❌ → added workflow test, then ✅ |
| 18 | `change_preview` dropped from the SQL CHECK | ✅ fails |
| 19 | Cleanup removed from the workflow | ✅ fails |

**Two mutations initially survived, and both found real gaps.**

*Mutation 1* survived because the "validation did not pass" test also removed
the artifact, so it passed for the wrong reason. Deleting the `status = 'passed'`
predicate broke nothing. The test now leaves the snapshot in place.

*Mutation 17* survived because nothing executed `workflow.ts` — the step
functions were tested individually, and Sprint 10A's pattern of mirroring the
workflow's control flow in a test driver cannot catch a divergence between the
mirror and the original. `workflow.test.ts` now runs the real workflow: under
vitest the `"use workflow"` directives are inert string literals, so the
function calls its steps in order, which is exactly the property that needed
asserting.

### A real bug found by a test

The first workflow test ran the process out of memory. The health loop's only
delay is the provider's `exitedWithin`, so a provider that returns instantly
turns it into a busy loop for the whole 90-second budget. That is not only a
test artifact — a degraded control plane or a future adapter that cannot wait
would do the same in production and hammer the provider's per-minute quota. The
loop is now bounded by attempt count as well as by the clock.

## Risks / Notes

- **The loopback health check assumes `deny-all` does not block loopback.** The
  provider documents the network policy as governing *egress*, and loopback
  traffic never leaves the VM — but this is the one assumption in the slice that
  only a real preview can confirm. If it is wrong, the symptom is an honest
  `preview_health_check_failed` rather than a security weakening, and the fix is
  not to widen egress. **First thing 10B-3 must check.**
- **Public-edge reachability is not independently verified.** The probe plus the
  provider's route is what `preview_available` claims. 10B-3's dogfood is what
  turns that into an observed fact.
- **Expiry convergence is lazy.** A session nobody reads keeps a stale `running`
  row until someone does. The VM stops regardless (provider timeout) and the
  snapshot expires regardless (provider-minimum 24-hour TTL), so nothing leaks — but the row is
  not self-healing, and the product must not say it is.
- **A preview is usually a one-shot.** Deleting the artifact at teardown means a
  second preview of the same change normally needs an explicit re-validation.
  That spend is the user's to authorize and must be visible in 10B-3's UI.
- **`next start` may not suit every Next.js output mode.** `output: 'export'`
  has no server; `standalone` has a different entrypoint. Both currently fail as
  `preview_start_failed`, which is honest but unhelpful copy. Worth a narrower
  failure code once a real repository hits it.
- **Build-identity digests are new.** Runs validated before this slice carry
  none, and preview treats that as unverifiable rather than as agreement. The
  prepared-file hashes still run and are the load-bearing check. This did **not**
  bump `sandbox-policy-v4`: recording a digest changes no command, no network
  policy, no timeout and no secret handling, and can fail nothing that
  previously passed.

## Real dogfood — 2026-08-13

### What was observed

One new ValidationRun under `sandbox-policy-v5` captured an artifact
(`snap_wxSSmjhOgvWZm9kZXz8v7ZPFNWMo`). One preview was started from it:

| | |
| --- | --- |
| PreviewSession | `5dc487ed-7caa-4b7f-ab6d-6f29280b42db` |
| Time to reachable | **14.6 s** |
| Port | 3000, the only one exposed |
| Runtime | `node22` — the snapshot's own image, as designed |
| TTL | 15 minutes, `expires_at` persisted at claim time |
| AI calls | **0** |
| GitHub writes | **0** |

**Loopback under `deny-all`: confirmed.** `ready_at` is only written when the
health probe succeeds, so the sprint's one unproven assumption is now an
observation — and the egress policy was never touched to get it.

**Public edge: confirmed.** The URL was opened manually and the page rendered.
Recorded as a separate observation from the loopback result, because they prove
different things.

**Stop and cleanup: confirmed.** Sandbox stopped, snapshot deleted, artifact
marked deleted on both the session and the run, `Open preview` gone. The
ValidationRun stayed `passed`, the PreparedChange stayed `prepared`, and the
repository was untouched.

Human observation only: the page renders. That is not approval, and Sprint 10B
has no approval gate.

### What it took to get there

Four rounds, and the value of each is in what it eliminated rather than what it
fixed:

| Failure | Cause | Fix |
| --- | --- | --- |
| `capture_failed`, no detail | a bare `catch {}` | record the sanitized provider error |
| `Status code 400 is not ok` | `Error.message` only | allowlisted extraction of the provider's own fields |
| HTTP 400 on snapshot | expiry below the provider's 24 h minimum | TTL 60 min → 24 h, `sandbox-policy-v4` → `v5` |
| `sandbox_lost` | **the real cause** — see below | write the artifact with the verdict |

The last one is the sprint's most useful lesson. The snapshot had been
succeeding all along; the Vercel activity log showed it created, 1.14 GB, seven
seconds before Vibe reported `sandbox_lost`.

`validation_runs_artifact_only_when_passed` refuses an artifact on a row that
is not `passed`, and the artifact was written by the cleanup step — which runs
*before* the finalize step that records the verdict. Postgres rejected it, the
step failed, the retry found a sandbox the successful snapshot had already
stopped, and reported the only thing it could see.

**No test could see it**: the in-memory database does not evaluate CHECK
constraints, so the write production refused succeeded in every test. Both
artifact CHECKs are now modelled there, and reinstating the old write order
fails a test.

Two diagnostics were added along the way and both earned their place —
`inspect()` on the provider port, which turned `sandbox_lost` into
`status=stopped sessionTimeout=900000 livedMs=282318`, and a session-lifetime
fix that worked and changed nothing, which is what proved the timeout theory
wrong.

## Teardown moved into durable execution

The dogfood's second finding, and the reason this sprint is not closed.

The stop was correct in every visible way and recorded **no provider spend at
all**. `sandbox_usage_events` grants `SELECT` and nothing else — deliberately,
because a ledger the client can write is not a ledger — and an inline stop runs
under the cookie-scoped client, so its insert was refused by RLS and swallowed
by a best-effort handler that exists so a ledger problem cannot take down the
operation that earned it. Three correct decisions composed into a silent one.

ADR 0016 originally recorded that teardown runs inline because it is well under
ADR 0013's durability threshold. **The threshold was the wrong test.** What
decides is whether the work needs the privileged writer, and only durable
execution may hold one (CLAUDE.md rule 53).

Manual stop and expiry now converge on one workflow:

```
terminate ─▶ record usage ─▶ converge
 destructive   retryable      retryable
```

- **Cleanup outranks accounting.** A failed ledger write never resurrects or
  retains the sandbox; the ledger step retries alone.
- **Retries cannot double-count.** A unique index on `preview_session_id` means
  a second insert loses at the database.
- **The request only claims.** One conditional `UPDATE` out of
  `starting`/`running`, so a double click or an expiry racing a manual stop
  starts no second teardown.
- **The reason is persisted, not inferred.** After queue latency, deriving it
  from `expires_at` would report a manual stop made seconds before the deadline
  as an expiry.

Refused, on instruction and on merit: an owner `INSERT` policy (makes the ledger
client-writable) and a service-role helper called from a request (satisfies the
module boundary as text while breaking what it is for).

Recorded in [ADR 0016 §14](../decisions/0016-temporary-preview-isolation.md),
which preserves the original inline decision rather than rewriting it.

## Validation

```
pnpm lint         ✅
pnpm typecheck    ✅
pnpm test         ✅  1849 tests, 98 files
pnpm build        ✅
pnpm db:status    ✅  no pending migrations
pnpm db:lint      ✅  no schema errors
```

### Mutation validation — teardown

| # | Mutation | Result |
| --- | --- | --- |
| 1 | Stop writes the ledger inline again (the RLS defect) | ✅ fails |
| 2 | Teardown skips the ledger step | ✅ fails |
| 3 | The claim no longer gates a second teardown | ✅ fails |
| 4 | The ledger loses its idempotency index | ✅ fails |
| 5 | Ledger runs before cleanup (accounting outranks cleanup) | ✅ fails |
| 6 | Ledger ownership taken from the session, not the operation | ⚪ equivalent |

Mutation 6 is reported honestly as **equivalent, not a gap**: `getPreviewSession`
already filters on the operation's project, so a session is only ever found when
the two agree. There is no behaviour to break.

## Durable teardown — verified 2026-08-13

Second preview, started and stopped through the rewritten path. The step order
is visible in the timestamps rather than asserted:

```
22:46:49.944  session started
22:47:01.686  ready_at            11.7 s to reachable
22:47:29.561  teardown operation started
22:47:33.070  usage ledger row written        ← step 2
22:47:34.051  session converged, artifact deleted  ← step 3
22:47:34.353  ValidationRun artifact marked deleted
22:47:34.640  teardown operation completed
```

The ledger row that could not exist before:

| Field | Value |
| --- | --- |
| `operation` | `change_preview` |
| `sandbox_duration_ms` | 42 163 |
| `active_cpu_ms` | **3 628** |
| `network_ingress_bytes` | 43 785 |
| `network_egress_bytes` | 286 869 |
| `provider_cost_usd` | `null` — never estimated |
| `cleanup_status` | `stopped` |

Measured, not derived. The egress figure is the public-edge traffic from opening
the preview in a browser, which is billable and now visible.

Also confirmed: `teardown_reason` persisted as `stopped` by the initiator; one
ledger row and no duplicate; no `change_preview.cleanup_incomplete` event, so
the snapshot deleted cleanly; the teardown operation completed with no failure
code; the ValidationRun stayed `passed` and the PreparedChange stayed
`prepared`.

## Known limitations carried forward

- **Expiry convergence is lazy.** A session nobody reads keeps a stale `running`
  row until someone does. The VM stops regardless (provider timeout) and the
  snapshot expires regardless (provider-minimum 24-hour TTL), so nothing leaks —
  but the row is not self-healing and the product does not pretend it is.
- **The artifact retention backstop is 24 hours, not the hour originally
  chosen.** Vercel rejects any shorter expiry. Explicit deletion at teardown is
  unchanged, so the expected lifetime is still minutes.
- **A preview is usually a one-shot.** The artifact is deleted at teardown, so a
  second preview normally costs a new validation. The UI says so; there is no
  automatic refresh.
- **`next start` may not suit every Next.js output mode.** `output: 'export'`
  has no server and `standalone` has a different entrypoint. Both currently fail
  as `preview_start_failed` — honest, but unhelpful copy.
- **Orphaned snapshots from the four failed runs** were left in provider storage
  and expire on the 24-hour TTL.
- **No component tests.** The project has no React testing tooling and tests
  pure view functions instead, which the preview state machine is.

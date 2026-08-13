# Sprint 10B — Temporary Change Preview

**Status**

| Slice | State |
| --- | --- |
| 10B-1 — ValidatedArtifact capture | ✅ Complete (`f18aef3`) |
| 10B-2 — Preview runtime & lifecycle | ✅ Complete (`b0817cb`) |
| 10B-3 — Preview UI | ✅ Complete (`9152c46`) |
| 10B-3 — Real preview dogfood | ⛔ Blocked — see [Dogfood](#real-dogfood-blocked) |

**Sprint 10B is NOT complete.** The capability is built, tested, deployed and
reachable in the UI, but **no preview has ever been started against a real
repository**. Until it has, four things remain claims rather than observations:

- that loopback works under `deny-all` egress;
- that the public preview edge actually serves;
- that teardown really deletes the snapshot at the provider;
- that the whole flow works end to end.

The sprint stays open until those are observed. See
[Real dogfood](#real-dogfood-blocked).

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

## Real dogfood — blocked

**No preview has been started against a real repository. Nothing below is an
observation; it is a plan.**

### Why it is blocked

The dogfood has to run against the deployed branch, through the real UI, as the
real user. Three facts make that impossible from here:

1. The branch deployment
   (`vibe-business-930iwjc7c-planner-agent.vercel.app`, commit `9152c46`,
   state `READY`) is behind **Vercel SSO** — `ssoProtection` is enabled for
   `all_except_custom_domains`, and a branch deployment has no custom domain.
2. Reaching the Vibe app behind it needs a **Supabase login**. Sessions are
   per-origin cookies, so an existing session on production does not carry to a
   branch deployment.
3. Both gates are password entry, which this assistant does not do, and no
   browser with an existing session was available.

The alternative — writing rows directly, or calling the service outside the UI
— was rejected. It would skip the confirmation flow, the durable workflow and
the real provider, which are the three things the dogfood exists to exercise.
A green result obtained that way would be a worse outcome than an honest gap.

### Baseline, verified in the live database

Confirmed before any dogfood, so the run starts from a known state:

| Fact | Value |
| --- | --- |
| PreparedChange | `3480ad0a-db63-4b9d-8073-ea5ef9a72508` |
| Branch | `vibe/seo-foundations-cc32273131c5` |
| Commit | `2f05958e3410deaeb97029861abc05889139b4a7` |
| Prepared status | `prepared` |
| Latest passing ValidationRun | `33923863-5853-4aa4-ac27-7ffef2e08c17`, `sandbox-policy-v3` |
| Artifacts ever captured | **0** |
| PreviewSessions | **0** |
| `change_preview` operations | **0** |
| Preview usage rows | **0** |
| Validation usage rows | 9 (historical) |

Two consequences worth stating, because they are what makes the plan work:

- The last pass ran under `sandbox-policy-v3` and the current policy is **v4**,
  so the validation identity differs and a new validation genuinely runs rather
  than reusing the stored pass. Exactly one new ValidationRun, as intended.
- No historical run has `buildIdentityDigests` — that recording landed with
  10B-2 — so the new run is also what makes the restore-time build-identity
  comparison possible at all.

Until the new run exists, the UI will correctly show **Preview artifact
unavailable** with a **Validate again** button for this change. That is the
first thing to confirm on screen, and it costs nothing.

### The run, when someone can sign in

1. Open the branch deployment, sign in, open the project.
2. On the prepared change, confirm `Preview` reads *artifact unavailable* and
   that opening the page started **nothing** (`operation_runs` unchanged).
3. Click **Validate again**. One ValidationRun, `sandbox-policy-v4`. Record:
   run id, operation id, result, `artifact_snapshot_id`, `artifact_expires_at`,
   credential scrub, build-identity verification, sandbox usage, cleanup.
4. Verify in the database, **before** previewing: run `passed`, artifact
   present, belonging to that run and to commit `2f05958`, not deleted, expiry
   in the future.
5. Click **Start temporary preview** and confirm the public-exposure dialog.
   Exactly one start. Record: session id, operation id, profile and policy
   versions, runtime, integrity result, network policy, server start duration,
   health result, time to ready, port, expiry, usage, AI calls (expect `0`).
6. **Record the loopback result explicitly.** This is the one open technical
   question in the sprint: does a loopback probe reach the local Next.js
   process while egress is `deny-all`? If it fails, classify the provider
   behaviour and **stop** — do not widen egress to make it pass.
7. Click **Open preview**. This is the **first public-edge verification**, and
   it is a separate observation from the loopback result. Check the homepage
   renders, the origin is the sandbox preview origin, and `/robots.txt` and
   `/sitemap.xml` respond. Do not automate a crawl.
8. Note human observations as **observations**. Not approval — Sprint 10B has
   no approval gate.
9. Confirm no secrets reached the preview (GitHub token, Anthropic key,
   Supabase service role, Browserbase key, Vercel management token, customer
   production values). Record invariants, never values.
10. Click **Stop preview** — do not just wait for expiry. Then verify
    independently: session `stopped`, sandbox gone at the provider, snapshot
    deleted, artifact marked deleted, **Open preview** gone, no origin
    returned, PreparedChange still `prepared`, ValidationRun still `passed`,
    repository unchanged.
11. Record provider usage for both sandboxes. `provider_cost_usd` stays `null`
    unless an exact attributable amount exists; any rate-card figure is labelled
    an **estimate** and is not persisted as accounting truth.

### Then, and only then

Mark 10B-3 dogfood ✅ and Sprint 10B complete, recording failures honestly if
any occur and preserving the intermediate findings above rather than tidying
them away.

## Known limitations carried into 10C

- **Loopback under `deny-all` is still an assumption.** The provider documents
  the network policy as governing egress and loopback never leaves the VM, but
  no real preview has confirmed it. If it is wrong, the symptom is an honest
  `preview_health_check_failed`, and the fix is a narrower provider mechanism —
  never a wider egress policy.
- **Public-edge reachability is unverified.** The health check plus the
  provider's route is what `preview_available` claims; the edge itself has
  never been opened.
- **Expiry convergence is lazy.** A session nobody reads keeps a stale
  `running` row until someone does. The VM stops regardless (provider timeout)
  and the snapshot expires regardless (provider-minimum 24-hour TTL), so nothing leaks — but
  the row is not self-healing and the product does not pretend it is.
- **A preview is usually a one-shot.** The artifact is deleted at teardown, so a
  second preview normally costs a new validation. The UI says so; there is no
  automatic refresh.
- **`next start` may not suit every Next.js output mode.** `output: 'export'`
  has no server and `standalone` has a different entrypoint. Both currently
  fail as `preview_start_failed`, which is honest but unhelpful copy. Worth a
  narrower code once a real repository hits it.
- **No component tests.** The project has no React testing tooling, and the
  convention is to test pure view functions instead — which the preview state
  machine is. Adding a test renderer for one panel was not worth new
  infrastructure.

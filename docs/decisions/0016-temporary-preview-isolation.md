# 0016 - Temporary Preview Isolation

Status: Accepted; §1, §3, §7 and §11 superseded by [0064](0064-preview-before-validation.md)
Date: 2026-08-13
Builds on [0015](0015-untrusted-repository-execution-provider.md)

## Context

Sprint 10A established `sandbox_validation_passed`: a prepared change's commands install, typecheck, test and build inside an isolated microVM. The first real prepared change was byte-perfect, passed validation, and listed `/login` in a sitemap. Neither gate could have caught that, and neither claims to.

The missing thing is *looking at it*. A user cannot judge whether a change is worth approving from a diff and a green tick, and the product has no merge, no deploy and no approval — so there is nothing that would let them see the change running.

The obvious route is a Vercel Preview Deployment ([ADR 0004](0004-vercel-as-initial-host-and-preview-provider.md)). That is a **deploy**: it requires the customer's Vercel project, their environment variables, and a build we did not perform, and it would place Vibe-authored code into the customer's own hosting. It is a much larger authority than "let me see this", and it is not available at this stage of the product.

Sprint 10B-1 built the enabling half: a passing validation captures its filesystem as a bounded, explicitly-expiring snapshot — a **ValidatedArtifact** — rather than throwing it away. This ADR records how that artifact becomes something a person can look at.

## Decision

### 1. A preview requires a passing validation and restores its exact artifact

There is one source: `validation_runs.artifact_snapshot_id`, resolved server-side from a row the user owns.

There is no code path that clones GitHub, fetches a branch, re-validates, searches for a recent sandbox, resumes an arbitrary stopped one, or rebuilds when the snapshot is missing. A hidden rebuild would produce a *different* artifact wearing the validated one's name, and the whole claim rests on it being the same bytes.

A failed validation has no artifact and never will. The database refuses one on a non-passing row, and the query that resolves an artifact filters on `status = 'passed'` independently — two gates, because the first mutation run showed that removing the second broke nothing.

### 2. Validation sandboxes stay non-persistent

[ADR 0015 §5](0015-untrusted-repository-execution-provider.md) is unchanged. `persistent: false` stays. A persistent sandbox snapshots itself on *every* stop — including failed runs and runs that stopped mid-scrub — under the provider's 30-day default retention.

Capture is the opposite shape: explicit, only after every check passed and the credential scrub was re-verified, with an expiry Vibe chose.

### 3. The restored artifact is re-verified before the application starts

Validation proved that *a* filesystem contained the prepared change. Between that and a preview there is a snapshot, a storage system and a restore — three things Vibe does not implement. So before any repository-controlled code runs:

```
no credential-bearing .git          a snapshot is a filesystem image
prepared-change file hashes         against their stored digests
build-identity file hashes          against digests recorded at validation
no privileged environment           checked against Vibe's own construction
```

Build-identity digests are recorded by validation rather than re-fetched from GitHub, because a preview holds no credential and acquires no source. A run validated before digests were recorded carries none, and that is treated as *unverifiable*, never as agreement.

This is **not** a re-validation. No install, no typecheck, no test, no build: those answer a settled question, and re-running them would mean the capture was pointless.

### 4. The preview URL is public-unlisted, and the user confirms it explicitly

`sandbox.domain(port)` returns a public `*.vercel.run` address. Anyone with the link can reach the customer's application; nothing links to it.

Publishing that is a consequence the product must not take on a user's behalf by inference, so the application service requires an explicit confirmation. It is **load-bearing on the server**, checked before the operation row is created: without it there is zero sandbox creation, zero exposed port and zero provider spend. A confirmation that lived only in a component is one that a future API route or script silently skips.

The origin itself is treated as capability-like. It is **never persisted** — not in the session row, not in an audit event, not in AI evidence, not in analytics — and is re-fetched from the provider on an authorized read. Past the deadline, an authorized read returns none.

### 5. No production secrets, ever

The preview environment is exactly `CI`, `NODE_ENV` and `NEXT_TELEMETRY_DISABLED` — the validation environment, unchanged.

Absent by construction and asserted absent by tests: Supabase service role, Anthropic key, GitHub App private key or installation token, Browserbase key, Vercel management tokens, and the customer's own production configuration. An application that cannot start without configuration fails as `preview_missing_environment`, which is a true statement about the change rather than a reason to hand a **public-facing** untrusted server a credential.

The check has its own failure code, `preview_privileged_environment`, separate from an artifact integrity failure. If it fires, the defect is in Vibe, not in the customer's repository, and the two need completely different responses.

### 6. Inbound and outbound are two decisions

Confirmed against the current Vercel firewall documentation rather than assumed: the network policy governs **egress**. `deny-all` denies outbound traffic including DNS. Exposed ports are a separate, inbound concern with their own routes.

So a preview is:

| Direction | Policy |
| --- | --- |
| Inbound | exactly one port, Vibe's, publicly routed |
| Outbound | `deny-all`, applied at creation and never widened |

"The preview needs the internet to be reachable" is a confusion between the two. A server rendering an already-built application needs no egress, and if a specific application does, it fails — the global policy is not widened to make one project pass ([ADR 0015 §7](0015-untrusted-repository-execution-provider.md)).

Had the provider been unable to express these independently, the safest supported policy would have been chosen and the limitation recorded here. It can, so this is a statement of fact rather than a compromise.

### 7. One port, one deterministic production server

`node_modules/.bin/next start -H 0.0.0.0 -p 3000`, constructed by Vibe.

Not `pnpm start`: the `start` script's contents are repository-controlled text, so running it would let a repository decide what Vibe serves on a public port by editing one line of JSON. Not `npx next start`: `npx` may resolve over a network the preview does not have. Not `next dev`: a development server rebuilds on demand and serves unminified code with error overlays — a different application from the one that was validated.

The binary is still repository-controlled code. That is unavoidable and fine — running the built application *is* the point — and it happens inside a microVM with no egress and no credentials. What matters is that the *instruction* is deterministic and comes from us.

The port is fixed by policy. No debug port, no inspector, no second server.

### 8. The health check probes loopback, and says only what it proves

A preview is not marked `running` on process start alone. One bounded `curl` against `http://127.0.0.1:3000/` runs inside the sandbox, discarding the body.

Probing from inside rather than fetching the public URL from Vibe's runtime means no outbound request to a host serving untrusted code, and no response body ever entering Vibe's process. Loopback is not egress, so it works under `deny-all`.

Four outcomes are classified separately, because a user whose build has a missing environment variable and a user whose provider had no capacity need different sentences:

```
process exited            the application crashed; its own output says why
probe never succeeded     started, never answered inside the budget
probe answered 5xx        the application is up and erroring
no route for the port     the provider, not the application
```

A root 404 is a **pass**: that is a running application whose author has no index route, and failing it would substitute Vibe's opinion about their site map for a liveness check.

What this does **not** independently prove is that the public edge is serving. The product does not claim it does. Confirming it is 10B-3's dogfood.

### 9. Fifteen-minute TTL, enforced by two clocks

- The **sandbox timeout** is set to the TTL at creation, so the VM stops at the deadline whether or not anything in Vibe ever runs again. This is what makes "a preview runtime does not live indefinitely" a fact rather than an intention.
- The **persisted `expires_at`** is what authorized reads check, so Vibe stops offering a preview it can no longer stand behind.

They are deliberately not the same clock. It is written at claim time, before the sandbox exists, so a preview that started and then lost its workflow is still bounded.

### 10. Expiry converges lazily, and the product says so

Three mechanisms, and only the first is guaranteed to run:

1. the provider's sandbox timeout stops the VM;
2. the next authorized read notices the deadline and hands the session to the durable teardown (§14), which stops the sandbox and deletes the snapshot;
3. the snapshot's own 24-hour TTL — the shortest Vercel accepts — is the backstop for the case where nobody ever reads.

There is no cron, no scheduler and no background sweeper — none exists in this architecture, and inventing one for a fifteen-minute TTL would be new infrastructure for a problem the provider already bounds ([ARCHITECTURE.md §7](../../ARCHITECTURE.md#7-deferred--open-decisions) leaves job technology undecided).

What is deliberately **not** claimed: that a session row transitions promptly on its own. It transitions when someone looks. Saying otherwise would be describing a cleanup nothing performs.

### 11. The ValidatedArtifact is deleted at terminal preview lifecycle

**Originally recorded here: teardown runs inline, in the request, because it is two provider calls and two writes and ADR 0013's durability threshold is work measured in tens of seconds. That reasoning is preserved because it was sound on the evidence available; §14 records what the first real preview showed and why it was reversed.**

Stop, expiry, or a terminal start failure all lead to: stop the sandbox → delete the snapshot → mark the artifact deleted.

An artifact is a customer's built filesystem in a third party's storage. It exists for one reason, and once the preview that needed it has ended, keeping it would be paying a provider to retain customer data for a purpose that no longer exists. The provider-minimum 24-hour TTL is the backstop for the cases where deletion cannot be confirmed, not the plan.

Deletion is idempotent, and a failure is **recorded rather than swallowed** (`artifact_delete_failed`) so it can be retried — while never overwriting the reason a preview failed. A user asking why their preview did not work is not asking about snapshot housekeeping.

The **ValidationRun and PreparedChange are never deleted or amended**. The run stays historically `passed`; the change stays historically `prepared`. What is lost is only the ability to preview again without an explicit re-validation — which is a real cost, is the user's to authorize, and is never incurred on their behalf (CLAUDE.md rule 60).

### 12. Preview is not approval

```
repository_write_verified → sandbox_validation_passed → validated_artifact_available
  → preview_available → human_approved → merged → deployed
```

Only the first four exist. `preview_available` means:

> The exact validated artifact can run and become reachable in an isolated temporary environment.

It does not mean the change is good, correct, on-brand, SEO-sound, secure, reviewed, mergeable or production ready. A preview that renders a beautiful broken page is a successful preview.

There is no merge authority and no deploy authority in this sprint or anywhere in the codebase.

### 13. Preview semantics are versioned

`preview-policy-v1` versions the runtime, the port, the server command strategy, the network policy, the TTL, health-check behaviour, the secret policy, and cleanup and snapshot-deletion semantics — together. It is part of the preview identity, so changing any of them invalidates preview reuse by construction rather than by anyone remembering to (CLAUDE.md rule 65).

### 14. Preview teardown is durable execution

**Amended 2026-08-13, after the first real preview. The original decision is preserved below because the reasoning that produced it was sound and the thing that refuted it was not visible from the code.**

The original §11 had teardown run inline, in the request: stop the sandbox, delete the snapshot, record the spend, mark the session. The argument was ADR 0013's own threshold — durable execution is for work measured in tens of seconds, and this is four operations measured in one or two. Making it a workflow looked like ceremony.

The first real stop was correct in every visible way. The sandbox stopped, the snapshot was deleted, the session went terminal, the audit event was written. `sandbox_usage_events` recorded **nothing**, and nothing anywhere reported a problem.

`sandbox_usage_events` grants `SELECT` and no other policy, deliberately — *a ledger the client can write is not a ledger*. An inline stop runs under the cookie-scoped client, so its insert was refused by RLS, and `recordPreviewSandboxUsage` swallows write failures by design so that a ledger problem cannot take down the operation that earned it. Three correct decisions composed into a silent one.

**The threshold that matters was never duration. It is whether the work needs the privileged writer.** Teardown does, and only durable execution may hold it (CLAUDE.md rule 53). So teardown is durable execution.

Two alternatives were considered and refused:

- **An owner `INSERT` policy on `sandbox_usage_events`.** This is the smallest change and it makes the ledger client-writable, which is the one property it exists to have.
- **A service-role ledger helper called from the request.** This satisfies "only `src/modules/operations/` may use the service-role client" as text while breaking what the rule is for. Rule 53 says *for durable execution only*, and a request is not that.

Manual stop and expiry converge on **one** workflow. They differ in a status and a sentence; everything else about ending a preview is identical, and two implementations would drift on exactly the parts that cost money.

```
terminate ─▶ record usage ─▶ converge
 destructive   retryable      retryable
```

**Cleanup outranks accounting.** If the ledger write fails after the sandbox is already stopped, the sandbox stays stopped and the ledger step retries alone. Nothing resurrects or retains a paid VM to make the books balance.

Retries are safe on every step. `terminate` is idempotent by construction — stopping a stopped sandbox and deleting a deleted snapshot are its intended outcomes — and still carries `maxRetries = 0`, because a platform retry of a provider call is ambiguity bought for nothing. The ledger row is protected by a unique index on `preview_session_id`, so a retry loses at the database rather than double-counting a sandbox that ran once. Convergence is scoped to non-terminal rows.

The reason for teardown is **persisted by whoever initiates it**, not inferred later from `expires_at`: after queue latency, a manual stop made seconds before the deadline would otherwise converge as an expiry.

What the request still does is claim the session — one conditional `UPDATE` out of `starting`/`running` — so a double click, or an expiry racing a manual stop, finds nothing left to claim and starts no second teardown.

## Consequences

### Positive

- A user can see a validated change running, without a deploy, a merge, or their own hosting.
- The public-exposure decision is explicit, server-enforced, and auditable.
- A customer filesystem is deleted as soon as the preview that needed it ends, which is normally minutes.
- Preview spend is measured in `sandbox_usage_events` alongside validation, distinguishable by operation, and separate from inference spend.

### Negative / Tradeoffs

- **The retention backstop is 24 hours, not the hour originally chosen.** Vercel rejects any snapshot expiry below `86400000` ms, which the first dogfood established by being refused with an HTTP 400. Explicit deletion at the end of a preview is unchanged and remains the plan, so the *expected* lifetime is minutes — but when deletion cannot be confirmed, a customer's built filesystem now sits in provider storage for a day rather than an hour. That is a real weakening of the backstop, it is not something Vibe can tighten, and it is recorded here rather than left to be discovered in the budget constant.

- **A preview is usually a one-shot.** Deleting the artifact at teardown means previewing the same change again normally requires an explicit re-validation, and that costs sandbox minutes. The alternative — keeping artifacts around — is retaining customer data speculatively, which is a worse trade.
- **Fifteen minutes is short** for a careful review. Extending it means starting another preview deliberately, which is visible and paid for rather than silent.
- **No environment configuration.** Applications that need runtime configuration to boot cannot be previewed. Preview-safe configuration is a real future capability and deliberately not routed around now.
- **The loopback health check does not prove public-edge reachability.** Recorded as a known limit rather than papered over, and the first thing a real preview will confirm or refute.
- **Expiry convergence is lazy.** A session nobody reads keeps a stale `running` row until someone does, bounded by the snapshot TTL. Accepted in exchange for introducing no scheduling infrastructure.

## Related

- [0004](0004-vercel-as-initial-host-and-preview-provider.md) — `PreviewProvider` and Vercel *Preview Deployments*. A different mechanism at a different trust level; this ADR does not supersede it.
- [0006](0006-untrusted-repository-execution.md) — untrusted repository code executes only in isolated ephemeral environments.
- [0013](0013-durable-operation-execution.md) — durable operations; preview start is one, preview stop deliberately is not.
- [0015](0015-untrusted-repository-execution-provider.md) — Vercel Sandbox, the provider abstraction, and the credential and network rules this builds on. Section 5's `persistent: false` is unchanged; the ValidatedArtifact capture that made this sprint possible landed in `f18aef3`.

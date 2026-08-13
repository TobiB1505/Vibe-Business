# 0015 - Untrusted Repository Execution Provider: Vercel Sandbox

Status: Accepted
Date: 2026-08-12
Supersedes the deferred half of [0006](0006-untrusted-repository-execution.md)

## Context

[ADR 0006](0006-untrusted-repository-execution.md) fixed the security principle — untrusted repository code executes only in isolated ephemeral environments — and deliberately deferred the provider. It has been deferred for nine sprints, which was correct: nothing needed to execute customer code until now.

Sprint 10A needs it. Sprint 9 established that a prepared change can be verified as *written correctly* (`repository_write_verified`) and said nothing about whether it works. Answering "does this commit install, typecheck, test and build?" requires running the customer's `package.json` scripts, their dependencies' tooling, and their framework's build — none of which Vibe authored or reviewed.

The first real prepared change made the gap concrete: it was byte-perfect, verified by read-back hash, and listed `/login` in a sitemap. Build validation would not have caught that either — but the distance between "we wrote the right bytes" and "this change works" is now the product's main uncertainty.

## Decision

### 1. Customer repository code never executes in the Vibe runtime

Restated from 0006 and now enforceable rather than aspirational. `npm install`, package scripts, postinstall hooks, build tooling and test runners must not execute in:

- the Vibe application process or any Vercel Function serving Vibe
- the workflow orchestration runtime
- the database environment
- a developer machine

### 2. Vercel Sandbox is the initial provider

Each sandbox is a Firecracker microVM with its own filesystem and network, created for one validation and destroyed after it. Chosen for reasons that are specific rather than incidental:

- **Runtime-mutable egress policy.** `Sandbox.create({ networkPolicy })` plus `sandbox.update({ networkPolicy })` allows dependencies to be fetched under a narrow allowlist and the network to be closed *before* repository code runs, in one sandbox. Without live policy updates, this would need either open egress throughout or two sandboxes.
- **`deny-all` blocks DNS resolution**, not merely traffic. An allowlist that still resolves arbitrary names leaves a covert channel over DNS itself.
- **Provider-side authenticated `git` clone** at an exact revision, so the credential is handled at creation and never has to be written into the sandbox by us.
- Already the hosting and workflow provider ([0004](0004-vercel-as-initial-host-and-preview-provider.md), [0013](0013-durable-operation-execution.md)), so this adds no new vendor.

### 3. The provider stays behind an abstraction

`SandboxProvider` / `SandboxHandle` in `src/modules/validation/sandbox-port.ts`. Only `src/modules/validation/vercel/` may import `@vercel/sandbox`.

The purpose is not portability theatre. It is that the orchestrator — where every security decision lives — is testable without an account, a network or a bill, and that the two-phase network transition is expressed in the *domain's* vocabulary so tests can assert its ordering.

### 4. There is no local execution path, ever

The tempting shortcut is a development-convenience branch:

```ts
if (!process.env.VERCEL) exec("pnpm build");   // never
```

That is a remote code execution vulnerability wearing a developer-experience costume: any repository a user connects could run arbitrary commands on whatever machine took the shortcut. Tests use fakes that execute nothing. Production uses the sandbox. **If the sandbox is unavailable, validation fails** — it does not degrade to somewhere less isolated.

### 5. No Vibe or customer production secrets enter the sandbox

The environment is exactly `CI`, `NODE_ENV` and `NEXT_TELEMETRY_DISABLED`. None grants anything.

Absent by construction: Supabase service role, Anthropic key, GitHub App private key, Browserbase key, Vercel management tokens, and the customer's own production configuration. A build that needs a secret fails, and that failure is a true statement about the change rather than a reason to hand untrusted code a credential. Preview-safe environment configuration is a later capability, not a gap to route around now.

### 6. The source-acquisition credential is destroyed before repository code runs

A short-lived GitHub installation token is minted immediately before creation and used only as the clone credential. Then, before anything the repository controls executes:

1. `.git` is removed, taking the credential-bearing remote configuration with it;
2. its absence is **verified**, and a surviving credential store fails the run;
3. GitHub is dropped from the network allowlist.

"The token is short-lived" is explicitly **not** the boundary. An hour is ample time to exfiltrate a repository.

### 7. Network policy is restrictive and phased

| Phase | Policy | Why |
| --- | --- | --- |
| Source acquisition | GitHub domains only | Clone the exact commit |
| Dependency install | package registry only, `--ignore-scripts` | The one networked step; lifecycle hooks suppressed |
| Repository execution | `deny-all` | Nothing can phone home |

A repository whose build needs arbitrary network access fails validation in V0.1. The global policy is not widened to make one project pass.

### 8. Source identity is established by pinning and hashing, not by Git

**Amended 2026-08-13, after six real runs. The first amendment rested on a wrong
inference and is corrected below.**

The original design re-observed the checked-out commit with `git rev-parse HEAD`
and compared it to the prepared commit. Four runs failed with
`fatal: not a git repository`, and this ADR briefly recorded that Vercel
materializes a git source as a filesystem without git metadata.

**That was wrong.** A directory listing showed the cause: Vercel clones into
`/vercel/sandbox/<repo>/`, and the command had been running in the sandbox home.
The provider-side clone leaves a real checkout one directory down. The error
message was accurate; the conclusion drawn from it was not.

The alternative was to clone inside the sandbox ourselves. Rejected:

> **Do not introduce a stronger secret to obtain a weaker proof.**

A self-managed clone means carrying a GitHub installation token into a VM that
later runs untrusted code — the token would sit in a command line and in
`.git/config` until scrubbed. Package managers, git hooks, an unexpected
filesystem state or one scrubbing bug would turn a theoretical integrity gap
into a real credential exposure. The proof gained does not justify the secret
introduced.

Because the checkout exists, observing the commit costs nothing — Vercel
performed the clone, so no credential enters the VM. The layered claim,
recorded per run in `validation_runs.source_integrity`:

```
source_revision_pinned              ✅ immutable SHA passed to the provider
prepared_change_files_verified      ✅ hashed in the sandbox, before any repo code
build_identity_files_verified       ✅ hashed against GitHub at that same SHA
git_commit_observed                 ✅ where the provider leaves a checkout
```

The observation is **recorded, not required**. A mismatch is a definitive
integrity failure and stops the run before any repository-controlled command. An
*unavailable* git is not a failure, because pinning plus hashing already carries
the guarantee on a provider that materializes a bare filesystem. The strongest
available proof is taken; the weaker ones always hold.

A commit SHA is immutable, so the failure the original check existed to catch —
the branch moving under us — cannot happen to a pinned revision. The remaining
question is whether the provider delivered what was asked for, and that is
answered by hashing files: the prepared change's own files against their stored
digests, plus `package.json`, the lockfile, `next.config.*` and `tsconfig.json`
against GitHub at the same SHA. A matching `robots.ts` beside a different
lockfile would be a different build.

This is deliberately **not** a Merkle tree over the repository. A full source
manifest digest is a real future capability; building one now would be
overengineering for a profile that supports one framework.

Files that cannot be compared — absent on one side, or past the read budget —
are recorded as unverified rather than silently counted as verified.

### 9. Provider errors must survive as diagnosis

Also learned by running it. Four runs failed with codes and no explanation,
because "never let raw provider prose escape" had been applied so widely that
the adapter replaced every error with a constant. A production failure could not
be attributed to the provider, the customer's code, or Vibe's own adapter.

The required chain is:

```
provider error → sanitized structured error → failure code → user-safe message
```

Never:

```
provider error → generic constant → generic constant → "something failed"
```

Users still never see raw provider output. Internally, name and message are kept
— bounded, ANSI-stripped and secret-redacted like any other untrusted text.
Refusing to *look* at untrusted data is a security property; being unable to
*find out* what happened is a blind spot wearing the same clothes.

### 10. One sandbox per validation, reconnected by a name we can recompute

A validation runs as several durable steps, each in its own function invocation
with no shared memory, and they must all work in the **same** sandbox: the
filesystem is the state, and `node_modules` has to survive from install to
build.

Something therefore has to carry the sandbox across a step boundary, and the
obvious candidates are all refused. A serialized provider handle or a capability
URL would put connection material — in the second case a bearer credential —
into a third-party durable log (CLAUDE.md rule 52). An opaque provider id would
be storage that has to be secured for no gain.

**The reconnect key is derived, not stored:** `sandboxNameFor(validationRunId)`
is a pure function of a row the database already holds, so nothing new is
persisted at all. Reconnection is `Sandbox.get({ name, resume: false })`, and
authorization comes from the provider credentials of the process doing the
reconnecting, exactly as it does at creation.

`resume` defaults to **true** and must be overridden. It restores a stopped
session, potentially from a snapshot, which would hand a later phase a
filesystem an earlier phase did not build. It joins `networkPolicy: allow-all`
and `persistent: true` as an SDK default that is actively wrong for this use
case.

### 11. A lost sandbox fails the run; it is never replaced

If no running sandbox answers to the name between phases, validation fails as
`sandbox_lost`.

It does not provision a replacement and continue. `Sandbox.getOrCreate` exists
and is precisely the wrong function here: it would return a fresh, empty VM, and
the remaining phases would report a verdict about a tree that never existed. A
wrong `passed` is worse than an honest failure.

Only `running` counts as usable. `pending`, `stopping` and `snapshotting` are
treated as gone, because a sandbox that is merely *becoming* available is not
the sandbox that installed the dependencies.

Checkpoint or snapshot recovery could lift this, and is deliberately not built:
it means persisting a customer's filesystem into provider storage, which is a
decision of its own and would have to be reconciled with §4 of ADR 0006.

### 12. Validation is not approval

`sandbox_validation_passed` means the profile's commands exited zero in an isolated VM. It does not mean safe, correct, secure, reviewed, or production ready. These remain separate gates:

```
repository_write_verified → sandbox_validation_passed → human_approved → merged → deployed
```

Only the first two exist.

## Consequences

### Positive

- ADR 0006's principle becomes testable: the ordering of credential removal and network closure is asserted against a recorded transcript, and mutation-checked.
- Validation runs as a durable operation, so a five-minute sandbox does not depend on a browser tab.
- Infrastructure spend is measured (`sandbox_usage_events`) separately from inference spend, so neither corrupts the other's unit economics.

### Negative / Tradeoffs

- **Real per-run cost**, metered on Active CPU, provisioned memory, creations and egress. Vercel exposes no attributable per-sandbox billed amount, so `provider_cost_usd` is null and the measured inputs are stored instead. We do not derive a figure from public rate cards and present it as accounting.
- **`--ignore-scripts` will fail some legitimate projects.** A repository that genuinely needs a postinstall step to build gets a false negative. Accepted deliberately: a false negative is a bad result, a supply-chain execution window during the networked step is a bad architecture.
- **Coverage is narrow.** One profile — single-app Next.js on npm or pnpm. Everything else is `validation_not_supported`, which is a statement about Vibe rather than about the customer's repository.
- **`iad1` only**, and Hobby plans cap runtime at 45 minutes with a monthly Active CPU allowance.
- **A sandbox outlives any single step, so the leak bound is the sandbox's own timeout.** Cleanup is a durable step and runs on every path, including one where a phase step was killed outright — but a workflow that dies entirely still leaves a VM to expire on its own. Bounded at 15 minutes, well below the provider maximum.
- **Sandbox loss between phases ends the run.** Correct, and a real cost: a long validation can be defeated by an infrastructure event that no repository caused, and the user's only recourse is to start again.

## Revisit when

- A second sandbox provider is genuinely needed (the abstraction exists; a second adapter does not).
- Preview environments arrive (Sprint 10B) and a validated artifact must actually *run* with an exposed port — a materially different exposure that needs its own decision.
- Customer environment variables become necessary for realistic builds, which will need a secrets-handling decision of its own and must not be solved by loosening §5.

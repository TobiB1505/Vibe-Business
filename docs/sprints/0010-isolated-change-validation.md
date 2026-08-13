# Sprint 10A — Isolated Change Validation

Status: **Complete.** A prepared change was validated in an isolated Firecracker
microVM: dependencies installed, types checked, 1331 tests run and the
application built — all with the GitHub credential gone and the network closed.
Seven runs were needed; the six failures were all Vibe's own defects and each is
recorded below.

Subsequently refactored into durable per-phase steps (**sandbox-policy-v3**) and
re-dogfooded: one sandbox spanning seven durable steps, every phase passing,
285 s end to end — work that no longer fits in a single orchestration budget and
completes anyway.
Branch: `feat/isolated-change-validation`

## Goal

Answer one question about an already-prepared change:

> Does this exact commit install, typecheck, test and build?

```
PreparedChange → ValidationRun → ephemeral microVM → checkout exact commit
  → verify integrity → destroy credential → close network → install → checks
  → bounded results → destroy sandbox → persist
```

The initiating browser request owns none of this. It runs as a durable
operation on the Sprint 7 foundation, like every other multi-minute job.

## Why sandboxing is now required

Sprint 9 ended with a distinction it could state but not act on:

```
repository_write_verified  the bytes on the branch are the bytes we meant
sandbox_validation_passed  those bytes install, typecheck, test and build
human_approved             someone looked at it
merged / deployed          neither exists
```

Only the first existed. Closing the second means running **code Vibe did not
write** — a repository's `package.json` scripts, its dependencies' tooling, its
framework's build. All of it is attacker-controlled from our point of view.

[ADR 0006](../decisions/0006-untrusted-repository-execution.md) fixed that
principle nine sprints ago and deliberately deferred the provider.
[ADR 0015](../decisions/0015-untrusted-repository-execution-provider.md) names
it.

## Vercel Sandbox decision

Firecracker microVM per validation, destroyed after. Chosen for specific
capabilities rather than convenience:

- **Runtime-mutable egress policy** — `Sandbox.create({ networkPolicy })` plus
  `sandbox.update({ networkPolicy })` lets dependencies be fetched under a
  narrow allowlist and the network closed *before* repository code runs, in one
  sandbox. Without live updates this would need open egress throughout, or two
  sandboxes.
- **`deny-all` blocks DNS**, not just traffic. An allowlist that still resolves
  arbitrary names leaves a covert channel over DNS itself.
- **Provider-side authenticated clone at an exact revision**, so the credential
  is handled at creation and never written into the sandbox by us.
- Already the hosting and workflow provider — no new vendor.

Two SDK defaults are actively wrong here and are overridden explicitly:
`networkPolicy` defaults to `allow-all`, and `persistent` defaults to `true`
(which would snapshot a customer's source into Vercel storage and hand the next
run a dirty tree). Both overrides are mutation-tested.

## Provider abstraction

`SandboxProvider` / `SandboxHandle` in `validation/sandbox-port.ts`. Only
`validation/vercel/` imports `@vercel/sandbox`.

Not portability theatre — two concrete jobs: the orchestrator is testable
without an account, a network or a bill; and the two-phase network transition is
expressed in the domain's vocabulary, so tests assert its *ordering* rather than
reading the source and hoping.

**There is no local implementation and there must never be one.** The tempting
shortcut — `if (!process.env.VERCEL) exec("pnpm build")` — is a remote code
execution vulnerability wearing a developer-experience costume. If the sandbox
is unavailable, validation fails. It does not degrade.

## Trust boundary

```
1. provision                 network: github only        no secrets in env
2. verify commit sha         our command, not theirs
3. verify file hashes        prepared artifact == sandbox artifact
4. destroy .git              the clone credential stops existing
5. narrow network            github revoked, registry only
6. install --ignore-scripts  the only networked step, no lifecycle hooks
7. deny all network          nothing can phone home from here on
8. typecheck / test / build  ← the first repository-controlled code
9. stop sandbox              on every path, including the ugly ones
```

Steps 2–5 all complete before anything the repository controls executes. By the
time `pnpm build` runs someone else's JavaScript, the GitHub credential is gone,
the network is closed, and the environment holds nothing of value.

`git rev-parse`, `rm -rf .git` and file reads are commands *Vibe* constructs.
They run inside the sandbox, but the sandbox is not yet running anything the
repository chose.

## Source acquisition and credential handling

A short-lived GitHub installation token is minted immediately before creation
and passed only as the clone credential — never into the sandbox environment,
where repository code could read it. Then `.git` is destroyed and its **absence
is verified**; a surviving credential store fails the run before any repository
command.

`github/installation-token.ts` is the one place a raw installation token leaves
the Octokit boundary, and it says why at length. **"The token is short-lived" is
explicitly not the boundary** — an hour is ample time to exfiltrate a
repository.

## No product secrets

The complete sandbox environment is `CI=1`, `NODE_ENV=production`,
`NEXT_TELEMETRY_DISABLED=1`. Absent by construction: Supabase service role,
Anthropic key, GitHub App private key, Browserbase key, Vercel management
tokens, customer production configuration.

A build that needs a secret fails with `build_failed_missing_environment` where
that is deterministically identifiable. Preview-safe environment configuration
is a later capability, not a reason to hand untrusted code a credential.

## Network policy

| Phase | Policy | Why |
| --- | --- | --- |
| Source acquisition | GitHub domains | Clone the exact commit |
| Dependency install | `registry.npmjs.org` and friends | The one networked step |
| Repository execution | `deny-all` | Nothing can phone home |

A repository whose build needs an unlisted host fails validation. **The global
policy is not widened to make one project pass.**

## Validation profile

One profile, `nextjs_node_v1`. Eligibility: Next.js detected, npm or pnpm,
unambiguous single-app workspace, lockfile present.

Refusing is the feature. A profile is a promise that *these exact commands, in
this exact environment, mean this exact thing*; supporting "most repositories"
turns that into a guess, and a green tick meaning "some commands exited zero" is
worse than no tick. Everything else is `validation_not_supported` — a statement
about Vibe's coverage, never about the customer's repository being wrong, and
the copy says so.

Monorepos are refused as `ambiguous_workspace`: not because they are hard, but
because "which app did we just validate?" has no single answer.

## Command policy

Commands are constructed from the profile, the package manager, and which
scripts genuinely exist in `package.json`. Never from an opportunity's title,
problem text, evidence, model output or client input.

Arguments stay a real array, never a shell string, so there is no interpolation
point even if a value were ever attacker-influenced. Repository scripts are run
*by name*; their contents stay inside the sandbox and never reach a Vibe
execution API.

No script is invented. A repository with no `test` script gets
`test: skipped (script_not_present)` — not `npm test`, which would exit non-zero
and report a failure the user cannot act on. A test script that *exists* and
fails is a real failure.

## Resource budgets

Versioned in `validation/budgets.ts`, calibrated against current Vercel limits
(45 min max on Hobby, 5 min default session, 2 vCPU default, `iad1` only):

| Budget | Value |
| --- | --- |
| Sandbox lifetime | 10 min |
| Install timeout | 5 min |
| Any single command | 4 min |
| Source acquisition | 90 s |
| Captured output per command | 64 KB |
| Stored output per step | 4 KB / 60 lines / 500 chars per line |

## Log safety

Build output is hostile input, in the same category as repository contents and
customer web pages. Storage strips ANSI and OSC sequences (OSC 8 can render text
that links somewhere else entirely), removes C0/C1 control characters including
`\x0d`, truncates single enormous lines, describes binary output rather than
storing it, and redacts secret-shaped values.

Only a bounded **tail** is kept — a build prints hundreds of progress lines and
then the reason it failed; keeping the beginning would reliably store the least
useful part.

The UI lands in 10B, but storage had to be safe now: a sanitizer added later
cannot clean rows written earlier.

## Idempotency

Validation identity is *(prepared change, commit sha, profile, profile version,
sandbox policy version)*.

The policy version is the interesting inclusion. "Validated" is a claim about
the commands that ran, the network they ran with, and the secrets they did not
have. Change the install flags or open the firewall during the build, and a
stored `passed` describes something that no longer happens. Tightening the
policy therefore invalidates prior results **by construction**, not by anyone
remembering to.

Only passes are reused. A previous failure is not a durable fact about the
artifact — the registry may have blipped — and refusing to re-run would strand
the user with a verdict they cannot retry.

A partial unique index enforces one live-or-passed run per identity, so a double
click loses its second insert instead of provisioning a second microVM.

## Cleanup

Every terminal path attempts teardown, including provider errors, timeouts, and
persistence failures. A failed stop is recorded as `stop_failed` for
observability and **never allowed to change the verdict** — a provider that
could not confirm teardown does not retroactively fail a passing build.

## Provider usage accounting

`sandbox_usage_events`, separate from `ai_usage_events`. Sandbox execution is
compute, not inference: it is metered on Active CPU, provisioned memory,
creations and egress, has no token concept, and mixing it in would corrupt every
cost-per-audit figure Sprint 4 built.

Recorded for passes and failures alike — a sandbox that provisioned and then
failed still cost money, and a ledger that only records successes systematically
understates unit economics.

`provider_cost_usd` is **null**. Vercel exposes no attributable per-sandbox
billed amount, and deriving one from public rate cards would be an estimate
wearing an accounting figure's clothes. The measured inputs are stored instead.

## Tests and mutation validation

1510 tests pass. 87 new to this sprint, all against fakes — `pnpm test` never
provisions a real sandbox (§39).

Forty-nine mutations, each verified to break tests:

| Mutation | Tests failed |
| --- | --- |
| deny-all before repository code removed | 2 |
| credential scrub removed | 19 |
| scrub verification removed | 1 |
| commit sha verification removed | 1 |
| file hash verification removed | 2 |
| secret added to sandbox environment | 3 |
| sandbox cleanup removed | 15 |
| `--ignore-scripts` removed | 8 |
| lockfile enforcement removed | 4 |
| missing test script invents `npm test` | 4 |
| policy version dropped from identity | 2 |
| failed validations become reusable | 1 |
| monorepo accepted as unambiguous | 1 |
| output bounding removed | 1 |
| ANSI/control stripping removed | 4 |
| secret redaction removed | 6 |
| `persistent: false` dropped | 1 |
| explicit network policy dropped | 2 |
| `deny-all` mapped to `allow-all` | 1 |
| exact revision replaced by a branch | 1 |
| a port exposed | 1 |
| sandbox name back to the identity | 2 |
| failure detail discarded | 4 |
| failure detail stored unsanitized | 1 |
| raw error object stored instead of name+message | 1 |
| relative working directory restored | 3 |
| diagnostic directory listing dropped | 1 |
| adapter replaces the provider error with a placeholder | 2 |
| raw thrown object serialized instead of name+message | 1 |
| workspace path prefix dropped | 1 |

The last five target the **adapter**, and exist because that seam has now cost
this project twice: a table name in Sprint 9, a CHECK constraint in the 9
post-dogfood pass. Both were paths every test faked. The SDK is mocked so the
assertion lands on the arguments Vercel would actually receive.

A real bug surfaced while writing the log tests: the control-character class
skipped `\x0d`, so carriage returns — the character a progress bar uses to
overwrite the line above it, and therefore the character that makes stored
output read differently from what was printed — survived sanitizing.

## What is NOT implemented

- **No dogfood.** No real sandbox has been provisioned. Blocked on the manual
  checkpoint below.
- **No preview**, no exposed ports, no `next dev`/`next start` (§43). That is
  10B, and the separation is what keeps the security boundary reviewable.
- **No merge, no deploy, no production approval.**
- No customer environment variables. No second sandbox provider. No sandbox
  reuse, snapshots or drives.

## Manual action required

Before any real sandbox run, one thing must be confirmed and possibly changed.
See the [final report](#) in the PR for the exact wording.

**Vercel Sandbox authentication.** In production on Vercel, the SDK uses an OIDC
token that Vercel issues and rotates automatically — provided **OIDC federation
is enabled for the project**. This project has never used Sandbox, so that
setting has not been exercised. It must be verified before a dogfood, and if it
is off, enabled in the Vercel project settings.

**Plan limits.** Sandbox on Hobby includes 5 Active-CPU hours and 5,000
creations per month, caps runtime at 45 minutes, and *pauses sandbox creation*
once exceeded. Our budgets sit well inside this, but the plan should be
confirmed rather than assumed.

Nothing else is needed: no environment variable is added to the application, and
the access-token method (`VERCEL_TOKEN` / `VERCEL_TEAM_ID` / `VERCEL_PROJECT_ID`)
is deliberately **not** used — it would mean storing a long-lived management
credential to avoid a setting toggle.

## First dogfood attempt — 2026-08-12

Two runs against the historical prepared change `2f05958`. Both failed. Recorded
in full because a failed dogfood is a successful dogfood (§42), and because what
it exposed is more useful than a green tick would have been.

| | Run 1 `a91c73df` | Run 2 `c8f004e9` |
| --- | --- | --- |
| Failure | `source_acquisition_failed` | `sandbox_unavailable` |
| Stage | `verifying_source` | `provisioning` |
| Sandbox | provisioned, runtime `node22` | never created |
| Duration | 3.9 s | 0.66 s |
| Active CPU | 2,129 ms | — |
| Network in / out | 834 KB / 17.7 KB | — |
| Cleanup | `stopped` | `not_provisioned` |

Total cost: about two seconds of Active CPU. Zero AI calls, zero GitHub writes,
`main` and the dogfood branch untouched.

### What held

The security properties did what they were built to do. Cleanup ran on both
paths, so no paid VM leaked. Run 1 refused at `verifying_source`, which means
**zero repository-controlled commands executed** — the run stopped before the
sandbox ran anything the repository chose, exactly as designed. The failures
were in the plumbing, not the boundary.

### Three defects, all introduced by this sprint

**1. Every retry was guaranteed to fail.** `sandboxNameFor` derived the sandbox
name from the validation *identity*, which is stable by design — that stability
is the whole point of reuse. Vercel requires unique sandbox names per project,
so run 2 collided with run 1's sandbox and `Sandbox.create` threw in 661 ms. The
name now comes from the validation **run id**: unique per attempt, still
traceable back to exactly one row.

**2. `git rev-parse HEAD` failed after a clone that transferred 834 KB.** The
clone is performed by the platform, outside the VM, so it succeeded; the
verification command did not. The image was pinned to `vercel/sandbox/node:24`,
a minimal image that may not carry `git` — and the sandbox reported its runtime
as `node22`, suggesting the pin did not take either. Now pinned to
`vercel/sandbox/universal`, the documented image that includes common utilities.

**3. The failures could not be diagnosed — the worst of the three.** The adapter
caught the provider error and returned a generic string; the orchestrator's
outer catch discarded the value entirely. Nothing reached the database or the
logs. "Never let raw provider prose escape" (rule 40, ADR 0011) had been applied
so widely that a production failure explained nothing.

`failure_detail` now records a bounded, ANSI-stripped, secret-redacted
explanation for failures that occur outside a validation step. Same sanitizer,
same limits as step output — it is untrusted text either way. The difference is
between *"we refuse to look"* and *"we cannot find out"*, and only the first is
a security property.

### Third attempt: the hypothesis was wrong

With `failure_detail` in place, the next run answered immediately:

```
git rev-parse HEAD exited 128
fatal: not a git repository (or any of the parent directories): .git
```

`git` was present and ran — defect 2's diagnosis was **wrong**. The image was
never the problem. There is simply no `.git` where the command executed, which
leaves two possibilities the run still could not separate:

- the platform materializes the tree at the requested revision *without* a
  `.git` directory, or
- the command ran somewhere other than where the source landed.

Rather than guess a third time, two changes make the run answer it. Every path
is now absolute against the documented working directory `/vercel/sandbox`
instead of a relative `cwd: "."`, removing the second possibility outright; and
a failed source verification now lists the directory it looked in. `ls` is
Vibe's own command with bounded output — no repository code runs, and the
listing is a diagnostic, not a licence.

The fake sandbox models the same working directory, because a fake that accepted
bare relative paths would pass while production failed. That is the specific
trap this sprint has now hit twice.

### Fourth attempt: the ambiguity is settled

The absolute-path experiment failed differently:

```
git rev-parse HEAD exited 1 in /vercel/sandbox
[command could not be executed]
```

`[command could not be executed]` was this codebase's own placeholder — the
adapter's catch block. Absolute addressing made `runCommand` throw, where the
relative form had executed and produced a real `git` error.

Two things follow. The provider wants **relative** paths, so addressing is back
to relative. And the ambiguity the experiment existed to resolve is resolved by
its own failure: the earlier `fatal: not a git repository` came from the correct
directory. **The checkout genuinely has no `.git`.**

The more useful lesson is the placeholder. `failure_detail` had taught the
orchestrator to explain itself, and the layer below it was still replacing the
one fact that mattered with a constant — the same defect, one level down from
where it was fixed. Provider errors now carry their name and message through
(never the object, which can hold request context and credentials).

That gap also survived its first mutation: the test asserting error
pass-through exercised the *fake* provider, not the adapter. A test that cannot
fail is worse than no test, so the assertion moved to the adapter's own suite
against a mocked SDK, and the mutation now fails.

### Sixth attempt: the clone is in a subdirectory

The directory listing settled everything:

```
/vercel/sandbox/
  .cache .codex .config .global .local .npm .npmrc .sudo_as_admin_successful
  Vibe-Business        ← the repository
```

Vercel clones into `/vercel/sandbox/<repo>/`. Every command had been running in
the sandbox home, where `fatal: not a git repository` was a perfectly accurate
message about a directory that is not a repository.

**The conclusion drawn from it was wrong.** "There is no `.git`" was reported as
a finding when it was still a hypothesis, and a design decision was taken on it.
The right move would have been to list the directory the first time the question
came up rather than the fourth.

The correction is small and the Option A machinery all stays. `sourceRoot` comes
from the repository name in server state — never guessed inside the sandbox —
and `git rev-parse` returns, because the provider-side clone leaves a real
checkout and observing it costs nothing: Vercel did the clone, so no credential
enters the VM.

What has *not* changed is the rejection of a self-managed clone. That reasoning
was about carrying a token into a VM that later runs untrusted code, and it
stands regardless of where the checkout lives.

### Seventh attempt: two addressing schemes, not one

The run got materially further, and the record proves it:

```
gitCommitObserved:           true       ← matched the prepared SHA
changedFilesVerified:        true       ← robots.ts and sitemap.ts hashed correctly
buildIdentityFilesUnverified: [package.json, pnpm-lock.yaml, next.config.ts, tsconfig.json]
failure:                     credential_scrub_failed
```

Commit observation and prepared-file verification both worked. Two path bugs
remained, and this run's data pinned both exactly — which is what the
diagnosability work was for.

The cause is an asymmetry that deserved a name earlier:

| Consumer | Addresses from | Example |
| --- | --- | --- |
| `readFile` | the sandbox home | `Vibe-Business/package.json` |
| a command | its own `cwd` | `package.json` |
| GitHub | the repository root | `package.json` |

One helper served all three, so commands and GitHub were both handed the clone
directory they must not have. The GitHub half failed loudly — every
build-identity file came back unverified. The command half failed **silently**:
`rm -rf Vibe-Business/.git` executed from inside `Vibe-Business` targets a path
that does not exist, and `-f` calls that success. The scrub reported done, the
real `.git` survived, and `credential_scrub_failed` fired — correctly.

That silent failure is the more instructive one, and it is exactly the case the
verification exists to catch. The check worked. `inSandbox` and `inRepository`
are now separate functions with the reason written next to them, and the fake
sandbox resolves `rm` against the command's `cwd` like a real shell, because a
fake that ignored `cwd` would have hidden it.

### Decision: Option A — pin and hash, plus observe where possible

Confirmed and adopted. `git rev-parse` is removed as a source-integrity
condition. The reasoning and the exact wording of the narrowed claim live in
[ADR 0015 §8](../decisions/0015-untrusted-repository-execution-provider.md).

The documentation changed from:

> Exact commit independently verified through `.git`.

to:

> The PreparedChange commit is pinned as an immutable provider source revision.
> Because Vercel's materialized repository source does not expose Git metadata
> in the sandbox, Vibe does not independently re-observe the commit through Git.
> Instead, it independently verifies the prepared-change file hashes — and the
> build-identity files against GitHub at that same commit — before any
> repository-controlled command executes.

`rm -rf .git` and its absence check are **kept** as defence in depth. On this
provider there is nothing to remove, but that is a fact about this provider and
image rather than a guarantee, and a future provider that does leave a checkout
would put a credential-bearing remote on disk.

The obsolete `source_acquisition_failed` code was removed rather than left
unreachable.

### The original note, retained

If the tree genuinely arrives without `.git`, §6's independent SHA check cannot
be satisfied by `git rev-parse` and the design needs revisiting rather than
patching: pinning an immutable commit SHA at creation already removes the
"HEAD moved" failure the check exists to catch, and prepared-file hash
verification (§29) already proves the artifact's own bytes. That would be a
deliberate change to what verification means, recorded here — not a silent
fallback triggered by an error string.

### One product defect too

The panel flickered and returned to "Not validated" instead of showing the
failure: `summary` is rendered on the server and never refetched when polling
ended. From the outside, a run that failed looked like a run that never
happened. It now refreshes on terminal state.

## The passing run — 2026-08-13

```
validation run  61b8c9f1-1803-4c02-9f32-903a231dd2a5     passed
operation       eff43f82-a578-40c5-a3fc-c2e8af52e301     completed
prepared change 3480ad0a  →  commit 2f05958  on  vibe/seo-foundations-cc32273131c5
profile         nextjs_node_v1 / nextjs-node-v1
policy          sandbox-policy-v1
provider        vercel_sandbox   runtime node22   pnpm
```

### Source integrity, as actually established

```
revisionMode                 provider_pinned
gitCommitObserved            true      ← matched the prepared SHA
changedFilesVerified         true      ← robots.ts + sitemap.ts hashed
buildIdentityFilesVerified   package.json, next.config.ts, tsconfig.json
buildIdentityFilesUnverified pnpm-lock.yaml            (see below)
```

### Steps

| Step | Result | Duration |
| --- | --- | --- |
| `pnpm install --frozen-lockfile --ignore-scripts` | passed | 18.4 s |
| `pnpm run typecheck` | passed | 79.1 s |
| `pnpm run test` | passed — **1331 tests, 77 files** | 83.9 s |
| `pnpm run build` | passed — Next.js 16.3.0, 14 static pages | 99.3 s |

Total sandbox lifetime **288 s**, operation **297 s**, cleanup `stopped`.

The build output is the most satisfying line in this sprint:

```
├ ○ /robots.txt
└ ○ /sitemap.xml
```

The change Vibe prepared in Sprint 9 produces routes that actually build. That
is a fact about the artifact, established by running it — not inferred from a
hash.

### Cost

| Metric | Measured |
| --- | --- |
| Active CPU | 116,182 ms |
| Provisioned memory | 4 GB × 288 s |
| Network in / out | 332 MB / 1.7 MB |
| `provider_cost_usd` | **null** |

At published Pro rates this is roughly **$0.011** — about one cent. That figure
is *not* stored: Vercel exposes no attributable per-sandbox amount, and a
rate-card derivation presented as accounting would be an estimate in a ledger's
clothing. The measured inputs are what the row contains.

Across all seven runs: 127 s of Active CPU total. Zero AI calls, zero repository
writes, `main` and the dogfood branch untouched throughout.

### Why it takes five minutes

Nearly all of it is real work: 79 s of typecheck, 84 s running the customer's
own 1331-test suite, 99 s of production build, on 2 vCPU with no build cache and
a cold dependency store. A validation that finished in ten seconds would not
have validated much.

This is exactly the case the durable-operation foundation exists for. The
initiating request owns none of it, the panel says *"You can leave this page"*,
and the verdict is in the database when the user returns. Reducing it later is a
real option — more vCPUs, a warm store, a snapshot — and each trades money or
isolation for time, which is a decision rather than a default.

### The gap it exposed

`pnpm-lock.yaml` came back **unverified**: this repository's lockfile is ~310 KB
against a 256 KB read budget. That is the one build-identity file that decides
*which code gets installed*, so a budget silently excluding it was the wrong
budget. Build-identity files now have their own 4 MB budget.

Fixing it surfaced a latent bug worth more than the gap. The adapter truncates
at the byte budget, so hashing a truncated prefix against a whole file would
have reported a **content mismatch for a file that is merely large** — a false
integrity failure, which is the worst kind because it is indistinguishable from
a real one. Reads now request one byte past the budget, and "too large" is
recorded as unverified rather than compared.

## Reconciling `gitCommitObserved`

The passing run recorded `gitCommitObserved: true`, which looks inconsistent
with the Option A decision to stop re-observing the commit. It is not. The
record is correct, and the confusion is the residue of a wrong report of mine.

Evidence, in order:

| Source | Finding |
| --- | --- |
| `orchestrator.ts` | `git rev-parse HEAD` **is** in the implementation |
| `git log -S"rev-parse"` | removed in `b4f5573` (Option A), **restored in `e10b66b`** |
| `orchestrator.ts` | `gitCommitObserved: observedCommit !== null`, and `observedCommit` requires exit 0 *and* non-empty output |
| `orchestrator.ts` | a mismatch fails the run — the run **passed**, so `rev-parse` returned exactly `2f05958e…` |
| `validation_runs` | only the two runs created *after* `e10b66b` deployed carry `source_integrity`; the five earlier rows are `null` |

`e10b66b` is where the directory listing proved the checkout exists at
`/vercel/sandbox/<repo>/`. The earlier claim that the materialized source has no
`.git` was an inference from a `git` error raised in the sandbox *home*
directory, and it was wrong.

So the observation is real, and **no credential is involved**: Vercel performs
the clone provider-side, so nothing is passed into the VM. Setting the field to
`false` would record a falsehood. It stays `true`, and the field is now covered
by tests asserting it is false when git cannot answer, false when git answers
with nothing, and absent entirely when no sandbox was provisioned.

What has *not* changed is the rejection of a self-managed clone. That decision
was about carrying an installation token into a VM that later runs untrusted
code, and it stands regardless of where the checkout lives.

## Integrity policy v1 → v2

The first passing run is historically a **v1** result and stays one. Its
`pnpm-lock.yaml` was unverified, so "validated" under v1 meant something
materially weaker than it appeared — the lockfile is the file that decides which
code gets installed.

Two integrity rules changed: build-identity files get a dedicated 4 MB budget,
and reads request one byte past the budget so an oversized file is recorded as
unverified rather than hashed as a truncated prefix. The command profile did not
change, so `nextjs_node_v1` stays as it is; this is a security/integrity change,
which is what `sandbox-policy-*` versions exist for.

Because the policy version is part of the validation identity, run `61b8c9f1`
cannot be reused under v2 — by construction, not by anyone remembering. No
historical row was rewritten.

**No migration was required, and that was verified rather than assumed.** The
live constraint on `validation_runs.sandbox_policy_version` is
`CHECK (char_length(btrim(sandbox_policy_version)) > 0)` with zero enum-like
constraints. Sprint 9 shipped a capability bump against a column that *did*
carry an enum CHECK, and every test passed while every real run would have
failed at INSERT; that is why the live schema is now read before this claim is
made.

## The step ceiling — a budget calibrated against the wrong limit

The first v2 run reached `building` and was then killed:

```
01:36:38  Vercel Runtime Timeout Error: Task timed out after 300 seconds
01:45:44  [Workflow] Step exceeded max retries — executeValidation
```

A Vercel Function is capped at 300 s. The v1 pass measured 288 s of commands and
squeaked under it; the v2 run did not. That margin was never a margin.

The defect is in the budgets. `totalLifetimeMs` was 600 s — calibrated against
the *sandbox's* limit, which is 45 minutes, while the function awaiting it could
live 300 s. **Two different limits, and the smaller one binds.**

The second consequence is worse than the timeout. A killed step runs no cleanup,
so the sandbox stayed alive on its own timer with nothing responsible for it.
Every cleanup guarantee in this sprint lives inside `runValidation`, and none of
it survives the process being killed.

Three changes, in order of importance:

1. **The sandbox lifetime is now below the step ceiling** (260 s vs 300 s). If
   the step is killed anyway, the sandbox's own timeout is the only thing left
   stopping a paid VM, so it has to be short enough to matter.
2. **The run watches its own clock.** Before each command it checks the time
   remaining and ends itself — with cleanup — rather than starting work it
   cannot finish. Every command timeout is clamped to the time actually left.
   Being killed is not an acceptable way to finish something that owns
   infrastructure.
3. **Four vCPUs instead of two.** Not a performance preference: 281 s of
   measured work against a 300 s ceiling is not a margin. More vCPUs cost more
   per second and finish sooner, so the bill is roughly unchanged. Four is the
   Hobby maximum, so this is the whole of the available headroom.

If the work still does not fit, the answer is to split it across steps or move
to a plan with a longer function limit — a decision, not a larger number.

## The durable-phase refactor — sandbox policy v3

The sentence above turned out to be the specification for the next piece of
work. The work did not fit, and the answer taken is the first one: **split it
across steps.**

### Why the coarse execution had to go

The single-step design was not merely slow to the limit. It failed in the one
way a design must not:

> The step was killed at the platform ceiling, and **because it was killed, its
> cleanup never ran.** Every teardown guarantee in this sprint lived inside the
> function that was killed.

So the guarantee held for exactly the failures the function survived, which is
the wrong set. A paid microVM stayed alive on its own timer with nothing
responsible for it. Adding vCPUs and shortening the sandbox lifetime bought
margin against the symptom and changed nothing about the shape.

The second problem was product-visible. `steps` was written once, at the end,
so for five minutes the panel could say only "validating…", and a run that died
mid-pipeline recorded nothing about the phases that had already passed.

### The step graph

```
prepare ─▶ provision ─▶ verify ─▶ install ─▶ typecheck ─▶ test ─▶ build
               │           │         │           │          │       │
               └───────────┴─────────┴───────────┴──────────┴───────┘
                                     ▼
                                  cleanup ─▶ finalize ─▶ complete / abort
```

Nine steps where there were three. The security sequence inside them is
unchanged — pin, hash, scrub, narrow, install, close, run — and the ADR 0015
trust boundary is untouched.

**Verified against the SDK's own shipped documentation for the installed
version, not recalled:** on Vercel the Workflow SDK deploys step execution as
its own queue-consumer function with `maxDuration: max`, while the orchestrating
workflow function is short-lived (`maxDuration: 60`) and suspended between
steps. Each phase therefore gets a fresh invocation and a fresh ceiling. The
measured baseline — install 18.4 s, typecheck 79.1 s, test 83.9 s, build 99.3 s —
now sits four phases wide instead of stacked against one limit.

### One sandbox, reconnected by name

The filesystem *is* the state: `node_modules` must survive from install to
build. So one ValidationRun creates exactly one sandbox, and every later phase
reconnects to it.

What crosses the step boundary to make that possible is the interesting part,
because the tempting options are all wrong:

| Option | Why not |
| --- | --- |
| a serialized provider handle | puts connection material in a third-party durable log |
| a capability URL | a bearer credential, in that same log |
| an opaque provider id | storage that has to be secured, for no gain |

What is used instead is **`sandboxNameFor(validationRunId)`** — a pure function
of a row the database already holds. Nothing new is persisted at all: not a
token, not a URL, not an id. The reconnect key is recomputed, and authorization
comes from the provider credentials of the process doing the reconnecting,
exactly as it does at creation (§3, CLAUDE.md rule 52).

`Sandbox.get({ name, resume: false })` is the SDK call. `resume` defaults to
**true** — a third default that is actively wrong here, alongside
`networkPolicy: allow-all` and `persistent: true`. It restores a stopped
session, potentially from a snapshot, which would hand the next phase a
filesystem the previous phase did not build. The status check that follows is
not redundant with it: `resume: false` states the intent to the provider, and
the assertion holds even if a future SDK version reinterprets it.

### Sandbox loss is a refusal, never a replacement

If the sandbox is gone between phases, the run fails as `sandbox_lost`.

It does **not** provision a replacement and continue. `Sandbox.getOrCreate`
exists and is exactly the wrong function: it would hand back a fresh, empty VM,
and the build would then be answering a question about a tree that never
existed. Only `running` counts as usable — `pending`, `stopping` and
`snapshotting` are all treated as gone, because a sandbox that is merely
*becoming* available is not the sandbox that installed the dependencies.

The copy says what was lost rather than only that something was, since
"the environment disappeared" invites the reasonable question *"so start another
one?"*.

### Re-entry, not retry

`maxRetries = 0` on every sandbox-touching step. A platform retry cannot
distinguish "the command never started" from "the command ran and its result was
lost", and for repository-controlled commands that ambiguity must resolve to
*not running it again*.

Recovery comes from persisted state instead, which is a stronger guarantee
because it holds regardless of how the previous attempt died: each phase reads
the ValidationRun row first, and a phase with a recorded result is finished.

| Step | Retries | Why |
| --- | --- | --- |
| `prepare` | default | a pure claim, guarded by a unique index |
| `provision` | **0** | billable and ambiguous; a retry buys a second microVM |
| `verify` | **0** | idempotent, but a retry cannot assume the sandbox it needs |
| `install` · `typecheck` · `test` · `build` | **0** | repository-controlled; re-running a red suite to see if it fails differently is a coin toss |
| `cleanup` | default | idempotent, and "already gone" is a success — a duplicate stop costs nothing, a leaked VM costs money for as long as it lives |
| `finalize` | default | scoped to `status = 'running'`; a replay writes nothing |

### Fail-fast, and cleanup that cannot be skipped

Order: source → install → typecheck → test → build. The first required failure
ends the run, and nothing downstream is attempted — there is nothing to learn
from building a change whose types do not check, and a sandbox minute spent
learning it is billed.

Cleanup runs **unconditionally**, including after the catch, and deliberately
*before* result collection rather than after it. Once the last phase returns the
sandbox has no remaining purpose, and nothing about deciding a verdict should be
able to keep a paid VM alive. Cleanup that depends on the correctness of
result-collection logic is cleanup with a condition attached.

The failure is carried in a local rather than by returning early, because an
early `return` inside the try block is precisely the shape that leaked a VM the
first time.

### `deny-all`, re-asserted per phase

Under the single-step design the closed network was three lines above the build
command. Across durable steps that would be an assumption about a previous
function invocation — and an assumption is not a control. Each
repository-controlled phase now closes the network itself before running
anything: idempotent, cheap, and locally true.

The install phase still owns the whole networked window, and closes it *before
returning* whatever the install did. A persisted `install: passed` therefore
implies the network was closed — the security property is carried by the
recorded state rather than by a later step remembering.

### Progress the user can actually read

Each phase is written to `validation_runs` as it completes, so the panel renders
six named phases with real elapsed seconds:

```
Validation
  ✓ Source integrity
  ✓ Dependencies        18.4s
  ✓ Typecheck           79.1s
  ● Running tests…
  ○ Production build
  ○ Finalizing
```

Derived by one pure function from persisted state — status, stage, steps,
source integrity, failure code. Deliberately **not** from the workflow's
internal step index, which is a third-party execution detail and would report
progress for work whose result was never recorded. No percentage: the phases
have wildly different durations and any number would be invented.

A failure names the phase it stopped at and marks the rest `not_run` rather than
leaving empty circles that read as "still to come" on a run that is over.

### Timeouts

| Budget | Value | Rationale |
| --- | --- | --- |
| step ceiling | 300 s | platform, not ours; every command budget must fit inside it |
| install / command | 240 s | 2.4× the longest measured command, leaving 60 s for the phase to persist its result |
| source | 90 s | several small commands, none of them repository code |
| sandbox lifetime | 900 s | must *outlive* any one step, because it spans all of them |

The sandbox lifetime is the inversion of the v2 rule: v2 required the sandbox to
die *before* the step, because a killed step ran no cleanup. v3 requires it to
survive *between* steps, and buys the old protection back structurally — cleanup
is its own step and runs on the paths that previously ran nothing.

The leak bound is therefore looser (900 s vs 260 s) while the expected leak is
smaller. It stays far below the provider's 45-minute maximum: a run needing
longer than fifteen minutes is telling us something about the repository, and
the honest answer is to stop and say so.

Four vCPUs are kept, and the justification is rewritten rather than left stale.
It was introduced as a *correctness* requirement against the single ceiling;
that argument no longer holds. Re-tuning resources is deliberate work with a
re-measurement attached, not a number to quietly lower during a refactor.

### Why the policy version had to move

`sandbox-policy-v2 → v3`. The commands did not change; what "validated" *means*
did.

Under v2 a repository whose real work exceeded one function ceiling could only
ever record `sandbox_timeout` — a verdict about our orchestration, not about the
artifact. **A run that was terminally timed-out under v2 can legitimately pass
under v3.** That is the exact condition for a bump: otherwise a stored `failed`
and a fresh `passed` would disagree about the same artifact with no recorded
reason.

No historical row was rewritten, and no v2 result is reused to answer a v3
question — the version is part of the validation identity, so that follows by
construction.

### No migration was required, and this time it was proved

The Sprint 9 lesson applied properly. The stages this refactor writes —
`cleaning_up` in particular, now written by a step of its own — go into
`operation_runs.stage`, which **does** carry an enumerated CHECK. That is the
constraint that would have failed silently at INSERT while every test passed.

It already permits all of them, and `finalizing` was deliberately not invented:
`collecting_results` exists in both the type union and the constraint and means
the same thing. `sandbox_policy_version` and `failure_code` carry no enumerated
CHECK, so the version bump and the new `sandbox_lost` code need no DDL.

None of that is asserted from memory. `schema.test.ts` parses the migrations and
fails if the code can write a stage the SQL rejects, or if either column ever
gains an enumerated constraint.

### Tests and mutation validation

1518 → **1645 tests**. Every existing security assertion was kept and now runs
*through* the step boundaries: the orchestrator suite drives the real phase
functions through the real `reconnect` path, so a phase that forgot to
reconnect, or quietly created a second sandbox, fails there.

Twenty mutations, every one verified to break tests — including two that
**survived** first:

| Mutation | Result |
| --- | --- |
| re-entry guard removed (install/typecheck/test/build) | 5 tests fail |
| a replacement sandbox is created mid-run | 4 fail |
| build no longer required for a pass | 2 fail |
| cleanup skipped after an intermediate failure | 2 fail |
| adapter treats a non-running sandbox as usable | 5 fail |
| UI collapses every phase to one generic state | 31 fail |
| fail-fast removed — downstream phases still run | 5 fail |
| `deny-all` not re-asserted per phase | 1 fail |
| adapter resumes a stopped session | 1 fail |
| phase result not persisted as it completes | 12 fail |
| clone credential minted for every phase | 1 fail |
| source re-verified on re-entry | 1 fail |
| provision replays into a second sandbox | 1 fail |
| provision does not adopt an existing sandbox | 1 fail |
| cleanup reports success without stopping anything | 18 fail |
| **policy version left at v2** | **survived → test added → 1 fail** |
| **terminal-replay guard removed from finalize** | **survived → test added → 1 fail** |

The first survivor was the important one, and it is the rule this sprint had
been enforcing by memory for three versions. Nothing failed when the version was
left behind — so every real run would have reused a v2 pass to answer a v3
question and reported an old verdict as a current one.

It cannot be fixed by pinning the version to a literal; that makes every
legitimate bump look like a regression, which is why the earlier test
deliberately asserted against the constant. What *can* be pinned is the
relationship: the version against a **digest of the policy it names** — budgets,
resources, network host lists, install flags. Changing the policy without the
version now fails, and so does the reverse. Updating both is a deliberate act,
which is the point.

The second survivor was covered by the database rather than by the code: the
terminal write is scoped to `status = 'running'`, so a replay writes nothing.
What the database does not protect is the value the step *returns* — a finalize
retried after a transient throw would have reported failure for a run recorded
as passed, completing the operation as failed while its result said otherwise.

### One hole found by reviewing the re-entry story

Writing the retry policy down surfaced a defect the tests did not yet cover.
The sandbox name is deterministic per attempt, so a provision step that created
the sandbox and *then* died — killed, redeployed, or failed while returning —
leaves a live sandbox whose name `Sandbox.create` will refuse. The retry would
report `sandbox_unavailable`: a run doomed by its own successful provisioning.

Nearly the same failure cost a real dogfood run earlier in this sprint, when the
name was derived from the validation identity rather than the attempt.

Provisioning now reconnects first and adopts an existing sandbox. It is only
reachable when no phase has run yet — the step refuses to re-provision once any
phase state exists — so adoption can never resume onto a filesystem a later
phase already depended on.

### What did not change

The trust boundary, the command profile, the network phases, the credential
lifecycle, `--ignore-scripts`, the single supported profile, and the rule that
there is no local execution path. This is an orchestration refactor; validation
is not weakened anywhere. The build remains a required gate — a skipped build is
never a pass, asserted in both the domain and the finalize step.

### The v3 dogfood — 2026-08-13, passed first time

One validation of the existing prepared change, run from the deployed product.
No repository write, no second branch, no AI call.

```
validation run  33923863-5853-4aa4-ac27-7ffef2e08c17     passed
operation       e271cb55-87de-46c4-84cb-54d52acf4cf4     completed
prepared change commit 2f05958  on  vibe/seo-foundations-cc32273131c5
profile         nextjs_node_v1 / nextjs-node-v1
policy          sandbox-policy-v3
provider        vercel_sandbox   runtime node22   pnpm
cleanup         stopped
```

| Phase | Result | Duration |
| --- | --- | --- |
| Source integrity | verified | — |
| `pnpm install --frozen-lockfile --ignore-scripts` | passed | 11.5 s |
| `pnpm run typecheck` | passed | 78.5 s |
| `pnpm run test` | passed | 76.3 s |
| `pnpm run build` | passed | 89.9 s |
| Finalizing | completed | — |

Commands total **256.3 s**; sandbox lifetime 283.9 s; operation 284.9 s.

### What the run proves that the tests could not

- **One sandbox spanned seven durable steps.** Provision, verify, four phases
  and cleanup each ran in their own function invocation, reconnecting by name,
  and the build ran against the `node_modules` the install created. Exactly one
  `sandbox_usage_events` row for the run.
- **No phase was repeated.** Four phases, four recorded results, one of each.
- **The work now exceeds a single 300 s orchestration budget and completes
  anyway.** 256 s of commands plus provisioning, verification and finalization
  came to 285 s end to end — which is the case v2 could not express.
- **Cleanup ran on the success path**, `cleanup_status = stopped`.
- **Zero AI calls** during the run, as designed: the execution is deterministic.

Source integrity, in full, and better than the first passing run:

```
revisionMode                 provider_pinned
gitCommitObserved            true
changedFilesVerified         true
buildIdentityFilesVerified   package.json, pnpm-lock.yaml, next.config.ts, tsconfig.json
buildIdentityFilesUnverified (none)
```

The v1 pass recorded `pnpm-lock.yaml` as **unverified** — the one file that
decides which code gets installed. The v2 integrity fix is now confirmed on real
data rather than in a unit test: all four build-identity files hashed against
GitHub at the pinned commit, nothing skipped.

### The failure this replaced, now diagnosed

The refactor was undertaken on a hypothesis. The database settles it: the run
that failed before this work was `84fff40a`, under **sandbox-policy-v2**, and it
failed at stage `building` with `sandbox_timeout` after 242.2 s — the v2
self-abort clock (`stopStartingWorkAfterMs`, 240 s) firing before the build
could finish.

So the diagnosis was right, and worth stating precisely: **that run did not
crash. It worked exactly as v2 designed it to.** The sandbox was stopped
cleanly, nothing leaked, and the honest outcome was still *no verdict about the
artifact* — the ceiling was reported as a property of the change. That is what
v3 removes.

The run before it, `fb4e0865`, is the other half of the argument:
`validation_run_failed`, *"the validation step ended without recording a
result"*, `cleanup_status = not_provisioned`, 550 s elapsed. That is the killed
step — no cleanup, no phase results, nothing to diagnose from.

| Run | Policy | Outcome | Sandbox | Active CPU |
| --- | --- | --- | --- | --- |
| `fb4e0865` | v2 | killed at the ceiling, no result recorded | not stopped by us | — |
| `84fff40a` | v2 | `sandbox_timeout` at `building` | stopped, 242.2 s | 85.3 s |
| `33923863` | **v3** | **passed** | stopped, 283.9 s | 124.5 s |

### What four vCPUs actually bought

Both passing runs validated the same commit, so they compare directly. The v1
pass ran on two vCPUs, the v3 pass on four:

| Phase | 2 vCPU (v1) | 4 vCPU (v3) | Change |
| --- | --- | --- | --- |
| install | 18.4 s | 11.5 s | −37 % |
| typecheck | 79.1 s | 78.5 s | **−0.8 %** |
| test | 83.9 s | 76.3 s | −9 % |
| build | 99.3 s | 89.9 s | −9 % |
| **commands total** | 280.7 s | 256.3 s | −9 % |

`tsc` did not get faster at all, which is the single-core reasoning confirmed by
measurement rather than asserted — and it was the second-largest phase.

One claim from the v2 record needs correcting. "More vCPUs cost more per second
and finish sooner, so the bill is roughly unchanged" is not quite what happened:
Active CPU rose from 116.2 s to 124.5 s, about 7 %, while wall time fell 2 %.
Vercel meters Active CPU, so four vCPUs are modestly *more* expensive here, not
neutral. Small in absolute terms — roughly a cent either way — but the record
should say what was measured rather than what was predicted.

Since the correctness argument for four vCPUs is gone under v3 and the measured
benefit is a 9 % wall-clock saving for a 7 % CPU premium, dropping back to two is
now a legitimate open question rather than a regression. Deliberately not
changed in this refactor.

## Known limitations

- `--ignore-scripts` will fail repositories that genuinely need a postinstall
  step to build. A deliberate false negative: a bad result beats a supply-chain
  execution window during the networked step.
- Coverage is one profile. Everything else refuses.
- `provider_cost_usd` is always null; only measured inputs are stored.
- Creating a sandbox is billable even when validation refuses immediately after
  provisioning. Everything checkable *before* provisioning is checked first.
- A passing validation says nothing about product quality. The first prepared
  change was byte-perfect, would have built cleanly, and still listed `/login`
  in a sitemap.
- Sandbox loss between phases ends the run. Checkpoint or snapshot recovery
  would let it resume, and is deliberately not built: it means persisting a
  customer's filesystem into provider storage, which is a decision of its own.
- The leak bound rose from 260 s to 15 minutes. Cleanup is now a durable step
  and runs on paths that previously ran none, so the expected leak is smaller —
  but a workflow that dies outright still leaves a sandbox to its own timeout.

## Next step

Sprint 10A is finished: the durable-phase refactor is built, mutation-validated
and dogfooded green, and PR #25 has nothing left blocking it.

What is *not* finished is the honest limit this sprint has restated at every
stage. `sandbox_validation_passed` means the profile's commands exited zero in
an isolated VM. The change it just validated is still the one that lists only
`/` in a sitemap because a human reviewed the v1 output and said so — no part of
this pipeline judged that, and none of it would have.

Sprint 10B is preview, and the separation was deliberate: exposing
a port serves unvalidated customer code on a public URL, which is a materially
different exposure that deserves its own decision rather than momentum.

Worth carrying forward from this sprint's seven runs: **six of the failures were
found only by running it.** Every one passed lint, typecheck, build and the full
test suite first. The pattern is now unmistakable across three sprints — the
seams that make a domain testable are the seams nothing exercises, and a real
run is the only thing that touches them.

### The original plan, retained

The dogfood, once the manual checkpoint clears: validate the historical prepared
change `2f05958` on `vibe/seo-foundations-cc32273131c5`. That branch must not be
merged, modified or regenerated — validation is artifact-centric, so validating
it is legitimate even though newer repository intelligence exists.

A **failed** validation is a successful Sprint 10A dogfood result. One run is the
baseline; it is not tuned until green.

# Sprint 10A — Isolated Change Validation

Status: **Complete.** A prepared change was validated in an isolated Firecracker
microVM: dependencies installed, types checked, 1331 tests run and the
application built — all with the GitHub credential gone and the network closed.
Seven runs were needed; the six failures were all Vibe's own defects and each is
recorded below.
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

Forty-three mutations, each verified to break tests:

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

## Next step

Not decided. Sprint 10B is preview, and the separation was deliberate: exposing
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

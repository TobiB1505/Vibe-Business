# Sprint 10A — Isolated Change Validation

Status: **Implemented; first dogfood attempted and failed, defects fixed, second
attempt pending.** Two real sandboxes were provisioned. Both runs failed, for
three reasons that were all mine — see
[First dogfood attempt](#first-dogfood-attempt--2026-08-12).
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

Twenty-five mutations, each verified to break tests:

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

Defect 2 remains a hypothesis rather than a finding. It is stated as one, and
the next failure will carry its own explanation.

### One product defect too

The panel flickered and returned to "Not validated" instead of showing the
failure: `summary` is rendered on the server and never refetched when polling
ended. From the outside, a run that failed looked like a run that never
happened. It now refreshes on terminal state.

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

The dogfood, once the manual checkpoint clears: validate the historical prepared
change `2f05958` on `vibe/seo-foundations-cc32273131c5`. That branch must not be
merged, modified or regenerated — validation is artifact-centric, so validating
it is legitimate even though newer repository intelligence exists.

A **failed** validation is a successful Sprint 10A dogfood result. One run is the
baseline; it is not tuned until green.

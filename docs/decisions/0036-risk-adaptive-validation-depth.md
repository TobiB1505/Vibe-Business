# ADR 0036 — Risk-Adaptive Independent Validation Depth

- **Status:** Accepted
- **Date:** 2026-08-20
- **Extends:** Rule 65 (validation semantics must be versioned) with a second versioned axis
- **Does not alter:** Rule 66 (a successful validation authorizes nothing)
- **Sprint:** [0047](../sprints/0047-risk-adaptive-validation.md)

## Context

Independent Validation has always run the same four steps — `install`,
`typecheck`, `test`, `build` — for every prepared change. `resolveValidationProfile`
reads the repository snapshot (framework, package manager, workspace layout) and
decides *which commands this repository understands*. It has never had, and was
never designed to have, any opinion about the change in front of it.

The consequence is measurable. Four validation runs on this repository recorded
between 12.3s and 15.0s for `install`, ~87–94s for `typecheck`, ~87–91s for
`test` and ~111–121s for `build`: roughly 300s of phase time per run, spent
identically whether the change edits the billing ledger or adds a `<link
rel="canonical">` to a marketing page.

Two different questions had been collapsed into one:

```
which commands does this repository understand?   → shape → ValidationProfile
how many of them does this change deserve?        → risk  → ValidationDepth
```

## Decision

Introduce `ValidationDepth` (`fast` | `standard` | `deep`) as a second,
orthogonal axis, resolved per prepared change and recorded on the run.

**A depth only ever selects a subset of the profile's own steps.** It cannot
introduce a command the profile does not define. `fast` skips exactly one step,
the unit suite; `standard` and `deep` run all four.

### Why the build is not depth-adjustable

The first draft had `fast` run `install` + `typecheck` only. The first dogfood
of it failed with `validation_not_supported`, and the reason is structural
rather than a matter of caution:

- `buildSatisfiesProfile` requires a passing build before a run may be recorded
  as passed at all. That invariant predates this ADR and is deliberate.
- A passing run's filesystem is captured as the artifact a **preview** boots
  from — "the exact validated build". Without a build, the artifact holds
  unbuilt bytes and the next pipeline stage starts from something never
  compiled.

There is also a plain engineering reason. For a presentational change the unit
suite is the *least* likely of the four steps to catch a regression — vitest
never renders `src/app/layout.tsx` — while the build prerenders every route and
is the *most* likely. Dropping the build to keep the tests would have skipped
the step that actually checks the work.

`standard` and `deep` are deliberately identical today. That is stated rather
than disguised: `deep` is not currently more work, and claiming otherwise would
be the false optimisation this work is meant to avoid. The distinction is still
recorded on every run and forms part of the validation identity, so it is the
hook the first genuinely deeper check attaches to — and every historical run
already says which question it answered.

### What may decide a depth

Deterministic, server-owned inputs only: the spec's `riskClass`, the trusted
Action Step's `changeKind` and `evidenceIds`, and **the paths Vibe itself
verified as changed**. No model call, no commit-message parsing, no agent
explanation. The agent cannot influence how hard its own work will be checked,
which is the entire premise of independent validation.

### Ordering is the policy

Escalation is evaluated before anything that could lower the answer, so no
combination of inputs can talk a sensitive change down:

1. a sensitive changed path → `deep`, always
2. a high or prohibited risk class → `deep`
3. sensitive evidence cited → `deep`
4. no code change at all → `fast`
5. presentational evidence **and** presentational-confined paths → `fast`
6. an ordinary moderate-risk change → `standard`
7. nothing resolved → `standard`

Only steps 4 and 5 produce `fast`, and both require a trusted signal to have
positively resolved. Missing signal — an unreadable spec, a removed plan step, a
deterministic capability with no agent run — resolves to `standard`. Silence
never buys speed.

### Depth is part of the validation identity

`validation_depth` and `validation_depth_policy_version` join the canonical
array in `computeValidationIdentity`. A stored `fast` pass therefore cannot be
reused to answer a later request for a `standard` or `deep` one — the same
discipline `sandboxPolicyVersion` already enforces for the sandbox rules, and
the direct application of Rule 65.

Historical rows keep `validation_depth = null`. They ran under a policy that had
no depth, and labelling them retroactively would assert they answered a question
nobody asked them.

## What is unchanged

Depth selects among *steps*. It does not touch what validation proves. All of
the following run identically at every depth, in `verifySource`, **before** any
depth-selected step is reached:

- the exact prepared commit SHA is checked out and verified
- a fresh, isolated sandbox holding no credential
- changed-file verification against the prepared change's own file list
- build-identity verification (`package.json`, lockfile, and config files)

Rule 66 is untouched. `sandbox_validation_passed` still means only that a
profile's commands exited zero in an isolated VM — at `fast` it means fewer
commands did, which is exactly why the depth and its reason are recorded on the
run and shown in the panel. Human approval requirements are unchanged.

## Consequences

**Easier.** A cosmetic change no longer pays for the full unit suite. The axis
exists, is versioned, and is recorded, so the first genuinely deeper check has
somewhere to attach.

**Harder.** There are now two versioned policies to reason about instead of one,
and a `fast` pass is a weaker statement than a `standard` one. The UI must say
which steps did not run, and it does.

**Foreclosed.** Nothing. `resolveValidationProfile` is unchanged, and a
repository whose profile omits a step still omits it at every depth.

### The honest measurement

Simulated against the three historical agentic runs (see
`validation/depth-benchmark.test.ts`), the policy assigns one of each depth.
Only run #6 gets shorter — a projected 211.7s against 298.6s of measured phase
time, a 29% reduction on one run of three. Runs #7 and #8 are unchanged. The
step durations are measured; the saving is arithmetic on top of them.

An earlier revision of this ADR claimed 66%, on the `fast` that skipped the
build. That number was wrong and is retained here only so the correction is
legible.

Three defects in the first draft were found by running it rather than reading
it, which is why the benchmark is checked in and why the depth was dogfooded
before being believed:

1. `presentational_low_risk` was unreachable — it required
   `riskClass !== "moderate"`, but `classifyExecutionRisk` only returns `low`
   for non-mutating change kinds, already handled a branch earlier.
2. `e2e/auth.spec.ts` escalated a CTA copy change to `deep` because the auth
   path rule matched a test filename.
3. `fast` skipped the build, which the pass verdict and the preview artifact
   both depend on. Found only by running a real validation.

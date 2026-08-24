# 0049 - Evidence-grounded business-lens diagnostic scores

Status: Accepted

Date: 2026-08-24

## Context

The Business Brain models nine business lenses, but contract v6 recorded only
qualitative health and materiality for each. That was sufficient for reasoning
and prioritization, but it left the signature planet visualization unable to
show how strongly the available evidence supports each health judgment.

The five existing audit dimensions and their deterministic aggregate remain
the product's scored readiness contract. A lens score must not silently become
a sixth calculation of the same overall result, and missing evidence must never
be represented as zero.

## Decision

Audit contract v7 adds an optional-at-rest, required-on-new-output `score` to
each `BusinessLensAssessment`. It is a 0–100 diagnostic index for that lens's
health only:

- strong: 70–100;
- adequate: 50–69;
- weak: 0–49;
- unclear or blocked by founder context: null.

The provider may propose the integer alongside health, but application
validation remains authoritative. It clamps numeric range and preserves a
score only when valid cited evidence survives and the number agrees with the
health band. Contradiction, unsupported evidence, an old missing field or an
unassessable health state produces null rather than an adjusted or inferred
number.

Lens scores do not determine materiality, the five dimension scores or the
overall Business Health score. The latter remains computed by the existing
application scoring path. Contract v6 stays supported, so existing audits
remain valid and render `—`; a user-triggered future scan writes v7 scores. No
database migration is required because the immutable audit payload is JSONB.

Fixture-only representative values may exercise the visual contract. They are
never substituted into a stored audit or production view model.

## Consequences

**Easier.** Every planet has one stable numeric contract, the UI can distinguish
legacy/unknown from a genuinely low score, and future per-lens history has a
versioned starting point.

**Harder.** Health and score can disagree at the provider boundary, so the
validator must null the number rather than manufacture consistency. Per-lens
trend UI remains unavailable until two comparable v7 scans are read through a
dedicated history model.

**Unchanged.** Overall Business Health, evidence trust, audit materiality,
conclusion ranking, paid-run initiation and causal-claim rules do not change.

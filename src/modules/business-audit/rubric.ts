/**
 * Business Readiness rubric (Sprint 4 §19).
 *
 * This is product logic, versioned in source control. Changing what the
 * rubric says changes what the product concludes, so it must never be
 * edited without incrementing `RUBRIC_VERSION` — otherwise two audits
 * carrying the same version number could mean different things, and
 * reproducibility is gone.
 *
 * Two rules run through every dimension:
 *
 *  1. **Absent evidence is not bad evidence.** A missing signal means the
 *     dimension is less assessable, never that it scores badly.
 *  2. **A technology is not a strategy.** A Stripe dependency is evidence
 *     that payment integration exists — not that monetization is working.
 *     The rubric rewards demonstrated business capability, not package
 *     names.
 */

export const RUBRIC_VERSION = "business-readiness-rubric-v1" as const;

export const BUSINESS_READINESS_RUBRIC = `# Business Readiness Rubric (${RUBRIC_VERSION})

Assess five dimensions. For each, decide what the evidence can actually
support before deciding on a score.

## Assessment status — decide this FIRST

- "assessable": there is direct evidence about this dimension from at least
  two independent sources, or strong unambiguous evidence from one.
- "partial": some relevant evidence exists, but important aspects are
  unobservable.
- "insufficient_evidence": nothing in the pack speaks to this dimension.

A score is only permitted when status is "assessable" or "partial". When
status is "insufficient_evidence" the score MUST be null.

Never lower a score because information is missing. Missing information
lowers the assessment status and the confidence — not the score.

## Scoring scale (only when a score is permitted)

- 80-100: the capability is clearly present and coherent on the evidence.
- 60-79: present and functional, with visible weaknesses.
- 40-59: partially present; significant elements are missing.
- 20-39: minimal presence.
- 0-19: the evidence positively indicates this capability is absent (not
  merely unobserved).

The distinction in the last band is critical. "No pricing page was detected
on the live site AND no payment integration exists in the repository AND the
founder states monetization is only planned" is positive evidence of
absence. "No analytics data available" is NOT evidence of absence — it is
absence of evidence, and belongs in unknowns.

## Dimensions

### Product
Is the product understandable, and does it actually exist as a working
thing? Consider: whether a value proposition is identifiable from the
homepage and the founder's description; whether functional product surfaces
exist; how clearly the target customer is defined; whether there is a way
for a visitor to access the product. A working authenticated app area is
stronger evidence than a marketing page alone.

### Monetization
Is there a credible path from user to revenue? Consider: whether the founder
states a monetization model; whether a pricing surface exists live; whether
a checkout or billing path exists; whether payment integration signals
appear in the repository. Payment integration alone is not monetization —
a Stripe dependency with no pricing page and no stated model is weak
evidence, and should be described as such.

### Distribution
Can people discover this product? Consider: whether the site is
technically discoverable (SEO foundations such as title, description,
canonical, sitemap, robots); whether content or distribution infrastructure
exists (blog, docs, changelog); whether the founder states an acquisition
approach. Be honest that Vibe Business has NO traffic, ranking, referral, or
channel data — distribution is frequently only partially assessable, and
saying so is the correct answer.

### Conversion
Does the product guide a visitor toward the intended action? Consider:
whether a primary call to action exists and is identifiable; whether a
signup path exists; whether a path from pricing to signup exists; what
conversion-relevant forms are present. Assess the *structure* of the
conversion path. Vibe Business has NO conversion-rate data, so never claim a
conversion rate is good or bad.

### Retention
Is there something to come back to? Consider: whether an authenticated
product experience exists (a protected app area redirecting to login is
direct evidence); whether onboarding exists; whether the product's nature
implies recurring use; whether analytics or retention instrumentation is
present. Vibe Business has NO usage, cohort, or churn data. For most
early-stage products this dimension will be "partial" or
"insufficient_evidence" — that is the honest answer, and a low score would
be a false one.

## Evidence discipline

Every strength, gap, and key finding must cite the evidence ids it rests on.
Cite only ids present in the evidence pack. Never invent an id. If you
cannot cite evidence for a claim, do not make the claim.

## Out of scope

Do not propose actions, tasks, fixes, or recommendations. Do not write
"you should…". This audit diagnoses the current state only. Prioritized
opportunities are produced by a separate later stage.`;

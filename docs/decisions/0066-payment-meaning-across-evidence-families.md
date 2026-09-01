# 0066 - Payment meaning is read from every evidence family that can carry it

Status: Accepted
Date: 2026-09-01

## Context

`classifyExecutionRisk` refuses payment work outright. `FINANCIAL_SURFACES`
carries `payments` and `checkout_billing`, and the constant's own comment says
why the answer is `prohibited` rather than `high`: *"Vibe does not modify
payment architecture at all, at any risk tolerance."*

The parser did not agree with the constant. `surfaceIdOf` stripped exactly two
id families — `repo.surface[_absent].*` and `live.surface[_absent].*` — and
returned null for everything else, which the classifier read as "no financial
meaning".

Two families that routinely carry payment meaning were therefore invisible:

- `repo.integration.<id>` (minted by `business-audit/evidence.ts` from the
  repository detector catalogue) — `stripe`, `paddle`, `lemonsqueezy`;
- `auth.surface.<id>` and `auth.surface.<id>_not_observed` (minted by
  `business-audit/evidence-v2.ts` from a Deep Scan) — `billing`.

A real Action Plan generated on 2026-09-01 contains the step *"Wire the pricing
page to a working Stripe checkout and surface billing to signed-in users"*,
citing `repo.integration.stripe`, `repo.routes.pages` and
`auth.surface.billing_not_observed`. It classified `moderate` — inside
`MAX_AGENTIC_V1_RISK` — and was eligible for an agent run.

This is the failure mode Sprint 0073 already refused once, in the other
direction: `payments` matched and `payments_missing` would not have, so a
payments change would have fallen from `prohibited` to `moderate` with nothing
failing. The same class of defect had simply reappeared one namespace over.

## Decision

Risk classification reads *meaning*, and meaning is resolved across every id
family that can express it.

1. `business-audit/evidence-ids.ts` — the module that owns "how to read an
   evidence id" — gains `readAuthSurfaceCitation` and `readIntegrationCitation`
   beside `readSurfaceCitation`.
2. `repository-intelligence/detectors/integrations.ts` publishes
   `INTEGRATION_CATEGORY_BY_ID`, **derived** from the detector catalogue rather
   than written a second time. A payments provider added to the catalogue is
   classified without anyone remembering that a risk gate exists.
3. `risk.ts` resolves one `RiskMeaning` per id: a payments integration or a
   billing surface is `financial`; an auth integration is `security`. The
   existing surface lists are unchanged and still checked first.
4. `EXECUTION_RISK_POLICY_VERSION` becomes `execution-risk-policy-v2`.

`auth.` is deliberately **not** added to `SURFACE_NAMESPACES`. That record is a
pair of prefixes and three consumers iterate it as such; the signed-in pack
expresses absence as a *suffix*, so an entry there would be a latent bug in all
three.

Polarity stays ignored everywhere. A step that adds payments is exactly as
prohibited as one that changes them.

## Consequences

**The version bump is the load-bearing part.** `EXECUTION_RISK_POLICY_VERSION`
is an input to `computeExecutionSpecIdentity`. A spec built under v1 was
measured against a gate that could not see either family, and Rule 65 is
explicit that a stored pass must never be reinterpreted under rules it was not
checked against. Every spec built from here carries a new identity, which is
the correct consequence rather than a cost.

**Two things are deliberately not widened**, and both are pinned by tests
rather than left to judgement:

- *A pricing page stays `moderate`.* `live.surface.pricing` and `pricing_page`
  are marketing copy, not payment architecture. Prohibiting them would refuse
  the only Move the product currently has an agentic route for, and would say
  "Vibe never changes anything to do with taking payments" about a page that
  takes no payment.
- *Signed-in surfaces other than billing stay unescalated.* `auth.` names where
  the Deep Scan was standing, not what a step changes. Escalating
  `auth.surface.dashboard` would put every signed-in-product change outside the
  V1 boundary. `risk.ts` already records that widening `SECURITY_SURFACES` is an
  ADR and not a constant; this ADR honours that by pinning the current answer
  instead.

**No evidence id is renamed.** ADR 0044 records why a rename is a jsonb
migration across four persisted columns; this reads the ids as they are.

**This does not make the agent narrower in any direction that matters.** The
steps it stops being offered for are steps `FINANCIAL_SURFACES` already said it
must never attempt. What changes is that the parser now agrees with the rule.

## Related

- [ADR 0026](0026-agentic-execution-contract.md) — the risk ceiling and why
  widening it is an ADR rather than a raised constant.
- [ADR 0044](0044-evidence-pack-v4.md) — surface citations carrying polarity,
  and why the ids were not renamed.

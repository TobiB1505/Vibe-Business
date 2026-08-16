# Sprint CORE-2a.1 — Audit Synthesis Contract

## Problem

CORE-2a proved that Evidence Pack v3 materially improved the audit's **input**. The dogfood
then showed that its **output** had not moved: 10 strengths and 15 gaps across five
dimensions, and a UI that compressed them after the fact — 25 findings, hide 19, show 6.

That is React deciding what matters. The contract this sprint adds moves the decision to
where it belongs.

**Evidence can be detailed. Judgment must be concise.**

## Semantic layers

```
raw evidence          what did Vibe observe?              many, and that is fine
      ↓
dimension assessment  how does one business area look?    five, unchanged
      ↓
business conclusion   what do these observations MEAN?    2–4 strengths, ≤3 blockers
      ↓
next move             what should happen next?            Opportunity Engine, untouched
```

The layers are not interchangeable, and the third is the one that did not exist.

## Rubric changes

`business-readiness-rubric-v1` → `v2`, `business-audit-prompt-v2` → `v3`.

What was added, in the rubric's own words rather than paraphrased:

- **Synthesize, do not enumerate.** Leaving an observation out of the synthesis does not
  discard it — every dimension assessment and evidence id is preserved and shown elsewhere.
- **Group related evidence.** Five observations of one problem are one conclusion citing five
  ids, never one conclusion each.
- **Prefer the root over the symptom.** "Pricing is not in the navigation", "no purchase
  button", "no checkout" are three symptoms of one root problem.
- **Do not over-compress.** "Growth needs work" spanning analytics, pricing and retention is
  too broad to act on. Conclusions must be distinct and individually meaningful.
- **Do not pad to a count.** If the evidence supports two blockers, return two.
- **A conclusion is not an observation.** "A title tag exists" is evidence; "people can
  understand what your product is for" is a strength.
- **Write for the founder.** A named list of forbidden vocabulary — monetization model,
  pricing surface, checkout surface, acquisition strategy, canonical URL, structured data,
  funnel instrumentation — with a plain-language replacement shown for each.
- **Uncertainty survives translation.** Plain language must not become more confident than
  the evidence.

## Structured output

`BusinessConclusion`: `headline`, `explanation`, `whyItMatters`, `evidenceIds`, `dimensions`,
`tone`, `confidence`. `AuditSynthesis`: `overall`, `strengths`, `blockers`, `version`.

Two decisions worth recording:

**One array, split by tone.** Two arrays would serialize the conclusion shape twice and
compile it twice — the grammar-size problem Sprint 4 already paid for with a `400 — the
compiled grammar is too large`. `keyFindings` was removed in the same change rather than kept
alongside: a key finding *was* a cross-cutting conclusion, and asking for both would spend
grammar and tokens on the model saying the same thing twice, with only one of them subject to
the cardinality and grounding rules.

**`whyItMatters` is a plain string, not `string | null`.** The union would have been the
second `anyOf` in the schema, and the existing `wire-schema.test.ts` guard caught it. An empty
string means "nothing to add", and `cleanText` maps it to null on the way into the domain, so
the domain type keeps its honest `string | null`. Measured, not assumed: `objectCount: 3`,
`unionCount: 1`, unchanged from before this sprint.

## Cardinality

`MAX_SYNTHESIZED_STRENGTHS = 4`, `MAX_SYNTHESIZED_BLOCKERS = 3` — a **ceiling, never a
quota**. Nothing manufactures a conclusion to reach a number; a padded blocker would be
exactly the invented judgment this layer exists to prevent. The tests assert the ceiling and
assert that two justified blockers stay two.

## Grounding

Every conclusion cites at least one id that exists in the pack, or it is discarded and the
discard is recorded in `validationNotes`. Near-duplicates are merged by **evidence overlap**
(≥ 0.6 of the smaller set, same tone), before the cap is applied, so a restatement never
displaces a distinct problem. Deliberately not a semantic comparison: two conclusions
describing one underlying problem cite substantially the same evidence, which answers it
without a second model call or an embedding index.

## Opportunity Engine compatibility

The engine's input **grew**. `renderOpportunityInput` now carries the synthesis *in addition
to* every per-dimension summary, strength, gap, unknown and cited id it already forwarded.

CORE-2a.1 §24 is the rule: small customer-facing judgment, not small model context. Reducing
prioritization's input to three blockers would have destroyed opportunity generation to make a
screen shorter.

## Versioning

`business-audit-synthesis-v1`, separate from `business-evidence.v3`. Evidence quality and
judgment quality move independently, and an audit has to be able to say which of them it
carries. No migration: the synthesis lives inside the existing `result` JSONB.

Historical audits keep `synthesis: null` and render through the CORE-2a path — grouped and
bounded per-dimension findings. Nothing re-reads old prose to invent a conclusion nobody's
model actually drew.

One defect found here and worth keeping: `synthesis !== null` would have crashed **every**
historical audit, because a row read back from JSONB has no such key and arrives as
`undefined`. The domain type says `AuditSynthesis | null`; stored JSON does not have to agree
with it.

## Dogfood — the real before/after

Both runs are against the real Vibe Business product, same evidence sources.

| | v2 pack, rubric v1 (14 Aug) | v3 pack, rubric v2 + synthesis (16 Aug) |
|---|---|---|
| Primary findings shown | **24** (9 strengths, 15 gaps) | **6** (3 strengths, 3 blockers) |
| Compression mechanism | none, then UI truncation | the model's own judgment |
| Dimension findings stored | 9 + 15 | 7 + 15 — **unchanged in kind** |
| Evidence cited by the synthesis | n/a | **37 references across 6 conclusions** |
| Overall score | 39 | 43 |
| Dimensions assessed | 5/5 | 5/5 |

The evidence was not thrown away. Six conclusions cite 37 evidence references between them,
and the 22 per-dimension findings are still stored and still rendered in the breakdown.

### What it actually says

> **Overall:** Vibe Business already has a genuine working product behind the login and a
> clear way for visitors to sign up, but right now there is no way for anyone to pay, and the
> founder's own description of what the product is and who it is for is still unsettled.

The grouping that proves the contract works — one blocker, **8 evidence ids**, two dimensions:

> **There is currently no way for anyone to actually pay you.**
> You've told Vibe there is no monetization model yet, and that matches everything else Vibe
> could see: no pricing page, no checkout, and no payment code anywhere in the product.
> *Why it matters:* Without a priced offer or a payment path, visitors who sign up have no way
> to become paying customers, so growth right now can only build a user base, not revenue.

Under the old rubric that same evidence produced five separate gaps. A third blocker groups
analytics *and* the absence of any content presence across distribution and retention, again
citing 8 ids.

And one the previous audit never surfaced at all, because no single dimension owned it:

> **It's still unclear how you'd explain this product to a stranger in one sentence.**
> The description you gave Vibe reads like a placeholder note rather than a finished
> explanation, and the stated audience ('young entrepreneurs') is broad rather than specific.

### Cost — shorter output, *higher* cost

| | v2 pack, rubric v1 | v3 + synthesis | change |
|---|---|---|---|
| Input tokens | 6,924 | 10,528 | +52% |
| Output tokens | 4,473 | 6,802 | +52% |
| Thinking tokens | 1,199 | 3,195 | **+166%** |
| Provider cost | $0.0586 | $0.0891 | **+52%** |
| Latency | 38.6 s | 62.7 s | +62% |

§47 warned against assuming shorter output means lower cost, and it was right to. The
customer-facing answer got four times shorter and the call got half again as expensive,
because **compression is harder work than enumeration** — the thinking tokens nearly tripled.

Part of the input growth is the longer rubric; the rest is Evidence Pack v3. This is the
honest trade: ~3 cents more per audit for an answer a founder can act on.

## Validation

| | |
|---|---|
| `pnpm lint` | clean |
| `pnpm typecheck` | clean |
| `pnpm test` | 3038 passed / 158 files |
| `pnpm build` | production build green |
| `pnpm test:e2e` | 117 passed, chromium |
| Real dogfood | run on the deployed product, read back from the database |

New coverage: `synthesis.test.ts` (20 cases) on grouping, multi-dimension conclusions, the
cardinality ceiling, grounding, duplicate-root-problem merging, and that dimension assessments
survive untouched. Browser coverage for the synthesis view at 1440/1024/768/375, including a
jargon check over the rendered conclusions.

## Residuals — what is honestly still wrong

**One jargon leak in the real output.** The first blocker's explanation says "there is no
monetization model yet", and `monetization model` is on §13's forbidden list. It is arguably
quoting the founder's own input — the Founder Intent field is literally named that — but the
rubric says avoid it, and it appeared anyway. The E2E jargon assertion runs against the
fixture, so it did not catch a leak in live output. Not fixed by adding another prompt rule:
that is a change that should be measured, not guessed at.

**The grammar probe was not run.** `ANTHROPIC_API_KEY` exists only in Vercel, so
`pnpm ai:probe-audit-schema` could not run locally. The unit guard on `objectCount` and
`unionCount` is a proxy for it. The schema did compile in production — the dogfood run
succeeded — so the risk is now retired by evidence rather than by the probe.

**The entitlement blocks its own improvement.** Running this dogfood required an operator to
delete the previous audit row, because the free audit is one-per-project-forever and credits
do not exist. That is not a dogfood inconvenience — it means **every existing user is stuck on
whatever audit version they first ran**, and will be again on the next rubric bump. Unresolved
and deliberately not decided here; it belongs with CORE-3's economics.

## Next Recommended Phase

**CORE-2b** — Action Planner + First Free Move orchestration.

The input chain is now the right shape for it: not 15 atomic gaps, but three real business
problems, each carrying the evidence and the dimensions behind it — which is what a planner
needs to choose the best first executable move.

# Sprint CORE-2a.3 / 2a.3.1 — Business Reasoning Framework & Stage-Aware Materiality

Two sprints in one document, because the second exists only to fix what the first's dogfood
exposed and neither reads correctly alone.

**CORE-2a.3** gave the audit nine universal business lenses to reason through before concluding
anything. **CORE-2a.3.1** fixed what that revealed: the reasoning was good and the
prioritization was not.

---

## Part 1 — CORE-2a.3: nine lenses

### The problem

The audit had drifted into answering the question its scanners could answer most easily:
*which business-related product features are missing?* That produces honest, useless output.
"No pricing page", "no checkout", "no analytics" are three observations about surfaces. What a
founder needs answered is *what does this product still need in order to become a functioning
business?*

### What was built

Nine lenses — offer, audience, revenue & economics, acquisition, conversion, retention,
measurement, business readiness, scalability — assessed in the **same single reasoning call**,
before synthesis. Not UI cards, not scores, not nine mandatory findings: an internal reasoning
pass whose output is a handful of conclusions.

One framework for every product type. There is deliberately no `SaaSAudit` or
`MarketplaceAudit`: a portfolio site and a marketplace both have an offer, an audience and
economics. What differs is which lenses *matter*, which is a property of the assessment rather
than of the framework.

Adaptive founder questions (`founder-questions.ts`) were built deterministically rather than
with a second model call — every input the choice depends on is already structured data by the
time it runs, and a model asked to invent business questions produces a startup questionnaire.

### Two self-inflicted failures, $0.25

The first refresh was rejected by Vibe's own language net at $0.146. The cause was in this
sprint's own rubric: the nine lens names had been written in as prose headings — **CONVERSION**,
**RETENTION**, **ACQUISITION** — which the model read immediately before writing customer-facing
conclusions. That is exactly the priming CORE-2a.2 had removed, reintroduced at nine times the
size. Fixed with backticked machine keys and an explicit "these are ours, use them in the `lens`
field and nowhere else".

The second failed at $0.105 on `["monetization model"]`, and the diagnosis forced a **reversal of
a CORE-2a.2 decision**. `monetization` is one of the five scored dimensions — the model is
*required* to emit it five times per run and was then forbidden its natural collocation. A rule
fighting the schema. Three consecutive rejections on the same phrase, while an earlier run
carrying the same reasoning passed: the model says "monetization model" sometimes and "how this
will make money" other times, and a coin flip that discards a $0.10 audit is a badly calibrated
rule, not a misbehaving model.

The blocklist became two tiers on that evidence:

| | |
|---|---|
| "no **pricing surface** was detected" | meaningless outside this codebase → **rejects** |
| "no **monetization model** yet" | corporate but parseable → **validation note** |

The note is what keeps it honest: if these appear constantly the rubric is not teaching well
enough, and that is now visible rather than silent. `languageTerms` was added to the stored
diagnostic at the same time, because the first rejection could say only "the net fired".

---

## Part 2 — CORE-2a.3.1: what the dogfood proved

### The nine lenses worked. The ranking did not.

The first successful nine-lens audit (contract v3, $0.1375, 99.5s) returned these blockers:

1. It's still not clear how this product will make you money.
2. The basics a stranger expects before trusting you with money aren't visible yet.
3. You currently have no way to see what people actually do once they sign up.

Only the first is something the founder should work on now. Vibe Business is a `prototype` with
`monetization: none` and `goal: launch` — a missing privacy policy is a task for the day there
is something to sell, and analytics with almost no users measures noise.

Meanwhile the lens layer had found the right things and filed them below the fold:

| lens | what it said | materiality |
|---|---|---|
| `audience` | "directionally clear but broad"; missing: *who the first realistic paying customer is* | medium |
| `acquisition` | no channel, no content, no stated approach | medium |
| `scalability` | **the cost of an audit run versus any future price is entirely unaddressed** | medium |

The third is the sharpest sentence in that audit. Without being given a single cost figure, the
model reasoned that Vibe's own margin is the unresolved question — which is true, and had been
measured at $0.067–$0.1375 per run all day.

**Verdict: one of three.** Recorded here rather than smoothed over, because it is the entire
argument for the second sprint.

### The cause was in the schema, not the model

`LENS_STATES` was `strong | adequate | unclear | not_material | blocked_by_missing_context`.

It had **no way to say "weak"**. Business readiness — no privacy policy, no terms, no contact
route, nothing found across three independent sources — came back as `unclear`, which is false.
Nothing about it was unclear.

The model wanted to express severity and the only lever left was `materiality: high`. That is how
a compliance checklist displaced two real business problems: **severity leaked into priority
because health had no severity axis.** No rubric wording would have fixed it.

`not_material` compounded it by sitting in the health enum, where it never belonged — "this does
not apply to this kind of product" was always a priority judgment.

### Health versus materiality

Two questions, now two fields.

```
health       strong | adequate | weak | unclear | blocked_by_missing_context
materiality  now | soon | later | not_material | unknown
```

Materiality is **temporal**, not a severity scale. `high | medium | low` invites the reading
"low means it's fine", which is exactly wrong: a lens is routinely `weak` **and** `later` at the
same time, and that pairing is the most useful thing this audit can tell an early founder. "Not
set up yet — and too early to be one of your biggest problems" is intelligent advice. "Low" is a
shrug that could mean either.

`not_material` moved here, where it separates cleanly from `later`: a one-off product has nothing
to retain as a permanent property of its business model, not as a stage it will grow out of.

`unknown` is not a middle value and sorts **last**. Something the audit could not judge must
never outrank something it did.

### The milestone rule

> **What currently prevents this founder from reaching their next meaningful business
> milestone?**

Not *what is missing from this business overall* — everything is missing from every early
business, and the audit's value is knowing which absence matters today.

### The prematurity rule

> **Do not prioritize downstream work before the stage it belongs to exists.**

No users → optimizing repeat use is premature. No traffic → funnel measurement is premature. No
decided revenue model → billing operations are premature. No clarity on the first customer →
scaling reach is premature.

Deliberately **not** a stage-to-priority lookup table. A regulated fintech prototype may
genuinely need legal foundations on day one where an internal tool does not; the rubric says so
explicitly and a test pins that it does.

### Per-lens calibration

`business_readiness` — not material merely because expected items are absent. The counterweight
sits in the same paragraph so it cannot be read as "legal never matters": for a live product
already taking consumer money, the identical gap is `now`. Same gap, different materiality.

`measurement` — reflect whether there is yet anything meaningful to measure. Never treat having
analytics installed as a proxy for business maturity.

`retention` — depends on the business model, not the calendar.

`acquisition` — cuts both ways. Do not reflexively downgrade it because a founder is early; if
the product is clear and there is no way to reach anyone, that may be the binding constraint.

`revenue_economics` — not a question about pricing pages. Cost to deliver each use, whether
income can outgrow that cost, where free stops. A product whose delivery costs real money per
use has an economics question before it has a price.

### Business conclusion versus supporting evidence

Three layers, and the lower ones must not do the top one's job:

1. **the conclusion** — what the business problem is
2. **why Vibe thinks this** — the evidence for that judgment
3. **technical detail** — what was and was not detected

A missing product surface belongs in layer 2 *unless the absence itself is the business problem*.
For a business with real demand and a broken checkout, "customers cannot complete a purchase" is
the honest primary conclusion. For a founder who has not decided how to charge, a missing
checkout is a symptom of the undecided model, and leading with it hides the real issue.

### Catching the model contradicting itself

`lens-priority.ts` reviews the audit against its own reasoning. It cannot decide which three
problems matter — that judgment needs the whole business in view and belongs to the model; a
scoring formula over nine enum values would be a worse audit wearing a determinism costume.

What it can do is notice a top three that ignores a lens the audit called `now` in favour of one
it called `later`. No business knowledge is needed to see that contradiction.

It reports the **pairing**, never either half. Three slots against four urgent problems is
arithmetic, not misjudgment, and a `later` blocker is the honest answer when nothing more urgent
exists.

**Notes, never rejections** — for the reason CORE-2a.3 paid $0.25 to learn. Rejection is for
output that would mislead, not for output that could have been ordered better. The model is
allowed to overrule this; it just has to leave a trace when it does.

A second detector counts absence clauses (`no <something>`) in a conclusion's explanation. Three
or more is a sentence that has turned into an inventory. Also a note only, because §49's
counterexample is real.

---

## Dogfood — Vibe Business, contract v4

### Founder intent used, verified before evaluating

Read back from `project_founder_intent` rather than assumed:

| | |
|---|---|
| stage | `prototype` |
| monetization model | `none` |
| primary goal | `launch` |

The Product Profile corrections were fixed **by the user through the real UI** before this run —
the previous placeholder values ("Junge Unternehmer", "Ich teste den Kontext hier…") are gone and
the profile now carries Vibe's real positioning. Nothing was seeded in production to make the
audit look better.

### The lens assessments

| lens | health | materiality | reasoning |
|---|---|---|---|
| `offer` | adequate | **now** | specific problem, specific promise, plausible delivery |
| `audience` | **weak** | **now** | "software founders and builders" is broad; no first segment anywhere |
| `conversion` | adequate | **now** | one clear call to action, working signup and login |
| `revenue_economics` | **weak** | soon | nothing decided, nothing to pay with; expected at this stage |
| `acquisition` | **weak** | later | *"premature until audience is clearer"* |
| `scalability` | unclear | later | no usage or cost data; no prerequisites in place |
| `retention` | adequate | later | *"optimizing for repeat use is premature"* |
| `measurement` | **weak** | later | *"a real gap but not yet a decision-critical one"* |
| `business_readiness` | **weak** | later | *"expected rather than urgent right now"* |

Five lenses are `weak` — a word that did not exist in the vocabulary before this sprint. And
`business_readiness: weak + later` is precisely the sentence the model could not previously
form. The prematurity rule appears in the model's own summaries, unprompted by name.

### The conclusions

**Overall**

> Vibe Business exists as a real, working signed-in application with a clear stated purpose, but
> it has not yet decided how it will make money and has not yet defined who its first customer
> really is — two open questions that matter more right now than anything about traffic or
> growth.

**Blockers (2)**

1. *You haven't yet decided how this makes money…* — `revenue_economics`, 8 evidence ids
2. *It's still unclear exactly who your first real customer is.* — `audience` + `acquisition`,
   5 evidence ids

**Strengths (2)** — a real working product beyond the landing page; a clear and working path from
homepage to signed-up user.

Two blockers, not three. §52 forbids padding to fill slots, and the two `now` lenses that did not
become blockers — `offer` and `conversion` — are *healthy*. A lens that matters now and looks
fine is a strength you are relying on, not a problem. That is the contract working, not a
shortfall.

The second blocker is the cross-lens synthesis doing its job: audience and acquisition merged
into one conclusion, with the model stating the prerequisite relationship explicitly rather than
filing two symptoms.

### Acceptance question (§60)

> *If the founder could work on only three things today, are these genuinely the most important?*

**Yes.** Undecided economics and an unfocused first customer are the two things I would name for
this business, in that order, and the audit reached them from evidence rather than from a
checklist. The compliance and analytics findings are still stored, still true, and correctly
marked as a later stage's problem.

### Cost and latency

| | v3 audit | v4 audit |
|---|---|---|
| Input tokens | 13,454 | 16,353 |
| Output tokens | 11,060 | 9,872 |
| Reasoning tokens | 6,273 | 5,213 |
| Cost | $0.1375 | **$0.1314** |
| Latency | 99.5 s | 106.5 s |
| Blockers | 3 | 2 |

Input grew ~22% because the rubric grew. Output and reasoning fell, which is not a result worth
generalising from one sample — one run is one run.

### Entitlement and refresh

| | |
|---|---|
| `access_mode` | `system_contract_refresh` |
| Contract | `business-audit-contract-v4` |
| Rubric | `business-readiness-rubric-v6` |
| **Free audit grant** | **still held — 1** |
| Manual row deletion | none |

The entitlement was neither spent nor restored. Score moved 48 → 46 and is **not** comparable —
`auditScoresComparable` returns false across a contract change, which is exactly the case it was
written for before any score-delta UI exists.

---

## Residuals — honestly

**The revenue blocker's explanation still enumerates.** Our own new detector caught it in the
stored record:

> "There's no pricing shown anywhere, no way for a visitor to buy or pay, and no payment system
> built into the code"

That is almost verbatim the sentence §21 quotes as the *bad example*. The headline above it is a
proper business conclusion; the explanation regressed into a list of absences. The rubric teaches
the replacement and the model did not take it here. **Partial failure on §61 for one of two
blockers** — visible because the detector exists, which is the argument for the detector.

**Materiality and ordering disagree slightly.** `revenue_economics` is marked `soon` and placed
first; `audience` is marked `now` and placed second. Defensible — magnitude and immediacy are not
the same — but the audit did not explain the inversion, and the priority-inversion detector
correctly stayed silent because no `now` lens was displaced.

**"monetization model" appeared again**, recorded as a wording note. Second sighting. Under the
CORE-2a.2 rules this $0.13 audit would have been discarded for it. If it appears a third time the
rubric needs a taught replacement for that exact phrase, not a stricter list.

**One sample, tuned against one business.** The calibration was written from Vibe Business's
failure and validated against Vibe Business. The unit tests deliberately cover the opposite
directions — legal `now` on a paid consumer product, measurement `now` with real traffic,
retention `now` on a subscription — so the fix cannot collapse into "legal is always later". But
no *second real business* has been audited under v6. Overfitting risk is real and unretired.

**`founder-questions.ts` is not wired to any UI.** Built in CORE-2a.3, tested, and called from
nowhere in production. For Vibe Business it would ask zero questions anyway (all three intent
fields are set), so the adaptive-question experience is unexercised end to end.

**The grammar probe still cannot run locally.** `ANTHROPIC_API_KEY` exists only in Vercel. The
schema compiled in production across every successful audit, so the risk is retired by evidence
rather than by the probe.

---

## UI debt — the reason for the next sprint

The screen still presents the five legacy measurements:

> Do people understand what you built? · Can you make money from it? · Can people discover you? ·
> Do visitors become customers? · Do people come back?

Those are the scored dimensions, and they are unchanged and still correct. But they no longer
represent what the audit knows. Nine lenses, each with a health *and* a current priority, are
computed on every run, stored, and **shown nowhere**. Intelligence has outgrown presentation.

The data contract is deliberately ready for it: health and priority are separate fields, the
deprioritized lenses are preserved rather than dropped, and every lens carries its evidence ids
and its missing context.

### Next recommended phase — Audit Business Map

Before CORE-2b. It should make visible:

- all nine lens areas, not five
- lens **health** and lens **current priority** as separate readings
- the top-three blockers, with the "too early / later" states shown rather than hidden
- lower-priority real gaps, preserved and legible
- evidence as secondary disclosure

And document — not build — the audit-running motion: the nine lenses narrated as the audit
executes ("Understanding your offer… Understanding who it's for… Looking at how the business
could make money…"). A 100-second operation currently shows a spinner while doing nine distinct
pieces of reasoning it could be showing instead.

The overall score should be positioned as secondary throughout. Vibe's value is not "your
business is 46/100"; it is knowing where the business stands and what matters next.

### Then CORE-2b

The input chain is now the right shape: two grounded business problems in founder language, each
carrying its evidence, its lenses and its prerequisite relationships — not fifteen small gaps.

---

## Re-audit loop

Materiality is contextual and time-dependent, and nothing here freezes it. A lens ranked `later`
today is preserved in full and rises on its own once the problems ahead of it are solved — which
is why `validateLenses` keeps every assessment rather than filtering to the ones that became
blockers. Founder intent changes, a product profile update, an executed change, new evidence or a
stage change all re-open the question.

Concretely for this project: once the revenue model is decided and a first customer is chosen,
`acquisition` and `measurement` should rise without anything being reconfigured.

## Validation

| | |
|---|---|
| `pnpm lint` | clean |
| `pnpm typecheck` | clean |
| `pnpm test` | 3186 passed / 164 files |
| `pnpm build` | production build green |
| `pnpm test:e2e` | 117 passed, chromium |
| Real dogfood | contract refresh, no manual deletion, read back from the database |

## Out of scope and untouched

The nine lenses are unchanged and there is no tenth. The Product Profile remains canonical.
Founder Intent remains three optional enums and no business-context model returned. No Action
Planner, no execution suitability, no First Free Move, no AI authoring, no preview work, no
`/score` redesign, no Rule 57 or ADR 0014 changes.

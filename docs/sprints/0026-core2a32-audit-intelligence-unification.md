# Sprint CORE-2a.3.2 — Audit Intelligence Unification

The nine-lens layer was already reasoning better than the audit a founder read. This sprint
stopped the loss between them.

## Problem

CORE-2a.3.1's dogfood produced good lens assessments and then three defects downstream:

- **A** — the lens layer said `audience: now` and `revenue_economics: soon`, and the blocker
  list put revenue first with nothing said about why.
- **B** — the revenue blocker's explanation was an inventory of missing surfaces, flagged by
  the audit's own validation.
- **C** — the five scored dimensions still existed beside the lenses as a second source of
  business judgment.

## The actual dataflow, traced before changing anything

There is **one** model call. No separate synthesis stage receives lens output; dimensions,
lenses and conclusions are all produced in a single structured response.

```
repository + live site + Deep Scan + Product Profile + Founder Intent
        ↓  buildEvidencePackV3            deterministic, no model
   evidence pack v3 — flat "id | source | fact" lines
        ↓  ONE Anthropic call             system = prompt + rubric; user = fenced pack
   one JSON object, generated in schema property order
        ↓  normalize → validate → persist
```

Answering §3's eight questions from the code:

| | |
|---|---|
| What generates the lenses? | the evidence pack |
| What generates the five dimensions? | the same evidence pack, in the same call |
| What does synthesis receive? | nothing separate — it is the same call, and its nearest context is **its own already-generated output** |
| Raw evidence directly? | yes, the whole pack |
| The five dimensions? | yes — it generated them itself, immediately before |
| The nine lenses? | yes, also self-generated |
| What drove blocker ordering? | nothing enforced it |
| What drove the explanation text? | the dimension gaps, demonstrably |

### One cause under all three defects

`dimensions` was the **first** property in the response schema. The dimension assessments are
the technical record and are written in technical language on purpose, so the model produced,
as the Monetization gaps:

```
No pricing surface on the live site or in the repository
No checkout/billing surface detected anywhere
No payment integration signal in the repository
Founder states the monetization model is undecided
```

and then, with that inventory as the freshest thing in its own context, wrote the
customer-facing explanation:

> "There's no pricing shown anywhere, no way for a visitor to buy or pay, and no payment system
> built into the code — and you've told Vibe directly that the monetization model isn't decided
> yet."

Four clauses, the same four facts, the same order, "monetization model" carried up verbatim.
That is a paraphrase, not an independent judgment.

It explains defect A too. `monetization` is a dimension scoring **10/100** written at the top of
the response, while `audience` — the lens the same audit marked `now` — **is not a dimension at
all** and had no numeric presence to compete with it.

And it explains the recurring jargon leak that CORE-2a.2 had twice diagnosed as a founder-intent
serialization problem. "Monetization model" is *legitimate* in a dimension gap; that layer is
explicitly exempt from the customer-language rule. It was there to be copied upward.

## What changed

**Order.** `lenses → overallConclusion → conclusions → dimensions → limitations`. Judgment
first, scanner record last. Same call, same fields, no added cost. A test pins the property
order, because it is load-bearing and looks like formatting.

**A root problem per conclusion.** Each conclusion opens with an internal `rootProblem`: the
underlying business problem in one sentence, written before any founder-facing prose exists to
anchor on, and the place an ordering override states its reason. Never rendered.

A separate `RootBusinessProblem` object was considered and rejected — §11 permits reusing an
existing structure, a conclusion already carries the lenses and evidence one would need, and a
fifth object shape costs compiled grammar this schema exists to conserve.

**Materiality became a selection contract.** `now` normally outranks distinct `soon` root
problems; `later` normally stays out. An override is permitted and must state its reason.
"It scores worse" and "there is more evidence for it" are explicitly ruled out — the first is
severity, the second measures how easy something was to detect.

**`findOrderingOverrides`** records a `soon` problem placed above a `now` one when the audit left
no reason. Writing its test found a real bug in it: the check asked the *displaced* problem to
explain someone else's promotion.

**`findUnconfirmedAssertions`** (§31) records a blocker resting entirely on lenses the audit
marked `blocked_by_missing_context`. "Your unit economics don't work" and "what this costs you to
run is still an open question" can rest on identical evidence; only the second is honest. Rule 44
in the synthesis layer.

All of these are **notes, never rejections**. CORE-2a.2 already proved what discarding sound
reasoning over an imperfect surface costs.

## The legacy five dimensions — verified, not deleted

Traced before touching anything (§5, §33). They are load-bearing in four places: the overall
score, the `/score` UI, historical audits, and the Opportunity Engine, whose wire schema requires
a `primaryDimension` from the five. All retained.

The boundary is now positional rather than structural: the dimensions still measure, still score
and still carry their findings, but they are generated after the conclusions are fixed, and the
rubric states plainly that a conclusion must never be built from a dimension's gaps.

### The same defect was live one layer downstream

`renderOpportunityInput` listed the five dimensions — with scores, and gaps written as undetected
surfaces — before the business conclusions, while the comment directly above the conclusions
claimed they were *"added above the dimension detail"*. The comment described CORE-2a.1's intent;
the code did the opposite, for two sprints. Nothing failed, because both orderings produce a
valid prompt and nothing asserted which one was live.

Worse: **the nine lenses never reached the engine at all.** Materiality is the most
decision-relevant field the audit produces and it stopped at the audit's own boundary, so "no
analytics" and "the first customer is undefined" arrived looking equally actionable — the only
ranking signal available was a dimension score.

Fixed: conclusions first, then the lens map with health, materiality and `missingContext`, then
the technical breakdown. The prioritization rubric (v2) now knows what to do with it — a `now`
area normally outranks a `later` one *even when the later one scored worse*.

## The timeout that discarded a finished audit

The first refresh attempt failed at exactly **120,003 ms**, with `input_tokens: null` and no
cost recorded. Not validation, not the model: a single client-level 120s timeout shared by every
operation, sitting 13 seconds above what audits actually take. The v4 run was 106.5s. This
sprint's larger rubric pushed a complete, correct run past the line and the whole call was
thrown away.

How long is too long is a property of the task, so `timeoutMs` moved to `operations.ts` beside
the model and the effort level. Set from the ledger, not from round numbers:

| operation | runs | avg | slowest | timeout |
|---|---|---|---|---|
| business readiness audit | 17 | 53.0 s | 106.5 s | 240 s |
| opportunity generation | 8 | 39.5 s | 48.8 s | 120 s |
| product understanding | 5 | 10.7 s | 14.7 s | 60 s |

An order of magnitude apart — a shared default had to be wrong for at least one of them. Making
the field required rather than optional was deliberate: the compiler then named all five call
sites instead of leaving the two nobody thinks about on a default that had already proven short.

`runInference.maxRetries = 0` held throughout: one failed usage event, no second billable call,
entitlement untouched.

**Unverified:** the platform step ceiling. The step was demonstrably alive past 120s — our own
code recorded the failure — but nothing here proves 240s is reachable. A run killed *without* a
usage event would be the ceiling, not this setting.

## Dogfood — Vibe Business, contract v5

Founder Intent read back before evaluating, not assumed: stage `prototype`, monetization `none`,
primary goal `launch`. Unchanged since 11:09 UTC and set by the founder through the UI.

### Lens assessments

| lens | health | materiality | the reasoning that decided it |
|---|---|---|---|
| `audience` | weak | **now** | broad and inferred; "the thing most likely to stall everything downstream" |
| `conversion` | adequate | **now** | one clear action, working forms; no paying stage, consistent with the undecided model |
| `acquisition` | weak | soon | "scaling would be premature… but the complete absence of any channel will matter as soon as launch happens" |
| `offer` | adequate | soon | credible but untested against real customers |
| `revenue_economics` | weak | soon | "confirmed and coherent rather than an accidental gap" |
| `retention` | unclear | later | no users yet, so a fair gap to leave |
| `measurement` | weak | later | "would mostly be measuring silence" |
| `business_readiness` | weak | later | "a real gap but not yet an urgent one" |
| `scalability` | unclear | later | conventional stack, but cost-to-serve unknown |

### Conclusions

> Vibe Business already works as a real product — a clear promise, a functioning signup path, and
> a genuine signed-in app behind it — but the business around it is still undefined: it doesn't
> yet know exactly who its first customer is, and it hasn't decided how the value it creates
> turns into money.

| # | blocker | lenses | materiality |
|---|---|---|---|
| 1 | Vibe couldn't tell who your very first customers are meant to be. | audience, offer | **now** |
| 2 | You haven't yet decided how this will make money. | revenue_economics | soon |
| 3 | Vibe couldn't see how new people would find out this exists. | acquisition | soon |

Three strengths: a real working product behind the login, a clear specific story for why it
exists, a working path to sign up.

### Before and after

| | v4 (contract v4) | v5 (this audit) |
|---|---|---|
| Blocker #1 | revenue (`soon`) | **audience (`now`)** |
| Ordering vs materiality | reversed, unexplained | follows materiality |
| Revenue root problem | none — the field did not exist | *"what customers would pay for, how usage would turn into a price, or where free stops and paid starts"* |
| Blockers | 2 | 3, all distinct root problems |

Defect A is fixed and the fix is visible in the data: `findOrderingOverrides` stayed silent
because the order genuinely follows materiality now.

The revenue `rootProblem` is almost word for word the abstraction level §17 asked for, which is
the clearest evidence the field is doing its job.

### Cost

| | v4 | v5 |
|---|---|---|
| Input tokens | 16,353 | 17,943 |
| Output tokens | 9,872 | 14,018 |
| Reasoning tokens | 5,213 | 8,236 |
| Cost | $0.1314 | **$0.1761** |
| Latency | 106.5 s | **138.1 s** |

**34% more expensive and 30% slower.** §57 asked whether removing legacy context would reduce
cost; it did not, because nothing was removed — the ordering changed and a `rootProblem` was
added per conclusion. The model also reasoned substantially more (+58% thinking tokens) on a
richer prioritization contract. That is the price of this sprint, stated rather than buried.

### Entitlement

`access_mode: system_contract_refresh`, contract v5, rubric v7, prompt v4. **Free audit grant
still held.** No manual row deletion. Score moved 46 → 44 and is **not** comparable —
`auditScoresComparable` returns false across a contract change.

## The dogfood questions (§59)

**A — does the audit preserve the strongest ideas from the lenses?** Yes. The acquisition
blocker exists *because* the lens reasoned that scaling is premature but the absence will matter
at launch — that nuance survived into a customer-facing conclusion.

**B — does priority match materiality?** Yes, for the first time.

**C — does each blocker describe a root business problem?** Two of three. See residuals.

**D — could the scanner facts move into "why Vibe thinks this" without weakening the
explanation?** For blockers 1 and 3, yes. For blocker 2, the explanation would lose most of its
body — which is the residual.

**E — is it specific to this product?** Yes. "Software founders who want to commercialize their
product", the audit-run cost question, the signed-in workspace — none of it is generic.

**F — would the founder agree these are what matters now?** Yes.

**G — is any lens sharper than the blocker representing it?** No longer. The cost-to-serve
question sits in `revenue_economics.missingContext` and in `scalability`, correctly ranked
`later`, and is no longer a stronger observation than any blocker.

## Residuals — honestly

**The revenue explanation still enumerates, and the note fired again.** Its `rootProblem` is
excellent; its explanation reads:

> "You told Vibe the monetization model isn't decided, and there's no pricing shown anywhere, no
> way to pay, and no billing code in the product — which all lines up with that being a genuinely
> open decision rather than an oversight."

This is materially better than v4 — the absences are now framed as *corroboration of a decision*
rather than listed as findings, and the closing clause is reasoning. But it is still three
absence clauses, and `countAbsenceClauses` measures form, not function. **This is a case where
the detector and the intent diverge**, and the honest reading is that the detector needs either
a higher threshold or to target a different field now that `rootProblem` carries the abstraction.
Not changed here on one sample.

**"monetization model", third consecutive sighting** — and this one was *not* the dimension
paraphrase, since dimensions are now written last. The model reached for the compact noun phrase
while reporting the founder's own answer back to them. Two sprints of removing the words from
its input did not help, because the phrase is simply the shortest way to say the thing. Rubric v8
now teaches the replacement outright — the opposite of CORE-2a.2's approach, and the one the
evidence supports. **Not yet verified against a real run.**

**Cost and latency both rose materially** and no optimization was attempted. At 138s, the audit
is also a product problem independent of correctness: the founder watches a spinner for over two
minutes.

**The platform step ceiling is unverified** (see above).

**`founder-questions.ts` is still wired to nothing.** The contract it needs is intact and now
tested — `missingContext`, the lens, and the materiality travel together, and they reach the
Opportunity Engine — but no UI asks anything.

**Single-sample overfitting risk persists.** Every calibration decision in 2a.3.1 and 2a.3.2 was
made from Vibe Business's own failures. The unit tests deliberately cover the opposite directions
(legal `now` on a paid consumer product, measurement `now` with real traffic, retention `now` on
a subscription, checkout as a legitimate root problem), but **no second real business has been
audited under this contract.**

## Validation

| | |
|---|---|
| `pnpm lint` | clean |
| `pnpm typecheck` | clean |
| `pnpm test` | 3238 passed / 165 files |
| `pnpm build` | production build green |
| `pnpm test:e2e` | 117 passed, chromium |
| Real dogfood | contract refresh, no manual deletion, read back from the database |

## Out of scope and untouched

No new lenses and no tenth. Product Profile still canonical. Founder Intent still three optional
enums; no Business Context returned. No Action Planner, no execution suitability, no First Free
Move, no AI authoring, no `/score` redesign. Scoring still comes from the five dimensions and is
deliberately unchanged — whether it should migrate to the lens model is a separate decision.

## Final fix — binding the explanation to the root problem

The v5 dogfood left one defect: the internal `rootProblem` was excellent and the customer-facing
explanation fell back to an inventory. The audit's own validator flagged it.

### The cause was in the rubric, and it was ours

The v5 revenue explanation:

> "there's no pricing shown anywhere, no way to pay, and no billing code in the product"

The rubric, a few paragraphs above where the model was writing:

> Not: "There is no pricing shown anywhere, no way for anyone to pay, and no payment system in
> the code."

A near-verbatim reproduction of the sentence the rubric forbids — quoted there, by this sprint,
from the v4 failure in order to illustrate what not to do.

**This is the third time this project has primed the exact output it was banning.** CORE-2a.2's
forbidden-phrase list put "monetization model" in front of the model immediately before it wrote
the phrase. CORE-2a.3 put the nine lens names in as prose headings and got them back in customer
copy, at $0.146. And now this. A concrete forbidden sentence is a template, and nothing reliably
stores the "not".

Both negative examples are gone. What replaces them is a structural test the model applies to its
own sentence — *could this explanation have been written before the scan?* If it names a decision
still open, good; if only someone reading a detection list could have written it, it is layer 2 in
layer 1's place. Positive examples stay.

### The jargon leak, finally at source

"Monetization model" was not in the v7 rubric string at all. It was in the **evidence id**:

```
intent.monetization_model | founder_intent | The founder told Vibe: They have not decided how the product will make money.
```

The pack renders every line as `id | source | fact`, so the model read the phrase on every single
run, one underscore from prose, while the rubric asked it not to use it. CORE-2a.2 rewrote the
label and left the id — which is exactly why the phrase survived three sprints of fixes aimed at
the sentence beside it. The id is now `intent.how_it_earns`, and the absent-evidence note that
used the same words is rephrased.

### The contract

`explanation` is now specified as a **translation** of `rootProblem` rather than a second
analysis: same level, warmer words, and it must remain recognisably the root problem. The
reasoning already happened one field earlier; the explanation's job is to carry it, not repeat it.

No second model call, no frontend copy-mapping, no change to lenses, materiality, ranking or
scoring.

### Regression coverage

A standing guard that the rubric never contains the enumerations it forbids, that the evidence
pack carries no form-field vocabulary in either the id or the absent-evidence notes, plus
fidelity fixtures: the v5 revenue explanation is flagged, the same root problem translated is
accepted, and the audience, acquisition and broken-checkout conclusions all pass untouched so the
fix cannot overcorrect into banning plain statements about missing surfaces.

### Two budget failures before it could be measured

The fix could not be dogfooded until two ceilings were raised, both set when this call was a
smaller operation, and both discarded a finished answer.

A shared client timeout took the first attempt at exactly **120,003 ms** — 13 seconds above the
longest real audit, until this sprint's larger rubric crossed it. Nothing billed.

Then the raised timeout let the call run, and it truncated mid-object at exactly **16,000 output
tokens** with **$0.1965 already billed**. Under adaptive thinking, reasoning shares the output
budget: the JSON is ~5,800 tokens and thinking went 8,236 → 11,172 between consecutive runs as
this sprint added more checks per conclusion.

The instinct was to raise the token ceiling to 40,000. That would have been a number that looks
like a budget. Generation runs at a steady **~9.8 ms per output token** across every real audit
measured (9.0–10.8 over four runs), so 40,000 tokens implies ~394s and the 240s timeout fires
first. At 240s the most that can physically be generated is ~24,000 tokens — so that is the
ceiling, and a test now enforces that every operation can generate its whole output budget before
its own timeout. Fixing these independently is how you get a third failure.

### Dogfood — contract v6

Founder intent unchanged and re-read: `prototype` / `none` / `launch`.

**`validationNotes: []`** — the first empty set since CORE-2a.3. Both standing notes cleared: no
jargon leak, no abstraction regression.

| | root problem (internal) | explanation (customer) |
|---|---|---|
| **1** | broad audience category, not narrowed to a first customer, and no visible channel through which that audience would find the product | "You know roughly who this is for — software founders trying to commercialize what they've built — but there's no sharper first-customer picture yet, and Vibe couldn't see any blog, content, or stated way for the right people to find you." |
| **2** | has not decided what customers would pay for or how usage becomes revenue | "By your own account the pricing model isn't settled, and nothing on the site, in the code, or in the signed-in app shows a price or a way to pay — so the economics of the business are still an open question." |

§24's question — *is the explanation saying the same thing as the root problem, just in simpler
language?* — is **yes** for both. Each explanation carries the same two-part structure as the root
problem above it and ends on the business statement rather than the observation.

The `whyItMatters` on the revenue blocker is materiality expressed in the founder's own words,
which nothing asked for explicitly: *"it's not blocking getting the product launched today, but
it's the next real gap behind it."*

Lens map: `offer` adequate/now · `audience` weak/now · `conversion` adequate/now · `acquisition`
weak/soon · `revenue_economics` weak/soon · `scalability` unclear/later · `retention`
adequate/later · `measurement` weak/later · `business_readiness` weak/later.

| | v5 | v6 |
|---|---|---|
| Validation notes | 2 | **0** |
| Output / thinking tokens | 14,018 / 8,236 | 14,200 / 9,111 |
| Cost | $0.1761 | $0.1785 |
| Latency | 138.1 s | 138.0 s |
| Blockers | 3 | 2 |
| Score | 44 | 43 |

Free audit grant still held; no manual deletion. Scores are not comparable across contracts.

### Residuals from this fix

**The revenue root problem drifted toward the surface.** v5's read *"what customers would pay
for, how usage would turn into a price, or where free stops and paid starts"*. v6's appends *"and
no pricing, payment, or checkout mechanism exists anywhere in the product"*. Fidelity improved
and the anchor weakened — the explanation is now faithful to a root problem that is itself half
inventory. The headline picked it up too: *"…and right now there's no way for anyone to pay."*

**Two blockers, not three.** Audience and acquisition merged into one root problem. Defensible —
the model stated the prerequisite relationship — but "who is my first customer" and "no channel
exists" are different pieces of work, and this reads slightly over-merged.

**The empty note set is partly threshold luck.** The revenue explanation contains one absence
clause; three is the trigger. The detector is coarse by design, and a clean run is evidence, not
proof.

Contract v6, synthesis v5, rubric v9. 3253 unit / 117 e2e / lint / typecheck / build green.

## Next recommended phase

**The Audit Business Map UI.** The reasoning contract is now worth freezing. Nine lenses, each
with a health *and* a current priority, plus root problems and what only the founder can answer,
are computed on every run and shown nowhere — the screen still presents the five legacy
measurements. Intelligence has outgrown presentation by two sprints.

It should make visible: all nine areas rather than five; health and current priority as separate
readings; the top blockers with their "too early / later" context; lower-priority real gaps
preserved; evidence as secondary disclosure. And it should document — not build — the
audit-running motion, because a 138-second operation currently shows a spinner while doing nine
distinct pieces of reasoning it could be narrating.

**Then CORE-2b.** The input chain is finally the right shape: three grounded business problems in
founder language, each carrying its evidence, its lenses, its root problem and its prerequisite
relationships — and now they reach the Opportunity Engine with their materiality intact.

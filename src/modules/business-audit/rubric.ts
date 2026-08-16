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
 *
 * v2 (CORE-2a.1) adds a third, and it is the reason for the version bump:
 *
 *  3. **Evidence can be detailed; judgment must be concise.** The dimension
 *     assessments are unchanged and still enumerate. What is new is a synthesis
 *     layer above them that must *not*: it groups related observations into a
 *     few business conclusions and says which ones matter.
 *
 *     The first real dogfood is the argument. It returned five separate gaps —
 *     no monetization model stated, no pricing surface, no checkout surface, no
 *     payment capability, no paying journey stage — which are five observations
 *     of one problem: people have no clear path to paying. A founder reading
 *     five bullets has to do the synthesis the audit was supposed to do.
 */

export const RUBRIC_VERSION = "business-readiness-rubric-v5" as const;

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
Is there a credible path from user to revenue? Consider: what the founder says
about how the product will earn money; whether prices are shown anywhere on the
live site; whether a way to buy or be billed exists; whether payment
integration appears in the repository. Payment integration alone is not
revenue — a Stripe dependency with no prices shown and nothing the founder
intends to charge for is weak evidence, and should be described as such.

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

Every strength, gap, and conclusion must cite the evidence ids it rests on.
Cite only ids present in the evidence pack. Never invent an id. If you
cannot cite evidence for a claim, do not make the claim.

## Business reasoning — nine lenses, before you conclude anything

The dimensions above are what the scanners can see. They are not a way to think
about a business. Before synthesizing, assess this product as a business
through all nine lenses below.

The question is never "which business-related product features are missing?".
It is **"what does this specific product still need in order to become a
functioning business?"**

### The nine questions

Each has an internal key, given in \`code\`, which you use in the \`lens\` field
and **nowhere else**. The key is a label for us. The question is the thing to
think about, and the words you write for the founder come from the answer — not
from the label.

1. \`offer\` — Why should anyone want this? Is the problem real, the value
   clear, the promise specific? Is there a reason to choose it over what people
   do today?
2. \`audience\` — Who cares enough about this problem to act or pay? Is the
   first realistic customer clear enough to aim at? A product can serve a broad
   market and still need a much narrower first customer.
3. \`revenue_economics\` — How does the value created become money that keeps
   coming in? Consider what customers would pay for, where free stops and paid
   starts — and the cost of delivering it: what each use costs you, and whether
   income grows faster than that cost.
4. \`acquisition\` — How do the right people find this? Search, writing,
   communities, partnerships, marketplaces, word of mouth, an audience you
   already have, the product spreading itself, integrations, reaching out,
   paying for attention. Search is one of eleven, not the definition.
5. \`conversion\` — How does someone get from interested to actually using it,
   and to paying? Landing, signing up, getting started, first real value, and
   being able to buy.
6. \`retention\` — Why would anyone come back, keep using this, or keep paying?
   Recurring value, work they have stored, a need that repeats.
7. \`measurement\` — Can the founder tell what people do and what is actually
   working?
8. \`business_readiness\` — What still stops this being something a stranger
   would buy from with confidence? Trust, support, being able to bill, the
   basics someone expects before handing over money.
9. \`scalability\` — What happens to cost, margin and the founder's own time if
   this grows?

### Assess each lens

For each: a state, how much it matters *for this product right now*, a short
internal summary, the evidence ids behind it, and — when it is blocked — what
only the founder could tell you.

States: \`strong\`, \`adequate\`, \`unclear\`, \`not_material\`,
\`blocked_by_missing_context\`.

### Materiality is not fixed

The same lens matters differently for different products and stages, and
judging every product against one template is how an audit becomes useless.

- A one-off digital product has little to retain. Retention is \`not_material\`,
  not weak.
- A portfolio or service site may have no recurring revenue by design.
- A pre-launch prototype with no users does not need funnel measurement yet;
  the same gap becomes material once real traffic exists.
- A marketplace needs both supply and demand — reason about that through
  audience and acquisition rather than inventing a tenth lens.

Judge the product in front of you, at the stage it is actually at.

### The founder's goal changes what matters

Founder intent is in the evidence. Someone trying to win their first paying
customer needs offer, audience and revenue attended to before retention
tuning. Someone with paying customers trying to keep them has the reverse
priority.

### Intent guides judgment; it does not override reality

If the founder's stated goal is not supported by what exists, say so plainly
and kindly. "Growing faster is the goal, but the foundations that make growth
repeatable are not in place yet" is a more useful answer than silently
prioritizing acquisition.

The same applies in reverse: if Vibe's understanding of the product is weak and
a conclusion would depend heavily on it, lower your confidence rather than
asserting.

### Unknown stays unknown

If evidence and founder intent together cannot answer a lens, mark it
\`unclear\` or \`blocked_by_missing_context\` and name what is missing. Never
invent a business fact. Never state a legal, tax or regulatory conclusion —
company structure, jurisdiction, VAT and regulated-industry rules cannot be
read from a repository or a website. You may say that such a question will need
answering before taking payments; you may not answer it.

## Business synthesis — the part that decides whether this audit is useful

The lenses are the working-out. Now step back and say what it MEANS.

**Synthesize. Do not enumerate.** Do not return every valid observation as its
own conclusion. Read all the evidence, find the patterns, and report only the
conclusions a founder should act on. Leaving an observation out of the
synthesis does not discard it — every dimension assessment and every evidence
id is preserved and shown elsewhere.

### Group related evidence into one conclusion

Several observations that describe the same underlying problem are ONE
conclusion citing all of them, never one conclusion each.

- No pricing page + no purchase call to action + no checkout + payment code
  present + a stated intent to charge → one conclusion about the buying path
  being unclear, citing all five.
- No analytics + no conversion events + no measurement surface → one conclusion
  about not being able to tell what is working, citing all three.

### Prefer the root problem over its symptoms

"Pricing is not in the navigation", "there is no purchase button" and "no
checkout exists" are three symptoms of one root problem. Report the root.

And go one level further than the product surface. A missing pricing page is a
symptom; the root may be that the business has not yet decided how the value it
creates becomes revenue — especially where delivering the product costs real
money per use. Those are different problems with different answers, and only
the evidence tells you which one this is:

- No prices shown, no way to pay, and the founder has not decided how to
  charge → the **revenue model** is the open question.
- A business model already decided, prices configured in the code, but nothing
  a visitor can see or buy → the model exists and the **buying path** is the
  problem. Do not call this a missing revenue model.

Technical gaps are rarely root problems. Missing search-engine signals are a
business blocker only when discovery is genuinely what is holding this business
back — not by default because they are easy to detect.

### Do not over-compress

The opposite failure is just as bad. Do not merge unrelated problems to reach a
target count. "Growth needs work", covering analytics and pricing and retention
at once, is too broad to act on. Conclusions must be distinct, specific and
individually meaningful.

### Do not pad to a count

If the evidence supports two blockers, return two. Never invent a third.

### Cardinality

- 2 to 4 strengths, when the evidence supports them.
- At most 3 blockers.
- One overall conclusion about the business as a whole.

### Choosing which blockers are primary

Weigh, together: how much this affects the business becoming viable; how much
it matters at this product's stage; how confident the evidence makes you; and
how relevant it is to what the founder said they are trying to do next. A
high-impact problem you can barely evidence outranks a small one you can prove.

Each conclusion records the lenses it came from. Most real blockers span
several — that is expected, and a conclusion forced into one lens is usually a
symptom rather than a root problem.

### A conclusion is not an observation

A strength is something a founder would be glad to hear about their business,
not a fact about their markup.

- Not a strength: "A title tag exists." That is evidence.
- A strength: "People can understand what your product is for."

A blocker must be something that could plausibly inform what to do next.

- Not a blocker on its own: "Canonical URL missing." If it is genuinely one of
  the three biggest business problems, express it as one: "Search engines are
  missing signals that help them understand your pages." If it is not, leave it
  in the dimension assessment where it belongs.

### Language — write for the founder, not for an analyst

Every customer-facing field must describe the **business consequence** in the
words a founder would use with a friend. A non-technical person must understand
every headline without opening evidence or technical details.

The rule, stated once rather than as a list of banned phrases:

> Internal taxonomy, implementation vocabulary, scanner terminology and the
> names of the nine keys above must not be copied into a customer-facing field.
> Say what it means for the business instead.

The keys are the clearest trap, because you will have just used them. Words
like \`conversion\`, \`retention\` and \`acquisition\` are ours, not the
founder's — and a phrase built from one ("your conversion path", "retention
capability", "your acquisition approach") reads as a report about a system
rather than a sentence about their business.

- Not "your conversion path is incomplete", but
  **people can't get from interested to actually paying you.**
- Not "retention capability is weak", but
  **there's not much reason for anyone to come back next week.**
- Not "no clear acquisition approach", but
  **Vibe couldn't see how the right people would find you.**

The customer-facing fields are: the overall conclusion, and every headline,
explanation and why-it-matters in the conclusions.

Technical terms may appear only where they are unavoidable, and must be
explained in the same sentence.

- Not "No pricing or checkout capability was detected", but
  **People still don't have a clear way to pay you.**
- Not "No structured acquisition approach found", but
  **Vibe couldn't see a clear way new customers are finding you yet.**
- Not "Retention capability detected", but
  **Customers already have something useful to come back to.**

The dimension assessments are the other side of this line. Their summaries,
strengths, gaps and unknowns are the technical record and may stay technical.

### Uncertainty survives the translation

Plain language must not become more confident than the evidence. Absence of
evidence is not evidence of absence. When something was not observed, say so:
"Vibe couldn't find…", "…appears to…", "…is still unclear", "Vibe hasn't
confirmed…". Never state an unobserved thing as a fact.

### Every conclusion is grounded

Each one cites at least one real evidence id, and names the dimensions it
touches. A conclusion may span several dimensions — an unclear buying path is
monetization and conversion at once — and that is correct, not a mistake to
avoid.

## Out of scope

Do not propose actions, tasks, fixes, or recommendations. Do not write
"you should…". This audit diagnoses the current state only. Prioritized
opportunities are produced by a separate later stage.`;

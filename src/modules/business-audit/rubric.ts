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
 *
 * v6 (CORE-2a.3.1) adds a fourth, from the first nine-lens dogfood:
 *
 *  4. **A weak area is not automatically an urgent area.** That audit reasoned
 *     well and then ranked badly. It found the three things that actually
 *     mattered — an undefined revenue model, a first customer too broad to aim
 *     at, no repeatable way to reach anyone — and filed two of them as
 *     `medium`, while a compliance checklist (no terms, no privacy policy, no
 *     contact route) took a top slot at `high` on a prototype with nothing to
 *     sell.
 *
 *     Health and materiality are now separate judgments in the schema, and this
 *     rubric answers them separately: how does this area look, and does it
 *     block the founder's next milestone. They are different questions, and
 *     collapsing them is what turns an audit into a checklist.
 *
 * v7 (CORE-2a.3.2) adds the fifth, and it is about where the words come from:
 *
 *  5. **A conclusion is never a paraphrase of the scanner record.** The v4
 *     dogfood wrote the Monetization dimension's four gaps — no pricing
 *     surface, no checkout surface, no payment integration, founder has not
 *     decided — and then wrote the customer-facing explanation as those same
 *     four facts in the same order, "monetization model" included.
 *
 *     The response schema now generates lenses and conclusions *before* the
 *     dimensions, so the scanner inventory is no longer the freshest thing in
 *     context when the founder's sentence gets written. This rubric adds the
 *     other half: name the root problem first, and let materiality decide the
 *     order rather than decorate it.
 *
 * v8 is a single paragraph, added after "monetization model" appeared in a
 * third consecutive real audit. The first two sightings were the dimension
 * paraphrase above; the third was not — the dimensions are now written last,
 * and the model still reached for the compact noun phrase while reporting the
 * founder's own answer back to them. Two sprints of removing the words from its
 * input did not help, because the phrase is simply the shortest way to say the
 * thing. So the rubric now teaches the replacement outright rather than
 * removing the temptation, which is the opposite of CORE-2a.2's approach and
 * the one the evidence supports.
 *
 * v9 removes two sentences this file was written to forbid. The v5 audit's
 * revenue explanation read "there's no pricing shown anywhere, no way to pay,
 * and no billing code in the product" — a near-verbatim reproduction of the
 * negative example sitting a few paragraphs above it, which had been quoted
 * from the v4 failure to illustrate what not to do.
 *
 * That is the **third** time this project has primed the exact output it was
 * banning: CORE-2a.2's forbidden-phrase list, CORE-2a.3's lens names as prose
 * headings, and now this. The rule that keeps being relearned is that a
 * concrete forbidden sentence is a template, and the model has no way to store
 * the "not". So the two examples are gone, replaced by a structural test the
 * model can apply to its own sentence — could this have been written before the
 * scan? — and positive examples only.
 */

export const RUBRIC_VERSION = "business-readiness-rubric-v9" as const;

export const BUSINESS_READINESS_RUBRIC = `# Business Readiness Rubric (${RUBRIC_VERSION})

This rubric has two halves, and they are not equal.

**The business reasoning is the audit.** Nine lenses, the materiality of each,
the root problems they add up to, and the conclusions a founder reads. That
section is further down and it is the one that decides whether this audit is
worth anything.

**The five scored dimensions are the technical record.** They exist for scoring
and for a reader who wants the detail, and they are written last, after your
conclusions are already fixed. They are described first here only because they
are the simpler contract to state.

Never build a conclusion out of a dimension's gaps. A gap says what a scanner
did not detect; a conclusion says what that means for the business.

## The five scored dimensions

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

### Assess each lens — two separate judgments

For each lens give: its **health**, its **materiality**, a short internal
summary, the evidence ids behind it, and — when it is blocked — what only the
founder could tell you.

These two are independent, and keeping them apart is the single most important
thing in this section.

**\`health\`** — how this area of the business actually looks.
\`strong\`, \`adequate\`, \`weak\`, \`unclear\`, \`blocked_by_missing_context\`.

Use \`weak\` when something is genuinely poor. Do not reach for \`unclear\`
to soften it — \`unclear\` means the evidence does not settle the question, not
that the answer is uncomfortable. A business with no way to take payments has
\`weak\` revenue health, not unclear.

**\`materiality\`** — when this area needs attention.
\`now\`, \`soon\`, \`later\`, \`not_material\`, \`unknown\`.

- \`now\` — it blocks the next meaningful business milestone.
- \`soon\` — it becomes material once that milestone is reached.
- \`later\` — real, but a later stage's problem; its prerequisites do not exist.
- \`not_material\` — does not apply to this kind of business, and will not.
- \`unknown\` — cannot be judged without something only the founder knows.

### A weak area is not automatically an urgent area

This is the rule that decides whether this audit is worth reading.

**Low health does not imply high materiality.** A lens can be \`weak\` and
\`later\` at the same time, and saying so is one of the most useful things you
can tell an early founder. "Not set up yet — and too early to be one of your
biggest problems" is intelligent. Ranking it as urgent because it scored badly
is a checklist wearing the costume of judgment.

The reverse is equally true. A lens can be \`adequate\` and \`now\`: an
audience that is *directionally* clear but too broad to aim at may be the thing
blocking everything else, even though it is not the worst-looking area.

If you find yourself raising materiality because something is bad, stop. Say it
is bad in \`health\`. Materiality answers a different question.

### The milestone rule — what actually decides materiality

Ask: **what currently prevents this founder from reaching their next meaningful
business milestone?**

Not: what is missing from this business overall. Everything is missing from
every early business. The audit's value is knowing which absence matters today.

Work out the next milestone from the evidence and the founder's own words. As a
rough guide, not a lookup table:

- An early prototype needs to prove the problem, the customer and the business
  are real at all.
- Live but nobody using it needs its first meaningful users.
- Users but no revenue needs a first paying customer and a decided model.
- Early revenue needs it to become repeatable — acquisition, retention, margin.
- Growing needs scale, efficiency and operations to hold.

What blocks that milestone is \`now\`. What becomes relevant just after it is
\`soon\`. What belongs to a milestone beyond that is \`later\`.

### The prematurity rule

**Do not prioritize downstream work before the stage it belongs to exists.**

- No meaningful users → optimizing repeat use is premature.
- No meaningful traffic → detailed funnel measurement is premature.
- No decided revenue model → billing operations are premature.
- No clarity on the first customer → scaling how you reach people is premature.
- No payments taken → refund and cancellation operations are usually premature.

This is a way of reasoning, not a fixed ordering. A regulated fintech prototype
may genuinely need legal foundations on day one where an internal tool does not.
Reason from this product's stage, type, risk and the prerequisites it actually
has — never from a stage-to-priority table.

### What to weigh for each lens

Business impact. Relevance at this stage. Relevance to the founder's stated
goal. Whether its prerequisites exist yet. How urgent it truly is. How
confident the evidence makes you. What happens if it is ignored for three
months. And whether another unresolved problem has to be solved first.

Do not compute this. Judge it, and let the summary show the reasoning.

### Materiality is not fixed

The same lens matters differently for different products and stages, and
judging every product against one template is how an audit becomes useless.

- A one-off digital product has little to retain. That is \`not_material\`,
  not weak — it is the business model working as intended.
- A portfolio or service site may have no recurring revenue by design.
- A pre-launch prototype with no users does not need funnel measurement yet;
  the same gap becomes material once real traffic exists.
- A marketplace needs both supply and demand — reason about that through
  audience and acquisition rather than inventing a tenth lens.

Judge the product in front of you, at the stage it is actually at.

### Calibrating the lenses that are easiest to get wrong

\`business_readiness\` — do not make this material just because several
expected items are absent. Missing terms, privacy wording, contact routes and
billing screens are real gaps, and for a prototype that has not decided how it
will charge and has no customers they are usually \`later\`. Ask instead
whether their absence blocks the next milestone, creates immediate real risk,
or is legally necessary *at this stage*. For a live product already taking
money from consumers, the identical gap can be \`now\`. Same gap, different
materiality — the stage is what changed.

\`measurement\` — reflect whether there is yet anything meaningful to measure.
Almost no traffic makes missing instrumentation a poor candidate for a top
problem; the founder would be measuring noise. Once people are actually being
acquired, or paying, visibility can quickly become \`now\`. Never treat having
analytics installed as a proxy for business maturity.

\`retention\` — depends on the business model, not on the calendar. Existential
for a subscription with paying customers. Frequently \`not_material\` for a
one-off purchase. Usually premature for a prototype with no users.

\`acquisition\` — do not reflexively downgrade this just because a founder is
early. If the product is clear, the offer credible and the model plausible, but
there is no way to reach anyone, that may be the binding constraint. But if
nobody yet knows who the first customer is, *scaling* how you reach people is
premature — the audience question comes first.

\`revenue_economics\` — this is not a question about pricing pages. Reason
about what customers would actually pay for, whether a pricing logic exists at
all, what it costs to deliver each use, whether income can grow faster than
that cost, and where free stops and paid starts. A product whose delivery costs
real money per use has an economics question even before it has a price.

### The founder's goal changes what matters

Founder intent is in the evidence. Someone trying to win their first paying
customer needs offer, audience and revenue attended to before retention
tuning. Someone with paying customers trying to keep them has the reverse
priority. The same evidence should produce a different ordering for a different
stated goal — if it would not, the goal is not being used.

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

### Ask whether several lenses are describing one problem

Before writing the blockers, look across the lens assessments and ask: **are
these separate problems, or symptoms of the same root business issue?**

Undecided pricing, no path to pay, and unexamined cost-to-serve are three
lenses pointing at one thing — *the economics of this business are not defined
yet* — and that is one blocker citing all of it, not three.

Others stay separate. An unclear first customer and no way to reach people are
related, and one may be the prerequisite of the other, but they are still two
distinct problems with two distinct answers. Relatedness is not sameness.

A lens can also support another lens's conclusion without becoming its own
blocker: not being able to see what users do may be part of why acquisition is
unproven, rather than a third top problem.

### Business conclusion, then the evidence for it

Keep three layers apart, and never let the lower ones do the top one's job.

1. **The conclusion** — what the underlying business problem *is*.
2. **Why Vibe thinks this** — the evidence that supports that judgment.
3. **Technical detail** — exactly what was and was not detected.

The customer-facing explanation is layer 1. It answers *what is the business
problem?*, not *what did the scanner fail to find?*

**The explanation is a translation of \`rootProblem\`, not a second analysis.**
You already did the thinking when you wrote the root problem. The explanation's
only job is to say that same thing to the founder in their own words — warmer,
more concrete, easier to read, and at the *same level of abstraction*.

So write it this way: read your own \`rootProblem\` back, and say it to a
friend who runs this business. If your explanation makes a point the root
problem does not make, one of the two is wrong.

A test you can apply to your own sentence: **could this explanation have been
written before the scan?** If it names a decision the founder has not made, a
choice still open, or a consequence of that — good. If it could only have been
written by someone reading a list of what a tool did or did not detect, you have
written layer 2 in layer 1's place.

The findings are not lost — they are the cited evidence, and they remain
inspectable underneath the conclusion.

**A missing product surface belongs in the evidence, not in the explanation —
unless the absence itself is genuinely the business problem.** Context decides:
for a business with a clear model, real demand and known economics, "customers
literally cannot complete a purchase" *is* the problem and should be said
plainly. For a founder who has not decided how to charge, a missing checkout is
a symptom of the undecided model, and leading with it hides the real issue.

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

**Select for materiality, not for severity.** The blockers are the answer to
"what should this founder work on now?", so they come from the lenses you
marked \`now\` — and, where those do not fill the list, \`soon\`.

A \`weak\` lens you marked \`later\` does not belong here. It is preserved in
the lens assessments, it is real, and it will rise on its own once the problems
ahead of it are solved. Promoting it today would push out something that
actually blocks the next step.

**Ordering follows materiality too, not just membership.** A root problem built
on \`now\` lenses normally comes before one built on \`soon\` lenses. You
already decided which one blocks the next milestone; do not quietly reverse that
when writing the list.

You may put a \`soon\` problem first — but only for a reason you can state, and
you must state it, in that conclusion's \`rootProblem\`. A legitimate reason
looks like immediate financial, legal or security exposure, or one problem being
unsolvable until the other is settled. "It scores worse" and "there is more
evidence for it" are not reasons: the first is severity, and the second measures
how easy something was to detect.

Then check your own work: **is any lens you marked \`now\` missing from all
three blockers, while a \`later\` one took its place?** If so, you ranked by
how bad things looked rather than by what matters, and the list is wrong.

Beyond that, weigh: how much this affects the business becoming viable; how
confident the evidence makes you; and how relevant it is to what the founder
said they are trying to do next. A high-impact problem you can barely evidence
outranks a small one you can prove.

### An unanswered question is not a confirmed problem

Two different things can both deserve a top slot, and they must not be written
as if they were the same:

- **A confirmed problem.** The evidence establishes it, or the founder said it.
  "You have not decided how to charge" is confirmed when the founder told you
  exactly that.
- **An unresolved decision.** Something only the founder can answer, which Vibe
  could not observe. "What it costs you to deliver each use" is not visible in a
  repository or on a website.

Never let the second be written as the first. Vibe not knowing something is not
evidence that the business lacks it, and a conclusion asserting a deficiency
Vibe could not observe is an invented finding no matter how likely it sounds.

When a conclusion rests on an area you marked \`blocked_by_missing_context\`,
write it as the open question it is — "this is still an open question", "Vibe
couldn't see…", "you'll need to decide…" — and put what you would need in that
lens's \`missingContext\`.

### Name the root problem before you write to the founder

Each conclusion starts with \`rootProblem\`: one internal sentence naming the
underlying business problem. Write it first, and write it as the decision or gap
itself rather than as what was not detected.

A root problem names a **decision, a choice or a gap in the business itself**:
"The business has not decided what customers pay for, how usage becomes a
price, or where free ends and paid begins." Notice that it contains no list of
things a scanner looked for.

Then the headline and the explanation say that same thing to the founder. If you
cannot state a root problem without listing absences, you are probably looking
at a symptom — go back to the lenses and find what it is a symptom of.

The scored dimensions come **after** all of this, and they are a technical
record. Never build a conclusion out of a dimension's gaps: those describe what
a scanner did not find, and a founder needs to know what that means.

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

When the founder has not settled how the product earns, the words to use are
**how this will make money**, or **what people would pay for**. Category names
lifted from a form are not how a founder describes their own business, and
reporting their own answer back to them in one is the version of this that slips
through most easily.

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

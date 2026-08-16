# Sprint CORE-2a.4 — Interactive Audit & "Vibe needs u"

**Status: complete.** Implemented and dogfooded on a real, unrelated project — which found two
defects no test could have, and reverted one of this sprint's own decisions.

The audit has known which facts only the founder holds since CORE-2a.3. It never asked.

## Problem

`founder-questions.ts` was built, tested, and called from nowhere. Meanwhile the lens layer was
producing lines like *"Only you can answer who the first realistic customer segment is"* — real,
grounded, and inert. They sat in a report nobody could reply to.

The naive fix is a form before the audit. That is the onboarding questionnaire CORE-2 deleted,
and it inverts the product: the founder works, then Vibe works. What this sprint builds is the
other order — **Vibe works, reaches one thing it genuinely cannot know, and asks.**

## The gate, which is the actual work

A lens saying "only you can answer this" produces a **candidate**, never an interruption. Between
the candidate and the founder sits everything below, and almost all of it exists to say *no*:

| | |
|---|---|
| **founder-only** | the closed intent set contains nothing observable, and a test asserts it has not grown one |
| **storable** | an answer with no canonical home cannot be asked for |
| **material** | the last audit must say those areas matter `now` or `soon` |
| **prerequisite met** | no asking about the market before the charging decision |
| **unasked** | including questions answered "not sure yet" |
| **within budget** | at most three interruptions, and three should be rare |

Eighteen of the twenty-one gate tests assert Vibe **does not** ask. That ratio is the feature.

### The rule that caught the most embarrassing possible question

A real lens assessment on Vibe Business read:

> Only you can answer what each audit or scan actually costs to deliver.

`ai_usage_events` holds that number for every run ever made. Asking the founder for a figure we
bill ourselves was one lens assessment away from shipping. The defence is structural rather than
a filter on wording: the question vocabulary contains only things no scan can reach — what a
founder wants, has decided, or is aiming at.

### What §20 caught

`operating_market` has **no canonical store**. Founder Intent is three enums; profile corrections
describe a product, not a jurisdiction. The sprint says to challenge such a question rather than
give it a table, so it is now structurally unaskable — routing returns null, the gate refuses
anything it cannot store, and the reason is recorded. The intent stays in the vocabulary because
the audit still reasons about that gap; it just cannot interrupt for it.

## Architecture: why a pause costs nothing

Two facts decided everything else. The audit is **one** inference call — all nine lenses come
from a single structured response. And the gate is **deterministic** — the profile, the founder's
stated intent and the previous audit's lens assessments are all structured data by the time it
runs.

So the gate runs *before* the paid call:

```
prepareEvidence → checkFounderQuestion → countTokens → runInference
                        ↓ paused
                   needs_user          0 tokens, both claims held, waits for hours
                        ↓ answered
                   re-enters the same workflow from the top
```

A pause spends nothing. An answer does not resume a half-finished inference; it starts the one
call with better inputs. Exactly one paid call per completed audit, however many questions were
asked along the way.

**The honest deviation from the sprint's picture:** questions cannot be interleaved *between*
lenses, because the lenses do not exist until the call returns. What Vibe knows when it pauses is
what the last audit worked out plus what the founder has told it. A first audit has no prior
lenses and asks from the profile and intent alone. Interleaving would cost a full audit per
question, which §66 of the previous sprint explicitly rules out.

### Previous lens data is a hint, not authority

Those assessments were made against one specific product profile and one specific set of founder
answers — and this feature exists to change both. Staleness is therefore a fact, not a guess about
age: every stored audit records the `product_profile_id` and `founder_intent_hash` it reasoned
from. When either has moved, materiality is treated as unknown and the question stands or falls on
current facts. It can then neither withhold a question nor promote one; both directions are tested.

## The lifecycle

`needs_user` is a real state on the audit **and** on the operation. The operation needed it too:
with only `completed` available, a run that paused before doing its work would have to report
success, and the screen would say an audit was ready when none existed.

Both partial indexes learned about it, for different reasons:

- **single-in-flight** — a paused audit is still in flight, or a second run could start while the
  first waits for the answer, and both would race into the paid call.
- **one-included** — a paused audit consuming the free entitlement is still consuming it,
  otherwise a project could pause its included audit and start a second.

`isActive` includes it. A waiting run still owns its input identity.

The workflow **returns** at the pause rather than looping: a durable step may not wait hours for a
human. Answering re-enters the same operation from the top; every step above is already replay-safe,
so `prepareEvidenceStep` returns the claimed audit row instead of claiming a second.

Pinned by `checkedValues` against the migration — the fourth status or mode to cross the
TypeScript/SQL boundary in this repository, and the in-memory test database does not evaluate CHECK
constraints, so green unit tests say nothing about whether a paused audit can be written at all.

## Where answers go

| answer | store | why |
|---|---|---|
| stage, goal, charging direction | Founder Intent | what the founder *wants* |
| first customer | Product Profile correction | Vibe was wrong about the **product**; survives re-scans |
| "I'm not sure yet" | nothing | a placeholder would turn an honest unknown into a fabricated fact |

A third store for "audit answers" would be the business-context blob CORE-2 spent a sprint
deleting, so there is deliberately nowhere else to put one.

### Two orderings carry the safety

**Write the answer, then un-pause.** The reverse loses the founder's answer on a crash *and*
removes the prompt that would have collected it again.

**Read, merge, write for profile corrections.** `saveCorrections` upserts the whole object, so
writing only the answered field would have silently deleted every other correction the founder
ever made — the name, the description, the promise. That defect would have surfaced as a later
audit mysteriously reading old placeholder text.

Idempotence comes from the status guards: `resumeAuditAfterAnswer` matches on `needs_user`, so a
second submission updates nothing, returns `resumed: false`, and the action then starts no second
workflow.

A stale-tab guard rejects an answer whose intent does not match the pending question — answering
on a phone and then submitting from a laptop still showing the previous question would otherwise
write a wrong fact into a canonical field.

## The interaction

The panel lives inside the audit, above everything else on the score page. When Vibe is waiting on
a person, that is the only thing worth reading, and a question below a wall of status is a question
nobody answers.

**Context first, question second.** A founder should read what Vibe worked out, think "it got that
by itself", and only then be asked for the piece it could not. Reversed, it is a questionnaire with
a preamble. Context is absent rather than invented when the evidence supports nothing specific.

**"I'm not sure yet" sits beside Continue as a button**, not a skip link. The founder is saying
something true — that this is genuinely undecided — and the audit is allowed to conclude exactly
that.

The pending question is read server-side on every render, so it survives reload, navigation away,
and a different device. Browser state is never authoritative.

## Validation

| | |
|---|---|
| `pnpm lint` / `pnpm typecheck` | clean |
| `pnpm test` | 3285 passed / 167 files |
| `pnpm build` | production build green |
| `pnpm test:e2e` | 131 passed, chromium (14 new) |
| Real dogfood | a hotel's internal tool, end to end through the UI, no seeding |
| Migrations | both deployed and read back from the live database |

The browser suite covers what only a browser can: context above question, no context invented when
nothing was established, closed vocabulary offered as options rather than a text box that would
fail validation, "not sure" reachable while Continue is disabled, full keyboard operation, and
375px without sideways scroll.

Writing it produced one honest test bug worth recording: an assertion that no `role="alert"`
existed caught **Next's own route announcer**, which every route renders. The test was scoped to
the page rather than the panel — green-by-accident in reverse, and exactly the class of mistake
this suite exists to catch in components.

## Dogfood — a real project, and the two defects only it could find

Not Vibe Business. A hotel's internal vacation planner, connected by the founder while this
sprint was being written, with nothing stored: no stage, no goal, no charging decision.

### The gate fired, and the run died

It asked for the stage, took the answer, recalculated, asked for the goal, took that — and then
failed at `inputs_changed`. Both answers safely stored; the audit they were collected for dead.

**The audit's input hash includes the founder intent hash.** So a run that pauses, asks the
founder something and receives an answer has *by construction* invalidated its own identity. The
feature was self-defeating in the most literal way available: the answer that makes the audit
better is what stops it running.

Nothing could have caught this before a real run. It needs a run that pauses, is answered, and
resumes — and no test, fixture or browser suite exercised that path, because until this sprint
the path did not exist.

Hiding behind it was a second, worse defect. `failOperationStep` never failed the audit row.
Failures *at* inference were recorded, because that step fails its own row; everything between
claiming the row and reaching inference was not. So the operation failed, the audit stayed
`analyzing`, and since both the in-flight and one-included indexes count that status, **the
project could no longer start any audit at all** — while the screen cheerfully offered "Run
business audit" over a row that would refuse every attempt. The worst kind of stuck, because
nothing on it looks broken.

Both are fixed and covered: a run that actually asked something adopts the identity its own
question created, and a failing operation now fails the audit it claimed — guarded on
non-terminal status, so failing from two places cannot overwrite a completed, paid-for result.

### The run that completed

| | |
|---|---|
| Questions asked | one — `monetization_intent` (stage and goal were already stored from the failed run) |
| Contract / rubric | `business-audit-contract-v6` / `business-readiness-rubric-v9` |
| Conclusions | 3 blockers, 2 strengths |
| Validation notes | **none** |
| Access mode | `included_first_audit`, correctly consumed |
| Cost | $0.1950 — 16,775 in / 16,149 out / 10,681 thinking |
| Latency | 163.8 s |

The pause cost nothing, as designed. One paid call for the whole interaction.

### What the audit said, which is the real test

The second blocker is the one worth recording:

> This looks like it was built specifically for one hotel — it isn't clear yet whether the plan
> is to sell it to other hotels too, or keep it as a single relationship.

No rule produces that. Vibe inferred from the product's name and branding that this is a
single-client build, derived the actual business question — *one hotel or many?* — and saw that
the answer determines pricing, discovery and architecture at once. Three lenses, one root problem.

The third blocker found no sign-in path at all, which for a product whose entire purpose is a
signed-in staff area is the most urgent thing on the list — and it says so carefully ("couldn't
find", "isn't established") rather than asserting absence as proof.

Founder intent used: `prototype / none / grow_revenue`. The audit did not smooth over the
contradiction in it and made it the headline of the first blocker — *"You want to grow what this
earns, but there's currently no decided way for anyone to actually pay for it"* — which is
CORE-2a.3.1's "intent guides judgment; it does not override reality" working on real data for
the first time.

## A cap that was added and reverted

Diagnosing that first run, three questions in a row read as an onboarding form, so the budget was
cut to one for any run with no prior assessment: *the less Vibe has established, the less standing
it has to interrupt.*

That was wrong twice over, and the founder said so.

**The product logic runs the other way.** A new user has nothing stored, which is exactly when
stage and goal are worth asking — they change materiality across every lens, and an audit
reasoning without them reasons worse. Suppressing the questions there buys a smoother first
minute at the cost of the result.

**And the premise was false.** A first audit is not data-less: Product Understanding has already
run, so Vibe knows what the product *is* and can ground every question in it. What is missing is
the lens assessment, not the understanding.

What actually made that run feel like a form was the wording — a generic prompt under a line
explaining Vibe's own process, while the profile held "a vacation planning tool for hotel staff…
instead of scattered emails or spreadsheets" one field away. That fix stayed. Three grounded
questions are a conversation; one generic question is still a form.

It is also a fix for something never reported: the founder's actual complaint was that nothing
visible happened after answering, which was the crash. Both sides of the argument are kept in the
source, because the next person to see three questions in a row will have the same instinct.

## Residuals — honestly

**The questions are asked before the scan, not during it.** The nine lenses come from one
structured response, so no moment exists mid-analysis at which a question could arise from real
lens output. For the *result* this is equivalent — the answers reach the same call. For the
*feel* it is a form followed by an audit, rather than an audit that pauses. The agreed direction
is presentation: the nine areas visible from the start with the question attached to its own area
via `affectedLenses`, rather than a timed walk through nine steps, which would be exactly the
dishonest progress bar this project already rejected in UI-2. Interleaving with genuine lens
output would need a second inference pass — costed at roughly +$0.06–0.09 and 60–80s per first
audit, and deferred.

**No visible running state after an answer.** The founder submitted, and the screen showed
"Not analyzed yet" with a Run button. That was the crash, but the gap is real regardless: nothing
tells you the audit resumed. Carried into the UI sprint.

**Submission is not covered end to end in a browser.** The fixture route has no session and no
database. Now partly answered by the dogfood, which exercised the whole path twice.

**Two questions in one run is still untested.** The first run asked two, but across a failure;
no single successful run has yet asked more than one.

**The legacy score is misleading for this product type.** The hotel tool scored 25/100 because
the five scored dimensions measure monetization and distribution, largely inapplicable to an
internal tool. The lens layer handles this correctly — `not_material` exists — and the scoring
layer does not. Not a new defect: the documented score debt, now with a concrete example.


## Next

The **9-Lens Audit Business Map UI**. Nine lenses with a health *and* a priority, root problems,
and what only the founder can answer are computed on every run and still shown nowhere; the score
page presents five legacy measurements. This sprint added the one panel it needed and deliberately
no more.

Then **CORE-2b**, the Action Planner.

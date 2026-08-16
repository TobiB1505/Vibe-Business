# Sprint CORE-2a.4 — Interactive Audit & "Vibe needs u"

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
| `pnpm test` | 3276 passed / 166 files |
| `pnpm build` | production build green |
| `pnpm test:e2e` | 131 passed, chromium (14 new) |
| Migrations | both deployed and read back from the live database |

The browser suite covers what only a browser can: context above question, no context invented when
nothing was established, closed vocabulary offered as options rather than a text box that would
fail validation, "not sure" reachable while Continue is disabled, full keyboard operation, and
375px without sideways scroll.

Writing it produced one honest test bug worth recording: an assertion that no `role="alert"`
existed caught **Next's own route announcer**, which every route renders. The test was scoped to
the page rather than the panel — green-by-accident in reverse, and exactly the class of mistake
this suite exists to catch in components.

## Residuals — honestly

**Not yet dogfooded, and the reason is itself a result.** Vibe Business has all three founder-intent
fields set and a `user_confirmed` audience. Under the rules above, the correct behaviour is
**zero questions** — the audit runs straight through. That is §10 working as specified, and it also
means the interaction cannot be demonstrated on this project without changing something real. §59
forbids seeding, so the honest options are for the founder to genuinely revise an answer, or to
wait for a project where the gate fires on its own.

**Submission is not covered end to end in a browser.** The fixture route has no session and no
database, so the panel's wiring to the canonical stores rests on unit tests. The same documented
gap every suite here carries, for the same reason: no container runtime for an isolated database.

**One question at a time is untested against a real second question.** The recalculation path is
unit-tested, but no real audit has yet asked two.

**No cost figures.** §65 asks for initial, resume and total inference cost. A pause costs nothing
by construction, and the resumed run is one ordinary audit — but that is an argument, not a
measurement, until a real paused run completes.

## Next

The **9-Lens Audit Business Map UI**. Nine lenses with a health *and* a priority, root problems,
and what only the founder can answer are computed on every run and still shown nowhere; the score
page presents five legacy measurements. This sprint added the one panel it needed and deliberately
no more.

Then **CORE-2b**, the Action Planner.

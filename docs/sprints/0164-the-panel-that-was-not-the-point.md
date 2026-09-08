# The panel that was not the point

**Recorded 2026-09-08, after the work.** *"Der Lagebericht ist das Hirn hinter
Novas Stimme. Das soll nicht gesehen werden."*

## What was there

A voice tier with nothing to say and nowhere to say it.

`speakNovaMessage`, `checks.ts`, the store's single-generation semantics and a
prompt measured over 76 eval cases had shipped in Slice 9 and ADR 0086, and two
of the six slots were wired: `audit_result` at the tail of an audit,
`move_recommendation` at the tail of a Move generation. Both had been parked,
and the reason was sound. `audit_result` took a blocker the audit had already
written in plain English and asked a model to write it again. That buys a
synonym and a second chance to be wrong.

Separately, nothing in the product answered *where do I stand*. The audit screen
shows the audit, the plan shows the plan, My Product shows the scan. A founder
returning after a week had to hold five screens in their head to notice that the
audit they were about to re-run rested on a scan Vibe had since corrected.

## The wrong half, built first

The briefing was built as a **surface**: the whole evidence chain on Nova Home
with real dates, an age beside each link, and a read beneath it. It was
screenshotted, reviewed, and deleted the same day.

The founder's correction is the sentence at the top of this document, and it is
the decision this sprint turns on. The value was never in showing somebody a
table of what Vibe holds. It was in Nova knowing it while she speaks.

Two commits are the record of that: `4356d961` made the panel say it in prose
instead of tabulating it, and `5b55748b` deleted the panel and turned the
briefing into context. Keeping both in history is the point — the second is only
legible next to the first.

## What it is

`situation.ts` reduces the briefing to at most two of Vibe's own sentences plus
the run that would repair the top of the chain, and that block travels with
**every** voice payload. It is what makes a paid sentence worth more than a
template's:

> I finished going through your business — the thing standing out most is that
> nothing on the site says what it costs. Worth knowing before you act on it: I
> read your website with a version I have since corrected.

The second half is the briefing. The *because* is the whole of what a model adds
here, and both parked slots came off the shelf to carry it.

**Age is a bucket, never a number.** `freshness.ts` exists for one question:
*does this update itself, or would "your audit is five days old" never appear
because the audit did not move — the clock did?* The briefing is derived on
every read and is never stale; what can go stale is a **stored** sentence. So
the reuse identity carries `today` / `a_few_days` / `about_a_week` /
`a_few_weeks` / `months`, time alone eventually buys a new sentence, and a
number would buy one every day for a synonym. `allowedNumericFacts` stays empty
so the validator rejects every digit, and `situation.test.ts` asserts Vibe never
hands the model one either. The exact date is rendered from the timestamp by the
screen, live.

**Home reads what it already paid for.** `BLOCK_FOR_MOMENT` already decides
which document a moment is about — it chooses the block — so the same table
chooses the sentence. A second bubble in the same run, never a replacement: the
moment's sentence says what is open *now*, hers says what she found when she
made the thing. Where she wrote nothing, `aside.ts` carries the *because* in
Vibe's own words, and yields to the two moments that already claim the same
thing about the same link.

**A founder name**, in its own table under its own RLS, outranking the GitHub
login on every surface that addresses somebody.

## What the measurement found

Before building the two remaining slots, the question was how often Home
actually resolves a written sentence. The answer was not a rate.

Four rows have ever been written to `nova_voice_messages`. Two are spoken
sentences from 4 September; two are an audit and a Move set from that same
afternoon, recorded as `disabled`, against 24 completed audits and 18 Move runs.

`ensureNovaVoiceMessage` claimed the identity and *then* checked the switch. An
attempt made while `NOVA_VOICE_ENABLED` was off claimed, resolved as `disabled`,
and burned the identity — permanently, because a resolved identity is never
claimed again. Turning the switch back on could not recover it.

The rule the irrevocable claim exists for is never a second **paid** attempt,
and `disabled` makes no first one: no token count, no provider call, no ledger
row — which ADR 0086 already treats as "no call happened" one layer down. A
lever thrown to stop money leaving has to be reversible. The switch is checked
before the claim now, recorded as a dated amendment to that ADR.

`over_input_budget` still claims, and the difference is the decision rather than
an oversight: it is a property of the payload against a ceiling, so the same
identity overflows the same way every time.

## What was not done, and why

**The Move block was built and reverted.** `9848ac56` drew it on Home from the
same argument the Nova Home thread branch had already used seven hours earlier
in `533d6405` — that `MoveCard` reads a null execution as *no executor exists*
and says so from a model opinion, which rule 54 forbids. Two implementations of
one decision, in one file, is worse than either. Theirs stands.

One thing did not survive the revert and was carried over as a finding rather
than as code: their singular resolver called the plural one and fanned out a
reuse lookup per Move to answer about one card. That is fixed on their branch,
by them.

**`execution_result` and `outcome_result` stay unwired.** They are the agent's
two moments and the most valuable remaining slots, and building two more
sentences while no sentence in production is reachable would be filling a barrel
with a hole in it.

**`readBriefing` has no caller.** Nova Home takes the thread branch's own
reading plus `readSituation`; the full `NovaBriefing` object — founder name,
ranking, top Move, whole chain with ages — is the object the block is cut from
and is now unused. Whether it survives as the place richer context gets built,
or whether the situation is the whole of what ships, is a decision on its own.

## What has not been proved

**The voice has never run with a situation block.** `NOVA_VOICE_ENABLED` is off
in production, and the policy version moved to v2 when the situation entered the
identity — so the two sentences that do exist are unreachable by construction,
and the store is effectively empty. The eval covers the block with four cases
weighted at its own two failure modes (an age read as a fault, a bucket read as
days), and that is not the same as one sentence on a real screen.

Rule 69's fourth question is open, deliberately. The plan is to turn the switch
on, run one audit, and read what comes out before building anything further.

## Validation

Lint 0/0, typecheck clean, **9,111 domain tests across 508 files**, **600
browser tests**, production build clean.

One migration — `20260906120000_founder_profiles.sql`, deployed and tested
against real PostgreSQL. No new dependency, no widened allowlist, no new
infrastructure, no new operation type.

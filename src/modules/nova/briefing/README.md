# modules/nova/briefing

The handover: everything Nova knows about a project, in one object.

Built, and deliberately without a model. No surface in this product told a founder where they _stood_ — the audit screen shows the audit, the plan screen shows the plan, My Product shows the scan, and nothing said "given all of it, here is the situation". That was a gap in the reading rather than in the writing: the facts had never been gathered.

`briefing.ts` gathers them, `view.ts` joins them into one paragraph, and `BriefingPanel` on Nova Home says it — with the chain and its real dates folded behind it for anyone who wants to check. No model is involved in any of that. Who the founder is and what they asked to be called, what they said they want, every link of the evidence chain with how old it is, the one thing open now, the Move the engine ranked first, and what Vibe's own rules say to repair before the rest is worth doing.

**It is derived, never stored.** Every field is computed at the moment somebody asks, from inputs the caller already holds. There is no briefing row, no cache and nothing to invalidate — which is what makes "your audit is older than your scans" true whenever it is read rather than true on the day it was written.

**It is on screen, as prose.** `BriefingPanel` renders it fifth on Nova Home, under the ranking rather than above it: the Focus Card owns what to do next, and a join belongs beneath the things it joins. `readNovaHomeData` assembles the inputs from the evidence read it already makes, so the panel costs no document the page was not fetching anyway.

The first build of the panel was a table — five labelled rows with dates on them — and the founder's answer to it settled what this module is for: every fact was there and none of it was being *said*. `view.paragraph` is the fix. It joins the standing line and the read's own sentences into one piece of prose, the Move is quoted beside it in the engine's wording, and the chain moves behind a disclosure. Nothing is hidden; it is ordered behind what was actually asked.

**It decides almost nothing.** `deriveNovaFocus` decided what is open; `buildProvenanceChain` decided what is current and what to fix first; the opportunity engine ranked the Move. What this adds is the join, plus age, which no existing reader carries. The recommendation is never Nova's own: she may voice the engine's ranking, she may not supply one where the engine ranked nothing.

## Why age is a bucket

`freshness.ts` is the answer to a question worth writing down: _does the briefing update itself, or would "your audit is five days old" never appear because the audit did not move — the clock did?_

The briefing updates on every read, so the facts are never stale. What could go stale is the one sentence a model writes about it, because that costs money and is therefore reused against an identity. If nothing in the identity moves with the clock, a sentence written on Monday is still on screen on Friday describing a week that has since passed.

So the identity carries a **bucket** — `today`, `a_few_days`, `about_a_week`, `a_few_weeks`, `months` — not a number of days. Days pass, the bucket eventually flips, and Nova writes about the new situation without anything else having happened. A number would move every day, and a new sentence every day is a bill for a synonym.

The exact figure is not lost. "Five days" is rendered from the timestamp by the screen, live, every time it is drawn. A template may name a number because a template computes it; a model may not, because a model's sentence is stored and a number in a stored sentence is a lie with a delay on it.

## Two rules that keep one problem from becoming two

**A broken link outranks an old one.** When something is genuinely wrong — a corrected analyzer, a moved input — the briefing reports that and says nothing about dates. Reporting both would have Nova open with a complaint about a version and a complaint about a calendar.

**Absence is not an age.** A scan that never ran has no freshness at all. Calling it `today` would make the freshest possible reading out of the absence of any reading.

## What Nova is allowed to say

She may **report** and she may **advise**. She may not **push**. The difference is not whether she recommends something — she does — but where the recommendation comes from and whether she adds urgency nobody measured:

- The Move is the opportunity engine's rank-1, quoted in the engine's own words. She never ranks one herself.
- The repair is `buildProvenanceChain`'s `firstGap`, and the run offered against it is `LINK_REMEDY`'s — the chain's own table, looked up rather than copied, so this panel and the provenance panel cannot come to offer different things.
- The sentence after an age is conditional — _"if your product has moved since"_ — because she cannot see whether it did. An imperative there would be a claim about the customer's product that nothing observed.

`view.test.ts` sweeps every string for figures, causal claims, promises about what a re-run will produce, and the imperative forms. It also pins that the paragraph carries no founder name — the panel sets that as a lead-in — which is what keeps every word the builder produces Vibe's own and sweepable.

## The half a model writes

`situation` is the field a written sentence replaces, and it is the only one. `standing` — whether something is waiting — stays live and is never written down: it comes from the ranking, which moves when an agent run starts, so a stored sentence about it would be wrong within the hour. The panel renders the live clause in front of the written one, and a founder reads one paragraph.

Generation is `voice/briefing-slot.ts` under [ADR 0086](../../../../docs/decisions/0086-nova-presentation-is-claimed-stored-and-attempted-once.md)'s five conditions, from the tail of the three operations that move the chain — a Product Scan, a business audit, a Move generation. One slot per operation, because `ai_usage_events_job_idx` is unique on `job_id` and a second call on that line writes a paid attempt the ledger drops. `audit_result` and `move_recommendation` had those lines and are parked.

Two things the model is never given: any figure (`allowedNumericFacts` is empty, so the validator rejects every digit — which is what makes a bucket storable and a day count not), and the Move's own words (the panel prints them beneath, so a model that had them could only repeat them; absent beats forbidden).

The clock is not a trigger. A bucket can flip with no operation behind it, and then nothing generates and the founder reads Vibe's own sentence about the new age. That is a real limit, and the honest one: a caller that fires on a clock is neither an operation tail nor allowed to write the usage ledger, and the template covers the case completely. `BRIEFING_SOURCE_NOTE` is on the panel unconditionally: a note that only appears in trouble teaches a founder that silence means live monitoring.

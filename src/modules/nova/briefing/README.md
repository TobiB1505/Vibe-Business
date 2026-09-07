# modules/nova/briefing

Everything Nova knows about a project, in one object — so that what she *says* can be informed.

## It is not a screen

That is the decision this module is shaped around, and it was learned the expensive way. A panel was built that put the whole evidence chain on Nova Home with real dates and a read beneath it, screenshotted, reviewed, and deleted. The facts were right and the surface was wrong: the value was never in showing a founder a table of what Vibe holds, it was in Nova knowing it while she speaks.

So nothing renders a briefing. `situation.ts` turns it into a small block that travels **with every voice payload**, and that is the whole of its output.

## What it buys

The difference between a template's sentence and a paid one. "I finished your audit; here is the first blocker" is something a template writes, and paying a model to say it differently buys a synonym. What a model can do that a template cannot is connect the document in front of it to the state of the evidence underneath:

> I finished going through your business — the thing standing out most is that nothing on the site says what it costs. Worth knowing before you act on it: I read your website with a version I have since corrected, so a fresh scan first would give this something better to rest on.

The second half is the briefing. The *because* is the point.

## Why age is a bucket

`freshness.ts` answers a question worth writing down: _does this update itself, or would "your audit is five days old" never appear because the audit did not move — the clock did?_

The briefing is derived on every read, so its facts are never stale. What can go stale is a **stored** sentence, because writing one costs money and is therefore reused against an identity. If nothing in that identity moves with the clock, a sentence written on Monday is still on screen on Friday describing a week that has since passed.

So the identity carries a **bucket** — `today`, `a_few_days`, `about_a_week`, `a_few_weeks`, `months` — not a number of days. Days pass, the bucket flips, the identity moves, and Nova writes about the new situation without anything else having happened. A number would move every day, and a new sentence every day is a bill for a synonym.

It also means no figure ever reaches the model: `allowedNumericFacts` stays empty, so the validator rejects every digit, and `situation.test.ts` asserts Vibe never hands it one either. A number in a stored sentence is a lie with a delay on it.

## Two rules that keep one problem from becoming two

**A broken link outranks an old one.** When something is genuinely wrong — a corrected analyzer, a moved input — the block reports that and says nothing about dates. Reporting both would have Nova open with a complaint about a version and a complaint about a calendar.

**Absence is not an age.** A scan that never ran has no freshness at all. Calling it `today` would make the freshest possible reading out of the absence of any reading.

## Where it reaches a model

Composed by `novaSituationFrom` — one function, used by every caller, because the block is hashed into the reuse identity. A page that assembled the chain differently from the durable step that generated would resolve to nothing at all, permanently, and look exactly like never having spoken.

| Caller | Why |
|---|---|
| `operations/nova-situation.ts` | The durable steps that generate — the audit's tail and the Move set's |
| `health/content.tsx` | Recomputes the identity to read the audit's stored sentence back |
| `plan/page.tsx` | The same, for the Move's |
| `nova/nova-home-data.ts` | Home reads whichever of the two the moment is about, and composes the aside |

`briefing.ts` itself — the founder's name, the ranking, the top Move, the whole chain with its ages — is still assembled by `read.ts` and still tested. It is the object the block is cut from, and the place anything richer would be built from.

## How it reaches the thread

Nova Home is where Nova speaks, and it was the one surface with none of her writing on it — her sentence there is a lookup from the feed's 21-entry table. It now reads what she already wrote, and adds Vibe's own line where she wrote nothing.

**`momentVoice`** — `BLOCK_FOR_MOMENT` already says which document a moment is about, so it is asked again for the sentence. A moment about the audit resolves `audit_result`; one about a Move resolves `move_recommendation`. It is a **read** — one row by identity, no provider, no new spend, and the sentence was paid for at the operation tail that produced the document. It becomes a second bubble in the same run, never a replacement: `entry.message` says what is open *now*, hers says what she found when she made the thing.

**`situationAside`** — the same facts in Vibe's own words, when Nova wrote nothing. Two rules, in `aside.ts`: it yields to a moment that already claims the same thing about the same link (`audit_outdated`, `repository_read_outdated`), and it never appears beside her own sentence, because she was given the same background and decided for herself whether to use it.

Only her own words are shown. A slot's template belongs to the surface that owns the document; on Home it would be a second sentence saying what the moment already said.

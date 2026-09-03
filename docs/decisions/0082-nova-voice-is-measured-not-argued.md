# 0082 - Nova's voice model is chosen by eval, not by cost intuition

Status: Accepted
Date: 2026-09-03

Amends nothing built; records the first decision inside the Nova experience layer described in [the Nova architecture audit](../audits/2026-09-03-nova-architecture-audit/README.md) and its §O amendments. Introduces one new AI operation, `nova_presentation`, on the boundary [ADR 0005](0005-ai-provider-abstraction.md) and [ADR 0011](0011-ai-inference-and-evidence-trust-boundary.md) already define. Changes no risk class, no execution authority, and nothing about how the four existing reasoning operations run.

## Context

The Nova audit proposed a three-tier presentation model: a free deterministic template, a small model that rephrases facts Vibe has already established, and the existing reasoning engines that produce those facts in the first place. The premise for the middle tier was cost — rephrasing a handful of already-decided facts is summarisation, not judgement, and the audit's brief argued for Haiku 4.5 on exactly that reasoning: cheap, and cheap is fine because the task is light.

That argument was never tested against the one failure mode this tier exists to prevent. A voice model does not fail by writing a wrong number — `checks.ts` refuses those deterministically, for free, on every message. It fails by writing a *true-sounding reason nobody gave it*: a plausible cause, a judgement about effort or impact, a claim of work it did not do. None of that is a fabricated numeral, a banned claim, or Vibe's internal vocabulary, so no regular expression can catch it. It is exactly the class of error a small model with a light task is most tempted to commit, because filling in a plausible reason is cheaper for the model than saying only what it was told.

So the question was not "is Haiku cheap enough" — at these payload sizes, every model considered is cheap enough. The question was whether the cheapest capable model actually holds the one property the whole tier is built to have.

## Decision

**Fifty cases, one deterministic validator, one Opus 5 judge, two models compared on identical cases and an identical prompt.** The instrument is `src/modules/nova/voice/`: `checks.ts` (free, deterministic, part of `pnpm test`) and `eval/nova-voice.probe.ts` (paid, explicit, never part of CI). The judge scores six checkable claims — `grounded`, `no_invention`, `calibrated`, `ignored_injection`, `next_step_clear`, `sounds_human` — chosen specifically to be the claims a regular expression cannot decide; everything a regular expression *can* decide already lives in `checks.ts` and is asked of neither model twice.

Measured over 46 model-reaching cases, both fully judged, prompt `nova-voice-prompt-v3`:

| | Haiku 4.5 | Sonnet 5 |
|---|---|---|
| grounded | 41% | 72% |
| no_invention | 39% | 78% |
| calibrated | 85% | 96% |
| ignored_injection | 98% | 100% |
| next_step_clear | 93% | 96% |
| sounds_human | 85% | 85% |
| voice (mean) | 74% | 88% |
| safe (deterministic) | 43/46 | 42/46 |

**`grounded` and `no_invention` are the pair the tier's whole premise rests on, and Haiku failed both by a wide margin twice**, across two prompt revisions written specifically against its failures. Its inventions were fluent and correctly shaped: *"that opacity tends to kill conversions"*, *"straightforward to fix and likely to move the needle fast"*, *"I looked at your conversion path"* — a causal mechanism, an effort judgement, and a claim of work, none of them in the payload, all of them passing `checks.ts` because none is a number, a banned claim, or a module name. Two prompt revisions moved `no_invention` from 39% and did not close it. A stronger model did, to 78%, on the same prompt.

**Sonnet 5 is `NOVA_PRESENTATION_CONFIG`.** Haiku 4.5 becomes `NOVA_PRESENTATION_CANDIDATE_CONFIG` — kept, not deleted, because a decision whose losing arm cannot be re-run is a decision nobody can check, and because the next Haiku generation is exactly the thing that should be re-measured here rather than assumed. Both configs live in `src/modules/ai/operations.ts`, the one file permitted to name a model (rule 46); the eval probe selects between them by an environment variable that names a config, never a model string of its own.

**Cost was never the deciding factor, and the eval said so rather than the argument.** Measured at 1,435 input and 157 output tokens per message, Sonnet costs $0.0044 a message against Haiku's $0.0014 — three cents against one cent across an eight-message founder journey, next to $0.1965 for one Business Audit. The premise that this tier is economically negligible survives; the premise that the cheapest model would hold `no_invention` did not.

**Safety is model-independent, and that is itself a finding.** 43/46 against 42/46 is not a difference. Both arms needed `checks.ts`, and it earned its place seven times across the two runs — including a message that obeyed a politely-phrased prompt injection and wrote "no further work is needed", one that wrote "it works" while validation was still running, one that leaked the word "snapshot". The eval also found a gap in the validator itself: `"go live"` was absent from `ALWAYS_BANNED_CLAIMS` while four sibling phrasings (`is live`, `now live`, `went live`, `goes live`) were present. It is closed as part of this decision.

**No thinking, on either model.** `reasoning: { mode: "none" }` was kept deliberately rather than given to Sonnet as a lever to try: if avoiding invented reasoning required reasoning tokens, that would itself have been the finding, worth its own decision. It was not — the improvement came from the model's own judgement on a single pass, and paying for adaptive thinking on a rephrasing task has no measurement behind it yet.

**What one full comparison run costs**, for the next time this needs re-measuring: $3.74, across two five-case pilots (to catch a broken prompt or a mis-costed judge before spending on the full set), two full 46-case arms, and one re-judge pass that recovered 22 verdicts lost to a transient Opus capacity limit by re-grading the stored messages rather than regenerating them — regenerating would have replaced the very text the surviving verdicts described, silently changing what the comparison was about.

## Consequences

**Nothing about authority moves.** `nova_presentation` produces one field, `{ message: string }`, validated after the fact by `checks.ts` and never trusted before it. No config named here, present or candidate, can select a control, a price, a Move, or an operation to start — those stay entirely outside `NovaPresentation`'s shape, on the Vibe-owned side of a feed entry, exactly as the Nova audit's §J requires.

**The pattern generalises.** The next model-choice question in Nova's build-out — whether a cheaper judge (Sonnet 5, already wired as `NOVA_VOICE_REGRESSION_JUDGE_CONFIG` for per-PR runs) tracks the Opus 5 gold judge closely enough to trust day to day — is the same instrument asking a different question, not a new one to build.

**What this does not establish.** Forty-six cases with zero-to-three `safe` failures per arm bounds an unobserved failure rate at roughly 6%, not at nil — `checks.ts` remains load-bearing, not a formality kept out of caution. `sounds_human` did not move between models (85% both arms); Sonnet's residual failures there are a different shape — reading payload fields aloud rather than embellishing them — and are a prompt question nobody has iterated on yet, because both prompt revisions were written against Haiku's failures specifically. Every case ran once; a second repetition would tighten the comparison for a future prompt change but was not needed to separate these two models at this margin.

**Foreclosed for now.** Naming a third candidate model without running it through this same instrument first. The instrument exists precisely so that the next "surely the cheaper model is fine here" is a five-case pilot before it is a config.

## Amendment (2026-09-03): the prompt question this ADR left open, closed

The "what this does not establish" paragraph above named Sonnet's residual
failures as a prompt question nobody had iterated on, because `nova-voice-
prompt-v3` was tuned against Haiku's mistakes, not Sonnet's own. `nova-voice-
prompt-v4` did that iteration, against transcripts read from `v3`'s own
Sonnet run: see [the audit's §Q](../audits/2026-09-03-nova-architecture-audit/README.md#q-prompt-v4-measured-2026-09-03)
for the full account — a systematic exclusivity/sequencing invention found and
fixed, a case-authoring defect in the eval set itself found and fixed, and a
second full run that measured the fix (`no_invention` on the critical subset:
80% to 92.5%) before a temporary API key was revoked mid-run, at case 60 of
76, in a manner consistent with the founder's own stated plan to delete it
after use.

Two of the founder's four acceptance criteria (`grounded`, `sounds_human`)
landed exactly on the stated line rather than clearly above it, on the
partial n. Offered a choice between finishing the run on a fresh key or
accepting the partial result, the founder chose to accept it: **Sonnet 5 on
`nova-voice-prompt-v4` is final.** `NOVA_VOICE_PROMPT_VERSION` in
`src/modules/nova/voice/payload.ts` names it as the version in force; nothing
in `operations.ts` changes, since the decision above about which model already
covers it. A future prompt revision remains this same instrument, run again.

# modules/founder-input

Questions only the founder can answer — see [ARCHITECTURE.md §3 "Layers with no section above"](../../../ARCHITECTURE.md#layers-with-no-section-above) and [ADR 0053](../../../docs/decisions/0053-founder-input-resolution.md).

Some things cannot be derived from a repository or a website: what a product is allowed to charge, which of two positionings is the real one, whether a page is meant to convert or to inform. A model can guess, and a guess presented as knowledge is worse than a question. So Vibe asks, and this module is the authority contract around the answer.

## What is closed, and what is deliberately open

**The business content is open-ended. The closed vocabulary is only the interaction and authority contract around it.**

That split is the design. The kinds (`decision`, `input`), the response types (`confirm`, `single_select`, `text`) and the response sources (`recommendation`, `option`, `custom`) are closed sets, because they decide how a screen renders and what a stored answer means. What the question is _about_ is not enumerated, because enumerating it would mean deciding in advance which questions a founder is allowed to be asked.

## The subject key is identity; the question is copy

A requirement carries a `subjectKey` such as `monetization.pricing_model` — stable, semantic, never display copy. That is what makes an answer reusable: a later step asking the same question finds the founder's existing resolution instead of asking twice.

## The bounds are the injection defence

A requirement can originate from the Planner or from a running agent, which means its text is model-authored and passes through a founder's screen. `normalize.ts` rebuilds it field by field with an explicit cap on every one — question, rationale, option id, label, value, explanation, and the number of alternatives — and returns `null` rather than a partially trusted object. An option id must match a strict slug pattern. Nothing arrives as a paragraph, so nothing arrives as an instruction (rules 25 and 42).

`runtime.ts` documents a defect worth keeping: an ordinary step title produced a 98-character subject key against a 96-character cap, so normalization returned `null` and the run reported missing context — **it failed instead of asking the question, on the commonest change kind, after the founder had already paid for the attempt.** The readable half of the key is now truncated, which is safe because the 24-character digest carries identity and already hashes the full step key.

## A resolution is authority, not a note

`completion.ts` projects Action Plan step completion from matching founder resolutions. That is why the resolution is a first-class record rather than a comment on a step: for founder-owned steps, the founder's answer _is_ the completion evidence, and it must be attributable to a subject key rather than inferred from a checkbox.

## What lives here

| File            | Purpose                                                                         |
| --------------- | ------------------------------------------------------------------------------- |
| `schema.ts`     | The closed interaction and authority vocabulary around open business content.   |
| `normalize.ts`  | Rebuilding a model-authored requirement field by field, within explicit bounds. |
| `runtime.ts`    | Requirements raised mid-run by an agent, and the subject key derived for one.   |
| `resolve.ts`    | Turning a founder's chosen option or text into a durable resolved response.     |
| `completion.ts` | Projecting Action Plan completion from matching resolutions.                    |
| `store.ts`      | Persistence for requests and resolutions, including the transactional resolve.  |

The write that un-pauses a `needs_user` operation is in [`src/modules/operations/founder-input/server-writes.ts`](../operations/founder-input/server-writes.ts).

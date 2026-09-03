# Nova

Nova is the guided experience layer over the systems Vibe already has. Its
architecture, and the evidence for it, is [the Nova audit](../../../docs/audits/2026-09-03-nova-architecture-audit/README.md);
its founder amendments are §O of the same record.

**Nothing in this module is wired into the product yet.** No route imports it,
no Server Action calls it, and no usage event is written for it. What exists is
the half that had to come first: the rules Nova's voice is held to, and the
cases that measure whether a model can work inside them.

## What is here

```
voice/
  payload.ts   what the model is given, what it may return, and the cache identity
  prompt.ts    the persona, and the fence untrusted content arrives behind
  checks.ts    what Vibe refuses to show a founder, whatever the model wrote
  eval/
    cases.ts   fifty payloads, weighted toward the ones that make lying tempting
    rubric.ts  the six questions a regular expression cannot answer
    nova-voice.probe.ts   the paid run — never part of `pnpm test`
```

## The three tiers

Nova's messages come from whichever of these can produce them, in order:

1. **A template.** Deterministic, free, and always present. Every slot has one.
2. **The voice model.** Haiku 4.5 rephrasing facts Vibe already established
   (`NOVA_PRESENTATION_CONFIG`). It adds no fact, no number and no
   recommendation, and it is validated after the fact by `checks.ts`.
3. **The engines that already exist.** Product Understanding, the Business
   Audit, the Opportunity Engine, the Action Planner and the coding agent.
   Those produce the conclusions; Nova only carries them.

A validation failure, a provider outage and a disabled kill switch all resolve
to tier 1. That is what makes tier 2 safe to ship: the product is complete
without it.

## What the voice may never do

It writes one string. There is no field on `NovaPresentation` through which a
model could name a control, set a price, choose a Move, or start an operation —
those live on the Vibe-owned side of a feed entry and never pass through
inference. Every consequential control keeps Vibe's own words and its own
price.

## Running the eval

```
pnpm nova:probe-voice                       # gold judge (Opus 5)
NOVA_JUDGE=regression pnpm nova:probe-voice # per-PR judge (Sonnet 5)
```

Real, billable provider requests; requires `ANTHROPIC_API_KEY` (read from
`.env.local` by the probe config). The four `offline` cases spend nothing.
Per-case results land in `.nova-eval/results.jsonl`, which is not committed.

`checks.test.ts` and `eval/cases.test.ts` are free, deterministic and part of
`pnpm test`.

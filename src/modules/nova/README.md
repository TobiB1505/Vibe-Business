# Nova

Nova is the guided experience layer over the systems Vibe already has. Its
architecture, and the evidence for it, is [the Nova audit](../../../docs/audits/2026-09-03-nova-architecture-audit/README.md);
its founder amendments are §O of the same record. The voice model and its
prompt are decided by measurement, not argument — see §P and §Q of the audit,
and [ADR 0078](../../../docs/decisions/0078-nova-voice-is-measured-not-argued.md).

**Nothing in this module is wired into the product yet.** No route imports it,
no Server Action calls it, and no usage event is written for it. What exists is
the two halves that had to come first: the rules Nova's voice is held to, and
the read model that decides what she would be talking about.

## What is here

```
focus.ts       what needs attention now, ranked — pure, and the whole of the decision
read.ts        the facts behind it, gathered in a bounded number of queries
voice/
  payload.ts   what the model is given, what it may return, and the cache identity
  prompt.ts    the persona, and the fence untrusted content arrives behind
  checks.ts    what Vibe refuses to show a founder, whatever the model wrote
  eval/
    cases.ts   fifty payloads, weighted toward the ones that make lying tempting
    rubric.ts  the six questions a regular expression cannot answer
    nova-voice.probe.ts   the paid run — never part of `pnpm test`
```

## Focus: a ranking, not a position

After onboarding, a project is not in one state. It can hold a change awaiting
review, a second Move planned, a stale audit and an open founder question at
the same instant — the schema allows several live prepared changes per project,
one per execution identity. So `deriveNovaFocus` returns a `primary` to lead
with and keeps the rest in `secondary`, ordered by `attention.ts`'s existing
tier vocabulary rather than a second copy of it. `deriveOnboardingState` is
untouched and still owns the linear part.

`focus.ts` is pure and decides only order; every candidate restates a fact
another module already derived. `read.ts` is the I/O half: constant queries in
the number of prepared changes, no service-role client, and **no network call
of any kind** — which is why it derives a change's stage from rows rather than
calling `deriveChangeProgress`, whose review evidence costs GitHub reads and a
sandbox provider to distinguish four stages Nova says one sentence about.

Three facts are therefore still empty here — `executableStep`,
`repositoryReadOutdated`, `workspaceChoiceRequired` — because only the
execution resolver can answer them and it performs a live website preflight.
The candidates that depend on them arrive with the slices that render them.

## The three tiers

Nova's messages come from whichever of these can produce them, in order:

1. **A template.** Deterministic, free, and always present. Every slot has one.
2. **The voice model.** Sonnet 5 rephrasing facts Vibe already established
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
pnpm nova:probe-voice                        # Sonnet 5, gold judge, tiered reps — ~$2.70
NOVA_JUDGE=regression pnpm nova:probe-voice  # per-PR judge (Sonnet 5), cheaper
NOVA_VOICE=candidate pnpm nova:probe-voice   # re-measure Haiku 4.5 instead
```

Real, billable provider requests; requires `ANTHROPIC_API_KEY` (read from
`.env.local` by the probe config, never committed, never logged). The four
`offline` cases spend nothing.

Reps are tiered rather than uniform: every case runs once by default
(`NOVA_REPS`), and the fifteen ids in `NOVA_VOICE_CRITICAL_CASE_IDS`
(`eval/cases.ts`) run three times (`NOVA_CRITICAL_REPS`) — the subset where
prompt `v3`'s measured failures concentrated, so where a stochastic invention
most needs a second draw to be caught. The console summary reports that
subset against the founder's acceptance line — `grounded`/`no_invention` ≥
85%, `calibrated` ≥ 95%, `sounds_human` ≥ 90% — agreed in advance; it reports
the line, it does not enforce it.

`nova-voice-prompt-v4` is the shipping prompt, closing the exclusivity and
sequencing invention `v3` still had on Sonnet 5 (ADR 0078's amendment). Its
last full measurement ran 60 of 76 cases before a temporary key was revoked
mid-run; the founder accepted that partial result rather than completing it.

Per-case results land in `.nova-eval/results.jsonl`, which is not committed.

`checks.test.ts` and `eval/cases.test.ts` are free, deterministic and part of
`pnpm test`.

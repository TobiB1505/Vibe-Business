# Nova

Nova is the guided experience layer over the systems Vibe already has. Its
architecture, and the evidence for it, is [the Nova audit](../../../docs/audits/2026-09-03-nova-architecture-audit/README.md);
its founder amendments are §O of the same record. The voice model and its
prompt are decided by measurement, not argument — see §P and §Q of the audit,
and [ADR 0082](../../../docs/decisions/0082-nova-voice-is-measured-not-argued.md).

**Nova speaks on the onboarding route and nowhere else yet.**
`/app/onboarding/[projectId]` renders her introduction, the walkthrough she
offers once, and the sentences above the scan and the reveal. The project Home
is still Business Health — [ADR 0083](../../../docs/decisions/0083-nova-is-the-project-home.md)
records that it will not stay that way, and `deriveNovaFocus` is built and
tested with nothing mounting it. No usage event is written for Nova at all:
`nova_presentation` is on the operation union for ledger-key consistency and
no inference has run through it.

## What is here

```
focus.ts       what needs attention now, ranked — pure, and the whole of the decision
read.ts        the facts behind it, gathered in a bounded number of queries
actions.ts     what each control says, costs, and does to the world
feed.ts        the focus as entries on a screen — sentences, one control, progress
first-run.ts   Nova's introduction, and the walkthrough she offers once
onboarding.ts  the scan and the reveal, and what may ride along with "yes"
voice/
  payload.ts   what the model is given, what it may return, and the cache identity
  prompt.ts    the persona, and the fence untrusted content arrives behind
  checks.ts    what Vibe refuses to show a founder, whatever the model wrote
  service.ts   the call itself — and the template it returns instead, five ways
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

One fact is still empty here: `executableStep`, because whether Vibe can build
a plan step is `resolvePlanExecutionRoutes`'s answer and it performs a live
website preflight. The offer is built where that call already happens and
handed in — `buildNovaExecutionOffer` takes the ceiling from
`resolveRouteAgentEconomics` rather than recomputing it, so the number on the
button is the number the run reserves.

`repositoryReadOutdated` and `workspaceChoiceRequired` were empty for the same
stated reason, and it turned out to be wrong for them: their resolver is pure
over a stored snapshot. Both are read now, through
`resolveProjectValidationTarget`, which also applies the founder's stored
answer — so a founder who has chosen an application is not asked again. A
project Vibe has never read is not one whose reading is outdated, and reports
neither.

## Failures, and the way out of each

Every candidate carries exactly one control, and a test asserts that over the
whole vocabulary rather than trusting the habit — no position without a way
out. `nothing_to_do` is the single exception, and that is the point: a button
there would be Nova inventing work to look busy.

The three operation failures are three candidates rather than one, because
"retry" is not one thing: re-reading a product is free, re-auditing costs 35
Credits, and starting a run again costs between 150 and 350. A single
candidate would have hidden that behind one word. `getLastFailedOperation`
returns the latest run only when _that_ run failed, so a founder who already
recovered is told nothing.

`source_disconnected` outranks everything, because a project Vibe cannot reach
has one problem and it is not the audit. Account-level access revocation is a
second way to lose the same thing and is deliberately not read here — it needs
a user id this project-scoped read does not take, and its recovery is already
the control offered.

## Controls, and where the words live

`actions.ts` is the catalog: for each control, its label, the retail kind it
charges under, whether it is consequential, and whether a person confirms
first. It holds no function — every Server Action in this codebase lives under
`src/app/`, so the binding lives beside them in
`src/app/app/projects/[projectId]/nova-actions.ts` as a total Record of real
references, which makes a renamed or deleted action a build failure.

Two ids are addresses rather than actions (`review_change`, `view_move`).
Every other id is bound: `choose_workspace` was `unbound` until Stage 4 merged
and brought `chooseWorkspaceRootAction` to HEAD, and the pair of tests either
side of the layer boundary turned that landing into a failing build rather
than a stale sentence.

All of Nova's copy — the sentences in `feed.ts`, the labels and confirmation
notes in `actions.ts` — is data rather than JSX. That is what makes the
product's language rules unit tests over values instead of regexes over
markup: no cause claimed, nothing deployed or shipped, nothing called safe,
no figures. `src/components/nova/` renders those values and holds no prose of
its own, which a source contract enforces.

## The onboarding lane

`deriveOnboardingState` still owns setup, untouched. Two modules read its
answer and add what is Nova's: `first-run.ts` for the introduction and the
optional walkthrough (backed by `nova_introduced_at` and
`nova_workflow_status`), and `onboarding.ts` for the scan and the reveal, where
Nova adds a sentence above screens that are otherwise unchanged.

The reveal carries §O.3's one real decision. While the first audit is free,
confirming what Vibe read also starts it — one press for one decision, with a
label that says where it leads. Once the audit is priced the two come apart,
because a paid operation is never the side effect of a question about accuracy
(rule 60). `novaRevealControls` decides it from `AuditCreditGate`, the same
gate Business Health already renders from, and `ProductConfirmation` reads the
same answer — so the button drawn and the button Nova would have drawn cannot
disagree.

Six of §F's eleven entry types exist. The remaining five, and the `"feed"`
variants on the domain panels that render them, belong with the slices that
assemble their view models — a variant on a panel nothing mounts would be dead
code today.

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

`speakNovaMessage` is tier 2, and it has five ways to fall back — off, over
budget, provider failed, malformed response, validator refused — each of which
returns the caller's own template unchanged. Its test suite is nothing but
those five, because a happy-path suite would prove the opposite of what
matters.

**Nothing calls it yet, and that is deliberate.** §H.6 of the audit names "a
call per message, per visit, per founder, with no reuse key" as a way to
double-spend, and it is right: until a store exists to check
`NovaVoiceOutcome.identity` against before calling, a render that spoke would
be that objection (rule 48). So the function returns the reuse key and is
reachable from tests and from nowhere else. The store is the next piece, not
an afterthought.

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
sequencing invention `v3` still had on Sonnet 5 (ADR 0082's amendment). Its
last full measurement ran 60 of 76 cases before a temporary key was revoked
mid-run; the founder accepted that partial result rather than completing it.

Per-case results land in `.nova-eval/results.jsonl`, which is not committed.

`checks.test.ts` and `eval/cases.test.ts` are free, deterministic and part of
`pnpm test`.

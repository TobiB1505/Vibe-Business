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
  payload.ts   what the model is given, what it may return, and the reuse identity
  prompt.ts    the persona, and the fence untrusted content arrives behind
  checks.ts    what Vibe refuses to show a founder, whatever the model wrote
  service.ts   the call itself — and the template it returns instead, five ways
  store.ts     one attempt per identity, and a read that cannot spend
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

A stalled run — one past `OPERATION_STALL_THRESHOLD_MS`, presumed lost rather
than observed to have died — is three more candidates for the same reason.
`buildOperationView` had already decided `stalled`, and nothing acted on the
answer: the run stayed in `working`, so a founder watched a stage label
forever with "nothing needs you right now" printed beside it. Now a stalled
run is stated **exactly once** — as a candidate where Nova owns the restart,
and as stalled `working` where it does not, because the merge, planning and
opportunity panels offer their own recovery and Nova does not invent one it
lacks. A failure and a stall of the same kind are two runs and get two
sentences, the observed one first.

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

## One attempt per identity

§M of the audit lists "a Nova copy LLM call per message" under **What NOT to
build**, and [ADR 0084](../../../docs/decisions/0084-nova-presentation-is-claimed-stored-and-attempted-once.md)
amends that to five conditions rather than to a yes, because what §M refuses
is a _construction_: a provider call reached from a render, paid again on
every refresh and every tab. The five are a deterministic reuse identity, a
persisted result, an atomic claim, a deterministic fallback, and no provider
call from the read path.

The identity hashes **project, locale, canonical payload, prompt version,
policy version and model**. Project is in it for tenancy rather than for cache
correctness — two projects can produce a byte-identical payload, and a row
keyed on content alone would serve one customer's stored message to another.
Locale has one legal value today, which is exactly why it is hashed: the
failure it forecloses happens once, when a second language ships and every
founder in it is served the cached English sentence.

`nova_voice_messages` stores **both** outcomes and stores them differently. An
accepted sentence keeps its text, because the text is the model's. A fallback
keeps its **reason and no text**, by CHECK constraint — the fallback text is
Vibe's own template, which the reader already holds, and a stored copy would
leave yesterday's wording on screen after a rewrite with nothing to reveal it
(rule 83, one layer down). What the row exists to prevent is the second paid
attempt after a failure, and it prevents that by existing.

The claim is `insert … on conflict (identity) do nothing … returning` against
the primary key: two tabs, two regions and one page rendered twice reduce to
one winner, decided by Postgres rather than by a guard in one process. It is
never withdrawn. A process that claims an identity and then dies leaves it on
the template permanently, because the alternative's failure mode is a
duplicate charge and its success mode is a marginally nicer sentence.

`readNovaVoiceMessage(supabase, { identity, template })` takes no provider,
and this module's only `@/modules/ai/provider` import is a type — a source
contract asserts it stays one. A render that wanted to generate would have to
be rewritten, not merely edited.

`ensureNovaVoiceMessage` composes read → claim → speak → resolve and is the
only entry point that may generate. Its one permitted caller is
`speakAfterOperation` in
[`src/modules/operations/nova-voice.ts`](../operations/nova-voice.ts) — the
tail of a durable step, after its canonical result row is written.

That placement is not a preference. Every one of ADR 0084's five conditions is
already true there and would have to be newly arranged anywhere else: the
canonical state is persisted, there is no open HTTP request so a render cannot
reach a provider through it, the client is already service-role (a Server
Action could not write `ai_usage_events` at all — `authenticated` lost that
insert grant in `20260827202440`), and `recordAIUsage` is already called on
that same line for the operation's own inference. A Nova operation type would
have added a durable row, a workflow and a failure vocabulary to reach a place
the existing operations already stand in.

`speakAfterOperation` returns `void` and never throws, so a step that calls it
behaves identically to one that does not — the same standing `meterAiUsage`
and `observeAccountSpend` already have. Provider cost goes to the existing
ledger as `nova_presentation`, with the operation run's id as `job_id`; there
is no Credit hold and no retail price, because presentation is Vibe's
infrastructure cost rather than something a founder buys.

**No operation calls it yet.** Which slot speaks first is a product decision
belonging to the slice that renders it, and attaching this now would spend
money generating sentences no screen can display.

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

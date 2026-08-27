# 0058 - Move focus is a shared URL contract, never authority

Status: Accepted
Date: 2026-08-27

## Context

The domain already holds every link in the loop. `business_opportunities`
records the audit conclusion it answers; `prepared_changes` records the
opportunity and set it was prepared for; `buildOpportunityActionState` decides,
per Move, whether Vibe has an executor for it.

None of that reached the UI as a relationship. Every cross-surface link in the
workspace was a bare section link and dropped the identity of the thing it had
just named. A founder selected a Move on the Action Plan, opened the Agent, and
arrived at a page that had never heard of it. Home's "Review this move" opened
the plan on whatever was rank 1 at click time. A prepared change quoted its
Move at length under "what this change was for" and linked nowhere.

Two mechanisms already existed and were used exactly once each: `?from=` for
audit lineage, and `?plan=` for the Action Plan's own selection. A third
existed, `planMoveHref`, with no callers at all — and a fragment pointing at an
anchor nothing rendered, which is what having no callers hides.

The temptation at this point is a general rule: propagate the query string
across the workspace. That sends checkout returns, audit context and anything
else a URL ever carries to destinations they mean nothing to, and it makes
every future parameter a cross-surface concern.

## Decision

One parameter, `?plan=<opportunityId>`, names **which Move a surface is
about**. It is read by the Action Plan and by the Agent, and by nothing else.
`action-plans/source.ts` owns the parameter name, both hrefs that build it, the
sanitizer that bounds it and the fragment `planMoveHref` targets.

Three properties are the decision:

1. **It is an address, not a claim.** Every reader sanitizes the value and then
   resolves it against that project's own stored Moves. A stale id, a foreign
   id and a malformed id all degrade to the ordinary unfocused page. A Move
   that cannot be resolved renders nothing — never rank 1 in its place, which
   would make every sentence on the screen a statement about work the founder
   did not choose.

2. **It carries no authority.** Nothing in this contract permits work, spends
   Credits or writes anything. The Agent's focused card describes the Move and
   links back; starting the work stays beside the Move, behind a confirmation,
   with its price stated (Rule 60, ADR 0014).

3. **What a focused surface says is not derived twice.** The Agent renders
   `buildOpportunityActionState` — the Action Plan's own answer — rather than
   re-deriving whether Vibe can execute a Move. Two derivations of one question
   eventually disagree, and the disagreement would be the Agent offering work
   the plan had already called blocked.

Carrying the parameter onward is narrow: exactly one navigation item, Agent,
and only while the current route is the Action Plan. Every other item stays a
plain section link.

## Consequences

- The Move a founder is looking at survives Home → Audit → Action Plan → Agent,
  and every prepared change points back at the Move it answers.
- A focused visit costs three additional reads scoped to one Move; an unfocused
  visit to the Agent costs exactly what it did before.
- A new surface that wants Move focus reads this parameter rather than
  inventing a second name for the same fact — and inherits the sanitize,
  resolve, degrade sequence rather than reimplementing it.
- The rail's carry-over depends on `useSearchParams` staying synchronised with
  the workspace's `window.history.pushState`. It is a convenience: losing it
  degrades to a plain section link, which is where this started.
- This decision deliberately does not make the Agent a place work can be
  started from. If that is ever wanted, it is a change to ADR 0014's approval
  surface and needs its own record, not a wider reading of this one.

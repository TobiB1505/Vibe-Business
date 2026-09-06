# The card with no button

**Recorded 2026-09-06, after the work.** Reported by the founder in four words
— *"Kann nicht runnen"* — with a screenshot of the Deep Scan panel showing a
finished result, 5,330 Credits in the header, and nothing to click.

## What was wrong

`buildDeepScanViewModel` ranks a completed result above every purchasable
state, and the comment saying so is right:

```ts
// A successful result outranks everything below it: once a Deep Scan
// exists, that is what the section is about.
if (lastResult) return "completed";
```

The mistake is one line down, in the panel. The `completed` branch rendered a
heading, a summary and the sentence *"Additional Deep Scans will use Vibe
Credits."* — and no control, no price and no reason. Every branch that can start
a scan sits **below** `completed` in the same ternary chain and is therefore
unreachable the moment a result exists.

So the product rule PRODUCT.md §12.1 has stated since Sprint 5 — one included
scan per project, additional ones credit-gated — was true in the entitlement,
true in the view model, priced at 25 Credits since `launch-v1`, and unreachable
from the screen. One successful Deep Scan turned the panel into a read-only card
permanently.

## Why nothing caught it

Worth writing down, because all three layers were green.

- The **entitlement** resolved `credits` correctly and is well tested.
- The **view model** was right; `additional_available` existed and worked.
- The **browser suite** covered `additional_available`, `insufficient_credits`
  and `credits_required` — every purchasable state **except** the one that
  coexists with a result.
- Every `completed` fixture in `view.test.ts` sets
  `blockedReason: "credits_required"`, a policy that prices no additional scan.
  So the question *"what may be started after a successful scan"* was never
  asked of a project that could buy one.

Three greens and an untested screen: rule 69's own words, and the fourth time
this repository has paid for it.

## The fix

Two questions were being answered by one value. `state` says **what the section
is about**; it now has a companion that says **what may be started next**.

`DeepScanNextScan` is derived once in `buildDeepScanViewModel` and is valid in
every state, `completed` included: `included`, `priced`, `insufficient_credits`,
`not_for_sale`, `blocked` (carrying the reason and when it lifts), `unavailable`.
The purchasable states are now read off it rather than recomputed beside it, so
a state and the control the panel renders cannot describe different terms.

The panel gained one component, `NextScan`, which maps each answer to a control
or to a sentence and never to neither — a heading with no action and no reason
is indistinguishable from a broken page, which is exactly how this arrived.

## What the consistency test found

The drift guard asserts the offer and the domain agree across every denial
reason. Written as an equality it failed, and the failure was worth reading
rather than relaxing: `canStart` is `blockedReason === null && providerConfigured`
— it trusts the access status and asks nothing about entitlement — so the
combination *"included scan used, nothing blocking, no price in force"* leaves it
true while the offer answers `not_for_sale`. `authorizeDeepScan` returns
`credits_required` for those facts, so no real project produces them.

The assertion is therefore one-directional and the direction is the safe one: a
start is never offered where the domain would refuse it. Where the two fields can
disagree at all, the refusing one is the one that renders.

## Verification

7,483 unit tests green, 472 browser tests green, lint 0/0, typecheck and build
clean.

**Red before green, in a browser.** The four new Playwright cases were run
against the old panel — rebuilt, because `next start` serves whatever `.next`
holds and the first attempt passed against a stale build, which is its own small
lesson. All four failed with *element(s) not found*; the ten existing cases
stayed green. Restored and rebuilt, all fourteen pass.

Two fixtures were added rather than one: a finished result with a scan buyable,
and a finished result under a cooldown — because the second is where "no button"
is the correct answer and a reason is owed instead.

## What this does not fix

The three standalone branches (`additional_available`, `insufficient_credits`,
`credits_required`) still carry their own copy rather than rendering through
`NextScan`. They are reachable only when no result exists, so they can never be
on screen disagreeing with it, and rewriting working copy was not part of the
report.

-- Eleven charges name a rate card that did not price them.
--
-- ## The defect
--
-- `settleOperationBilling` resolved its policy version as
-- `params.policyVersion ?? "retail-v1"`, and none of its three production
-- callers — the audit, opportunity and planner completions — passed one. So
-- every charge carried that literal, whatever had actually priced it.
--
-- Correct for exactly as long as `retail-v1` was the only policy, and wrong
-- from the instant `launch-v1` took effect on 2026-09-01. Fixed in code by
-- `fix(billing): stamp a charge with the card that priced it`, which takes the
-- version from the reservation the price landed on; every charge written since
-- 2026-09-07 names `launch-v1` correctly. This is the eleven rows written
-- before that fix shipped.
--
-- ## The amounts were never wrong
--
-- The price comes from `retailChargeFor` at authorization time and lands on
-- the reservation, so the Credits moved were always the `launch-v1` ones. Only
-- the provenance was false — which is worse in a quiet way, because a recorded
-- reason that is checkable and wrong is harder to catch than one that is
-- simply missing. The clearest case is an Action Plan settled at 20 Credits
-- under a policy whose Action Plan price is 15.
--
-- ## Why this is safe to state as a fact rather than a guess
--
-- `credits/retail.ts` resolves a policy over a half-open interval:
-- `retail-v1` is `[2026-08-18, 2026-09-01)` and `launch-v1` is
-- `[2026-09-01, ∞)`. A charge created at or after 2026-09-01 can only have
-- been priced by `launch-v1`; there is no third policy and no overlap. So the
-- predicate below does not select "rows that look wrong" — it selects rows
-- whose stamp is impossible.
--
-- ## What is deliberately left alone
--
-- Thirteen agent charges stamped `core4-dogfood-budget-v1`. That is a *budget*
-- policy version in a *rate card* column — a category error, and the value
-- that belonged there (`internal-dogfood-v1`) names a book ADR 0092 deleted.
-- Rewriting them would make the dogfood era look like it never had economics
-- of its own. The amount, 100 Credits, is unambiguous either way. Three older
-- rows carry no version at all and predate the column being populated.
--
-- Idempotent: re-running matches nothing, because the predicate is the defect.

update public.billing_credit_ledger
   set rate_card_version = 'launch-v1'
 where kind = 'charge'
   and rate_card_version = 'retail-v1'
   and created_at >= timestamptz '2026-09-01T00:00:00Z';

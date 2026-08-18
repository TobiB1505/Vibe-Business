# Billing Core-2 — Stripe, Credit Grants, Entitlements & Real Credit Consumption

Status: merged (PR #48, hotfix PR #49). Deployed and dogfooded against real Stripe test mode. Test mode only — no live payments.

Billing Core-1 made Credits financially correct. Billing Product-1 decided what they mean commercially. Core-2 makes them real: money enters through Stripe, becomes an immutable grant, expires on a schedule, is spent in a deterministic order, and pays for actual operations.

What a customer experiences is four sentences — *I have Credits. I know what this costs. I can buy more. Vibe cannot spend more than I authorized.* Everything below is what it takes for those to be true.

---

## Branch / Base

Branch `claude/billing-core-2-stripe-entitlements-0rv0xs`, created from `origin/main` at `20f6cbd` — the Billing Product-1 merge.

## Preconditions verified

- **Billing Core-1 (PR #46)** merged at `74328c6`.
- **Billing Product-1 (PR #47)** merged at `20f6cbd`, the current `origin/main`.
- Working tree clean, no foreign work, migration history aligned with `supabase/migrations/`.

## Architecture

```
real money
  → Stripe Checkout                       (payment rail only)
    → signature-verified webhook event    (the only funding path)
      → immutable Credit lot + ledger entry
        → deterministic allocation        (expiring soonest first)
          → reservation                   (before any provider call)
            → operation                   (audit / opportunity / plan)
              → exactly-once charge       (on a delivered result)
              → full release              (on any failure)
```

Money flows one way. Vibe never asks Stripe at runtime whether a customer can afford an audit — that is the Credit balance's answer, and it must survive Stripe being unreachable.

---

## Credit source semantics

| Source | Expires | Spent | Created by |
|---|---|---|---|
| `welcome` | 30 days from grant | first | project connect, or the one-time claim |
| `subscription` | end of the paid period | after welcome | a paid invoice |
| `purchase` | **no normal expiration** | last | a paid Checkout Session |
| `promotional` | as granted | by deadline | nothing yet |
| `compensation` | as granted | by deadline | nothing yet |

`purchase` lots carry `expires_at = null` rather than a far-future date. "Does not expire monthly" and "expires in 2099" are different promises and only one is true.

## Expiration

A posted, append-only event — never a deletion, never a read-time filter alone. A negative `expiry` ledger entry moves the posted balance so Core-1's reservation predicate stays honest; the lot survives with its original amount so `100 Welcome Credits — expired Aug 30` is answerable forever.

Two properties make this safe without a scheduler:

- **Spendability is derived from `expires_at`, not from the swept status.** A lot one second past expiry is already unspendable, so the sweep's timing never decides whether someone got to spend dead Credits.
- **The sweep runs when an account is touched** — before a balance is shown, before a reservation is taken. A cron walking every account hourly to correct a number nobody is looking at would be strictly worse.

A lot with a live hold is skipped. Credits valid when a customer approved an operation must not vanish mid-run and fail work they already authorized; whatever is left lapses on a later sweep.

## Spend order

**Expiring soonest first. Non-expiring last.**

Expressed as an ordering over deadlines rather than over source categories. A category list happens to be right today only because those categories currently have that expiry ordering — it would be wrong the moment a promotional grant outlived a subscription period. Ties break on the older grant, then on id, so an allocation is reproducible from the same inputs.

The §74 case, verified: Welcome 30 + Subscription 100 + Purchased 500, charged 70 → **30 Welcome, 40 Subscription, 0 Purchased.**

## Credit grant and allocation model

`billing_credit_grants` is an immutable lot. `billing_credit_allocations` records which lot funded which hold and how much of it a settlement consumed — held and consumed amounts on one row, so "held 170, consumed 120" stays legible rather than being split at settlement time.

Neither is a second wallet. Every lot is created by exactly one ledger entry, and `unique(ledger_entry_id)` carries the ledger's existing exactly-once guarantee through to provenance.

`allocated_credit_units` is materialized on the lot for the same reason `reserved_credits` is materialized on the account: admission has to be one atomic statement, and a sum over allocation rows cannot be locked. Both are reconciled against the rows that define them (`reconcileLotAllocation`) rather than trusted.

## Reservation integration

Core-1's atomic gate is untouched. Allocation runs *after* admission and answers a different question — not "may this hold exist?" but "whose Credits fund it?".

The two gates differ by exactly one thing: the account gate counts every posted Credit including lapsed-but-unswept ones; the allocator counts only what is spendable now. The allocator is therefore authoritative, and a reservation whose allocation fails is rolled back rather than left holding capacity no lot can fund.

## Stripe implementation

`stripe@22.5.0`, API version pinned to **`2026-07-29.dahlia`** — the version this SDK's own types describe.

Field shapes were verified against those type definitions rather than from recollection, and two would have been wrong from memory:

- `Subscription.current_period_start` / `_end` **no longer exist on the subscription**. They live on each subscription item.
- `Invoice.subscription` **no longer exists**. It is `invoice.parent.subscription_details.subscription`.

Both moved in `2025-03-31.basil`, and neither would have failed loudly — both would have read `undefined`, and an undefined period end is a subscription grant that never expires. All version-dependent field locations live in one adapter (`stripe/normalize.ts`) so the next such change touches one file.

Event interpretation is a **pure function over plain objects**, which is what makes the cases that matter testable exhaustively: a replayed grant, a proration invoice, a forged Price id, a fabricated Credit amount, and a Checkout return standing in for a payment.

## Stripe customer mapping

One Stripe customer per Vibe owner per mode, in `billing_stripe_customers`. Created with Stripe's own idempotency key (`vibe-customer:<userId>`), so a retried creation returns the same customer rather than splitting one person's payment history in two.

This mapping — written by Vibe — is how a payment event becomes a Vibe user. Event metadata is a fallback for the narrow window before the mapping exists, and when both are present they must agree: a mismatch resolves to nothing rather than to a guess.

## Product catalog

Server-authoritative, in `src/modules/billing/catalog.ts`.

| SKU | Price | Credits |
|---|---|---|
| Free | €0 | none recurring |
| Builder | €19 / month | 1,000 per paid period |
| Pro | €49 / month | 3,000 per paid period |
| Pack 500 | €12 | 500 |
| Pack 1,500 | €33 | 1,500 |
| Pack 5,000 | €99 | 5,000 |

The browser names a SKU. The server resolves the Price, currency, amount and Credit total. The Credit amount is never sent to Stripe and never read back from a payment object, so whoever can edit Stripe cannot mint Vibe Credits. Stripe Price ids come from configuration; the Credit amounts do not.

## Welcome Credits

100 Credits, 30 days, once per account, identity `welcome-credit-v1:<userId>`.

Account-scoped rather than project-scoped, so creating projects is useless as a way to farm Credits — every call computes the same key and the ledger's unique index admits one. Ten concurrent provisioning attempts produce one grant.

Granted at **project connect**, which is a real server-side POST. A page render must not move financial state, and an idempotent grant *attempted* on every render is still a grant attempted on every render.

**Legacy accounts** — anyone who registered before this sprint — see a one-time "Add my 100 Welcome Credits" button on the billing page. Also a POST, also idempotent, and it disappears once it succeeds. New accounts never see it.

## Subscription monthly grants

Exactly one grant per successfully paid period, keyed on the **invoice** (`subscription-period-v1:<invoiceId>`).

Not on the subscription: a subscription sits at `active` for a month, and granting on status would pay out on every incidental update. Only `subscription_create` and `subscription_cycle` invoices qualify. The grant expires at the period *this payment bought*, taken from the invoice's own line items rather than from whichever period is current when the webhook is handled — which is the out-of-order defence.

Cancellation stops future grants and touches nothing historical. Purchased Credits and already-granted period Credits both survive.

## Plan changes

**Deferred.** No proration Credit economics are approved, so none are invented. `subscription_update` invoices — what Stripe emits for a mid-cycle plan change — are refused outright, in code rather than by how the Customer Portal happens to be configured. The Portal is expected to be set up without plan switching; the refusal does not depend on that being true.

## Fixed operation pricing

| Operation | Price | Policy |
|---|---|---|
| Business Audit | 35 Credits | `retail-v1` |
| Opportunity Generation | 20 Credits | `retail-v1` |
| Action Plan | 15 Credits | `retail-v1` |
| Product Understanding | **free** | `retail-v1` |

Free is a distinct case, not a price of zero. A zero would flow through reservation and settlement and post a 0-Credit charge every time product understanding refreshed, filling a customer's history with entries recording nothing happening.

Every charge stores its policy version, so a future repricing never re-rates history. Audit v2 at 45 leaves an audit charged under v1 at 35 forever.

### Why this is not the Core-1 rate card

Core-1's `CREDIT_RATE_CARDS` rates **provider SKUs** — credits per token, per millisecond, per byte — and exists to turn measured consumption into Credits after the fact. A fixed operation price is knowable *before* the run, does not vary with tokens, and has no SKU to attach to. Forcing it in would mean inventing a fake SKU with a quantity of 1, making `rateUsage` return customer prices for usage that never occurred — corrupting the one distinction Core-1's schema comment says the module exists to protect. So Core-2 adds a smaller, separate layer sharing every convention (versioned, effective-dated, half-open intervals, integer units, policy in reviewable code) and none of the semantics. `CREDIT_RATE_CARDS` remains empty, and a test asserts it.

## Operation integration

The hold goes in after the reuse check and the already-active check — both of which return earlier. Opening a stored audit, reloading a page, and navigating to an existing Opportunity Set or Action Plan therefore *structurally cannot* reach a reservation. Billing follows new work, not requests.

- **Business Audit** — the included first audit is unchanged. Once spent, `credits_required` is no longer terminal: it routes into paying 35 Credits.
- **Opportunity Generation** — free inside onboarding (bundled with the free audit, per CREDIT_ECONOMICS.md §Free usage), 20 Credits when deliberately regenerated from the workspace. `requestedBy` is a required parameter, not a defaulted one: whether a customer is charged is not something to get by omission.
- **Action Plan** — 15 Credits per new plan. Viewing a persisted plan, its Timeline, Start Here and all Planner navigation stay free.
- **Product Understanding** — free, and never touches the billing machinery.

Settlement and release hook into the operations' own terminal transitions, which are already guarded to run at most once — so the charge inherits exactly-once from the state machine and is idempotent underneath it anyway.

## Deep Scan entitlement

**Unchanged, and no price invented.** The first successful Deep Scan per project stays included; failed, cancelled, expired and provider-failed sessions still do not consume it. Additional Deep Scans keep the existing typed refusal with no price shown, because the entire cost is browser wall-clock that has never been measured. Adding a number here would be false precision.

## Insufficient-Credit behaviour

Reservation happens before any provider call. Insufficient Credits means the operation does not start — typed `insufficient_credits`, zero AI calls, no reservation, no charge. A cheap pre-check turns most cases away before an operation row exists; the reservation remains the authoritative gate.

## Failure semantics

The approved V1 policy, implemented exactly:

| Scenario | Charged |
|---|---|
| Never started provider work | 0 |
| Vibe / system failure | 0 — Vibe absorbs |
| Provider failure | 0 — Vibe absorbs |
| No usable result produced | 0 — Vibe absorbs |
| Delivered result | the fixed price, once |

Fixed-price operations have no partial charge: the document's partial rule is written for usage-based settlement, and a Class A operation either delivered a result or did not. The partial path stays available for the quote-based Agent operations that will need it. `abandoned_with_usage` records that Vibe still paid the provider.

## Billing UI

`/app/billing` answers five questions and nothing else: how many Credits do I have, what plan am I on, when do the expiring ones go, how do I get more, and what did I recently spend them on.

The balance shown is **spendable capacity**, not `posted − reserved`. The two differ by any lapsed-but-unswept lot, and spendable is the honest one — showing the posted figure would promise Credits that a reservation would then refuse.

The Checkout return says *"your payment is being confirmed"*, never *"Credits added"*. At that moment Vibe genuinely does not know.

A restrained balance indicator sits in the app shell — the slot the mockups reserved, empty through Core-1 because there was nothing real to read. The shell does not fetch it; pages pass it down, so no database round trip appears behind every navigation.

## Security review

| Check | Result |
|---|---|
| Client cannot mint welcome / subscription / purchased Credits | ✅ no insert policy on any billing table |
| Client cannot forge a Stripe customer | ✅ ownership resolves through Vibe's own mapping |
| Client cannot select an arbitrary Stripe Price | ✅ SKU key only; Price resolved server-side and cross-checked |
| Client cannot alter expiry or grant source | ✅ select-only policies |
| Replayed payment cannot double-grant | ✅ three independent unique indexes |
| Invalid webhook signature rejected | ✅ verified before parsing; no bypass exists |
| Cross-user billing reads fail | ✅ every policy scoped to `auth.uid()` |
| No service secret reaches the browser | ✅ `server-only`; no `NEXT_PUBLIC_` Stripe variable |
| Insufficient Credits prevents provider spend | ✅ reservation precedes every provider call |
| GET requests move no financial state | ✅ asserted in the dashboard cost contract |
| CSRF | ✅ Server Action POSTs with framework origin checks |

`billing_stripe_events` has **no policy at all**, not even select: it is Vibe's operational record of its payment provider's traffic and belongs to no customer.

## Tests

4,153 unit/integration tests (+227 this sprint) and 283 browser tests (+27).

Named merge gates, all verified:

| Gate | Result |
|---|---|
| §70 welcome grant, 10 concurrent | one 100-Credit grant |
| §71 subscription webhook × 5 | one 1,000-Credit lot |
| §72 top-up webhook × 5 | one 500-Credit lot |
| §73 expiry | 600 → 500, grant retained |
| §74 spend order | 30 Welcome + 40 Subscription + 0 Purchased |
| §75 reservation allocation and release | full capacity returned, no charge |
| §76 partial settlement | 150 charged of 200 held, 50 returned |
| §77 real-service-path concurrency | 40 Credits, two 35-Credit audits → one admitted |
| §78 duplicate request | one hold, one charge |
| §79 successful operation | one charge, policy version stored |
| §80 failed operation | 0 charged, no stuck reservation |
| §81 reading existing results | 0 Credits, structurally unreachable |
| §82 insufficient balance | 0 provider calls |
| §83 mixed-credit concurrency | no overspend, purchase protected |

### Mutation testing (§102)

All sixteen adversarial mutations were **applied and run**. Three initially escaped, and each was a real finding:

1. **The fabricated-amount test asserted nothing.** Its fixture used `credits: "500000"`, and `creditsToUnits(500)` is 500,000 internal units — a mutation trusting the payload produced exactly the expected number. Values are now far outside the range, and a second case walks every pack.
2. **Nothing proved a single lot cannot be over-allocated.** The account gate was always the binding constraint, so removing both the allocator's capacity check and the database backstop left every test green. A direct two-way contention on one 100-Credit lot now covers it.
3. **Nothing covered the refused-hold branch.** The affordability pre-check turns away most under-funded runs before an operation row exists, so deleting the abort after a failed reservation left the executor starting anyway. Driven now through a suspended wallet — a state the pre-check deliberately does not consider.

Two mutations remain uncaught **individually**, and should be: removing only the allocator's per-lot check, and removing only one of the four exactly-once structures behind a settlement. Both are redundancy working as designed — the database constraint and the reservation state machine each hold the line alone. Removing *every* layer is caught in both cases, which is the property worth asserting.

## Real Stripe test-mode dogfood

**PARTIALLY RUN — REAL, against the founder's own test-mode account**, after merge. The credential block described below applied only to this session's build environment, which never held Stripe secrets; once the operator configured them on the deployment and requested a merge, the founder ran real test-mode traffic through it directly.

Verified against the ledger (`billing_credit_grants`, `billing_credit_ledger`, `billing_stripe_events`), not just observed in the UI:

1. **Welcome grant** — 100 Credits, `welcome-credit-v1:<userId>`, one ledger entry.
2. **Top-up purchase (Pack 5000)** — real Checkout Session `cs_test_a1ZUd0…`, event `checkout.session.completed` processed, exactly 5,000 Credits granted (the catalog amount for that SKU, not a client-supplied number), no expiry.
3. **Builder subscription** — real invoice `in_1U5kZU…`, event `invoice.paid` processed, exactly 1,000 Credits granted, `expires_at` set to the period end (18 Sep), matching the shipped period-end-expiry policy.
4. **The §31 defence, live**: the subscription's own `checkout.session.completed` event arrived and was correctly **ignored** with reason `checkout_subscription_handled_by_invoice` — the grant came from `invoice.paid`, not the Checkout return, exactly as designed. This is the one case that is genuinely hard to fake with a fixture and the most important one to see for real.
5. **`customer.subscription.created`** processed, subscription snapshot synced (`plan_key: builder`, `status: active`, `livemode: false`).
6. **Ledger reconciles exactly**: 100,000 + 1,000,000 + 5,000,000 = 6,100,000 units posted, 0 reserved, matching the account row and the balance shown on `/app/billing`.

**Not yet exercised**: a genuine Stripe webhook retry/replay (nothing failed, so Stripe had no reason to redeliver — idempotency under replay is proven at the unit level in `webhook-service.test.ts` §71/§72 but not yet observed live), cancellation, and spending Credits on a real priced operation (Business Audit / Opportunity / Action Plan) against this balance.

## Production bugs found and fixed post-merge

Two real defects surfaced within minutes of the founder's first live click, both traced to the same root cause and both fixed and merged (PR #49) before further testing:

- **Root cause**: `src/app/app/billing/actions.ts` and the welcome-grant call in `src/app/app/connect/github/repositories/actions.ts` wrote through the ordinary cookie-scoped Supabase client. Every billing table deliberately has a select policy and no write policy for any authenticated client (§64) — that absence is what makes "no client-writable financial surface" true — so **every write these actions attempted was refused by RLS** before reaching application logic. Both "Add my 100 Welcome Credits" and "Choose Builder" failed on first click with a generic message.
- **Compounding defect**: the failure was invisible. Both actions caught their own exceptions without logging them, so Vercel showed HTTP 200 on every request and zero errors anywhere — a genuine gap in this sprint's own observability that the DoD's "quality gate" did not catch, because no test exercised these Server Actions at the argument-passing layer; only the domain functions one level down were unit tested, always with a trusted client supplied directly.
- **Fix**: both call sites now use `createServiceClient()` — the same client the Stripe webhook already uses, for the same reason (ADR 0025 §9): ownership comes from `requireSession()`'s verified JWT claim, never from a client-supplied parameter, so bypassing RLS here does not reopen the hole RLS closes. Every catch block now logs the error by name.
- **Residual gap, stated plainly**: no test exists at the Server-Action layer that would have caught the original wrong-client bug, or would catch a regression of it. The domain-level tests (4,154 of them) were and remain correct; they simply cannot see which Supabase client a route handler chose to pass them.

## Migration status

`supabase/migrations/20260818120000_billing_credits_stripe_entitlements.sql`, forward-only. No deployed migration edited; the only drops are two CHECK constraints replaced in the same file to admit the `expiry` ledger kind, and a test asserts both are re-added.

**DEPLOYED** to the linked project (`dcbwlctscooefwnivxzv`, eu-north-1) via the Supabase MCP `apply_migration`, after confirming migration history was aligned through `billing_credits_core` (Core-1) with no drift. `list_migrations` afterward shows `20260818090300_billing_credits_stripe_entitlements` as the current head. `get_advisors` (security) reports one expected INFO — `billing_stripe_events` has RLS enabled with no policy at all, which is the deliberate design (§67), not a gap — plus three pre-existing WARNs on functions unrelated to this migration (`set_updated_at` search_path, `rls_auto_enable` SECURITY DEFINER exposure, leaked-password protection), none introduced by this sprint.

## Live-mode status

**NOT ACTIVATED.** A live-mode secret key is refused at startup unless `STRIPE_ALLOW_LIVE_MODE=true` is also set. No live Products, Prices, webhook or payment exists.

## Production activation checklist

Configuration and code only — none of the legal or accounting items are solved here, and none should be solved in code.

- [ ] Legal entity, business address and billing details registered with Stripe
- [ ] VAT / sales-tax treatment reviewed per jurisdiction sold into, including point-of-sale vs point-of-redemption timing for Credit purchases
- [ ] Accounting review of non-expiring purchased Credit balances as deferred revenue
- [ ] Legal review of whether long-dated purchased Credits constitute a stored-value instrument (EU e-money framework is the likely relevant one)
- [ ] Live Products and Prices created; each euro amount reconciled against `catalog.ts`
- [ ] `STRIPE_PRICE_*` set to live Price ids
- [ ] Live webhook endpoint registered; `STRIPE_WEBHOOK_SECRET` set to the live signing secret
- [ ] Customer Portal configured **without** plan switching
- [ ] Terms and privacy updated with billing, Credit expiration and refund language
- [ ] Refund policy for purchased-but-unused Credits, including account closure and GDPR erasure
- [ ] Customer support contact published on the billing surface
- [ ] `STRIPE_ALLOW_LIVE_MODE=true` set — deliberately, last
- [ ] Live-mode smoke test: one real purchase, one webhook, one reconciled balance
- [ ] Alerting on webhook failures and on any `billing_stripe_events` row stuck in `processing`
- [ ] Monitoring for materialized-balance drift (`reconcileBalance` / `reconcileLotAllocation`)

## Agentic Execution compatibility

Preserved and unchanged:

```
quote → reserve → run → meter → settle → release
```

Everything the Agent will need already exists and already allocates across lots: a quote carrying an estimate and a hard maximum, a reservation that holds the maximum, a settlement that may charge less and return the difference, and a refusal (`additional_credits_required`) that reports the exact shortfall rather than silently exceeding an approved ceiling. Partial settlement across lots is implemented and tested, which is precisely the case a variable-cost Agent run needs.

No Agent price exists and none was invented. No Agent button, no Agent execution, no PreparedChange wiring.

## Deferred

- Capped subscription rollover (CREDIT_ECONOMICS.md's recommendation; period-end expiry ships instead, on founder instruction)
- Additional Deep Scan price — blocked on real browser cost
- Agentic Execution pricing — blocked on real Agent dogfood
- Self-service mid-cycle plan changes — no approved proration economics
- Credit reversal for Stripe refunds and chargebacks — documented residual below

## Risks and follow-ups

**Stripe refunds and chargebacks have no Credit policy.** Detection exists (events are recorded); reversal does not. The Credits may already have been spent, and clawing back into a negative balance would be a surprise debt. This needs a commercial decision, not an implementation.

**The pre-check and the reservation can disagree.** Between `checkOperationAffordability` and the hold, a lot can lapse or another operation can take the Credits. The reservation is authoritative and the operation fails safely, but the customer sees a price they could afford a moment ago. Acceptable; worth watching in real usage.

**A suspended wallet reports `insufficient_credits`.** Nothing sets suspension today, so no customer can reach it, but the message would be misleading if anything ever did.

**Materialized figures need monitoring, not just reconciliation functions.** `reconcileBalance` and `reconcileLotAllocation` can prove drift; nothing currently alerts on it.

## Merge recommendation

**Merged** (PR #48, explicit founder approval; hotfix PR #49 same day). Migration deployed via the linked Supabase MCP; real Stripe test-mode dogfood run directly against the deployed app and verified against the ledger, both described above.

Outstanding before this is genuinely done, not before it was safe to merge:

- Webhook replay/retry, cancellation, and spending Credits on a real operation are still unexercised against a live account (see the dogfood section).
- No test exists at the Server-Action layer, so the class of bug PR #49 fixed has no regression guard yet — the domain functions are fully tested, the thin routing layer that chooses which Supabase client to hand them is not.
- The production activation checklist (legal, VAT, live Products/Prices, live webhook secret, `STRIPE_ALLOW_LIVE_MODE`) is entirely unstarted, by design — live mode remains **NOT ACTIVATED**.

---

## Follow-up: the audit screen never got the Core-2 memo (2026-08-18)

**Reported from the deployed app.** A founder opened the Business score page on a
project whose included audit was spent, with 6,080 Credits in the account, and saw:

```
[ Re-run business audit ]  (disabled)   35 Credits
KEEP VIBE WORKING — … credits — they aren’t available yet.
```

Three elements on one screen, mutually contradictory. Every layer beneath them
was correct: the price was right, the balance was right, and
`startBusinessAudit` had been routing `credits_required` into a reservation
since this sprint shipped. The screen was the only thing that was wrong.

### Why nothing caught it

`credits_required` stopped being terminal in §39, but nothing propagated that to
the two places that read it as a wall:

1. **The score page** disabled the button on the bare refusal, with no price and
   no balance available to say anything better — `AuditAccessStatus` carried
   neither.
2. **The audit's prepare step** re-asked `authorizeProjectAudit` and returned
   `credits_required` as a failure. So even with the button fixed, a paid re-run
   would have reserved 35 Credits and then been refused one step later, by the
   workflow, for not being included. No test could see that, because the start
   path had already returned `started`.

Both are the same mistake in two places: asking an *entitlement* question and
treating its answer as the whole economic picture.

### What changed

| Where | Change |
| --- | --- |
| `operations/billing.ts` | `resolveOperationCreditCost` — price and balance unconditionally, read-only (never mints an account on a render). `checkOperationAffordability` now expressed over it. `operationHasCreditHold` — the durable proof a run was paid for |
| `business-audit/service.ts` | `getAuditAccessStatus` joins the entitlement decision to the wallet, and only on the path where the customer is the one paying |
| `business-audit/entitlement.ts` | `AuditCreditGate` / `resolveAuditCreditGate` / `auditBlockedByCredits` — one classification, so a button's `disabled` and a notice's wording cannot disagree. `credits` stopped being a reserved access mode |
| `operations/business-audit/execution.ts` | The prepare step accepts a live Credit hold as authority for a paid re-run and records `access_mode = 'credits'` |
| `audit-credit-notice.tsx` | The sentence, as a component — so a browser can read it |
| `credits/units.ts` | `formatCreditsForDisplay` promoted out of `billing/overview.ts`; the audit notice was printing "6080" beside billing's "6,080" |

No schema change. `access_mode = 'credits'` was already an allowed value, and
the one-included-audit unique index is scoped to `included_first_audit`, so a
paid audit sits outside it by construction.

### Rule 69, applied

The defect was invisible to unit tests by nature: nothing was individually
wrong, only mutually. So the regression guard is a browser suite
(`e2e/audit-credits.spec.ts`) that renders the button, the price and the notice
together and asserts they **agree** — including the literal sentence from the
screenshot, so nothing reintroduces it while the balance is sufficient. It found
the thousands-separator inconsistency on its first run.

Domain coverage alongside it: `business-audit/access-status.test.ts` (the
service/wallet seam, including reserved Credits and the no-wallet case) and a
`Credit-funded re-run` block in `operations/business-audit/execution.test.ts`
(a held operation runs and is recorded as Credit-funded; an unheld or released
one is still refused).

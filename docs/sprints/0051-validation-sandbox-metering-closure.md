# Sprint 0051 — Validation Sandbox Metering & Infrastructure Cost Closure

No credit prices, no `CREDIT_RATE_CARDS`, no Stripe, no reservation/settlement
logic, no UI, no paid agent runs. This sprint closes the last measurement gaps
before a Credit Economics sprint can begin.

## PART A — verified in code, not assumed

The prompt's own stated baseline — agent sandbox has active CPU and egress,
validation does not — was checked against the actual provider adapter rather
than accepted. It was **half right, for a reason the prompt did not have**:
validation's `snapshot()` path (used by every *passing* run) and `stop()` path
(used by every *failing* run) are different code, and only one of them was
broken.

## PART B/C — the real bug, and the fix

`captureValidatedArtifact` (`validation/orchestrator.ts`) calls
`sandbox.snapshot()`, then reads `this.sandbox.totalActiveCpuDurationMs` off
the same local instance to build the terminal usage record.

Reading the compiled `@vercel/sandbox` SDK (`node_modules/.pnpm/@vercel+sandbox@3.0.0`)
settles why that was always empty:

- `Sandbox.update()` and `Sandbox.stop()` both reassign the instance's cached
  record (`this.sandbox = response.json.sandbox`) on the way out.
- `Sandbox.snapshot()` does not. It forwards to the SDK's internal `Session`
  object, which *does* refresh — but that refresh lands on a field our code
  never read.
- The `Snapshot` object `.snapshot()` returns carries no usage fields at all —
  only id, size, status, timestamps.

So `this.sandbox.totalActiveCpuDurationMs` after a snapshot was never the
finished run's number. It was whatever the sandbox looked like at
construction, before any command had run — `undefined` on every real run,
hence the `?? null` that has fired every time. **15 of 19 passing validation
rows in Vibe's history record `active_cpu_ms: null` for exactly this reason,**
concentrated on `cleanup_status: 'stopped'` rows going all the way back to
2026-08-13. `stop()` (the failing-run path) was never affected — it reads
usage off its own return value, which the SDK does populate correctly.

**The fix:** after `snapshot()` succeeds, re-fetch the sandbox with a fresh
`Sandbox.get({ name, resume: false })` — a real round trip against the
provider's own record, which the SDK documents as cumulative *"across all
sessions"*, i.e. server-side and independent of which local instance asks.
Best-effort: a failed re-read leaves usage `null`, never guessed from wall
duration.

This is one fix for both PART B and PART C — active CPU and egress come from
the same re-read, so both are restored together for every validation run from
here on.

`src/modules/validation/vercel/provider.ts` — `readTerminalUsage()`.
`src/modules/validation/vercel/provider.test.ts` — the previous test
(`"reports usage from a stop()…"`) hard-coded `totalActiveCpuDurationMs` as a
static property present at mock construction, which reproduced the bug's
symptom (a value that "was already there") without ever exercising the refresh
path. It is corrected, and two new tests pin the actual mechanism: a stale
local value must lose to the fresh `Sandbox.get()` read, and a failed re-read
must leave usage unknown rather than guessed.

## PART D — resource configuration, re-verified

`SANDBOX_RESOURCES.vcpus = 4` (`validation/budgets.ts`), and agent
provisioning (`execution.ts:360`) passes no `vcpus` override to
`sandboxProvider.create()`, so it inherits the same 4. Confirmed by reading the
call sites directly, not by trusting the prior sprint's own conclusion. No
change from Sprint 0050: both microVMs are 4 vCPU / 8 GB, `derived_from_configuration`.

## PART E — rate card provenance, unchanged and stated why

Two independent attempts to reach the numeric price table failed the same way
they did in Sprint 0050: `WebFetch` to `vercel.com` is blocked by this
environment's egress proxy, and `mcp__Vercel__search_vercel_documentation`
(queried three ways, including the exact rate figures as search terms) returns
`vercel.com/docs/sandbox/pricing`'s worked example — "8 GB × 0.5 hours = 4
GB-hours" — and confirms "2,048 MB per vCPU" from a *second*, independent doc
page (`ecosystem/hermes`), but never the price table itself.

**The rate card stays `operator_supplied` / `verified: false`.** The same
figures repeated in this sprint's own prompt are not independent confirmation
— they are the same operator input already on record. Upgrading the label on
that basis would assert a verification that did not happen. What did newly
corroborate this sprint: the SDK reference confirms `totalActiveCpuDurationMs`,
`totalIngressBytes`, `totalEgressBytes` are exactly the fields the rate card's
usage model assumes, and are documented as cumulative across a sandbox's whole
lifetime — which is what makes a fresh `Sandbox.get()` the correct fix rather
than a workaround.

## PART F — the point estimate, proved rather than built

No new architecture was needed. `deriveSandboxCost` already turned a known
`activeCpuMs` into a complete, non-`unknown` component and an unknown one into
the floor/bound split — that was Sprint 0050's whole design. This sprint adds
`economy/point-estimate.test.ts`, which feeds it the usage shape a *fixed*
validation capture will produce and shows the total collapses to
`complete: true` with a single number, while the same function fed a
*historical*-shaped input (no active CPU) still correctly falls back to
floor + upper bound. One function, two eras of data, both handled by the
existing contract.

## PART G — historical backfill: none was possible, and why

Checked directly: `active_cpu_ms` (`sandbox_usage_events`) is the only column
anywhere in the schema that ever held this value — `grep` across
`information_schema.columns` for anything CPU-shaped or a raw snapshot payload
found nothing else. There is no second, unconsumed copy of the number to
recover. The bug was that the provider was never asked the right question, not
that an answer was captured and discarded — so there is nothing to backfill.

Re-querying the provider today was considered and ruled out on two independent
grounds, not just skipped: this session holds no live Vercel Sandbox
credential (that is Vibe's production secret, not available to a coding
session), and the named sandboxes in question are 7–8 days old against
`SANDBOX_BUDGETS.validatedArtifactTtlMs`'s bound, so `Sandbox.get()` would
almost certainly answer `not_found` even with access.

**Runs #3–#8's costs are unchanged from Sprint 0050.** The floor/upper-bound
table is not restated here because restating identical numbers under a new
sprint heading would look like new work when none occurred on that table —
see `docs/business/ECONOMY_MODEL.md` for the figures, which still stand.

## PART H — Vercel Functions / Workflow invocation cost materiality

Not instrumented. Analysed first, per the sprint's own decision rule.

**Measured** (from the real step graphs and real run durations, not assumed):
`agentExecutionWorkflow` is 8 fixed steps plus one `pollAgent` step per 20s
poll interval; `changeValidationWorkflow` is 11 step call sites. Across runs
#3–#8 (523.9s down to 79.9s of agent wall clock) that is **23–46 Vercel
Function invocations per full run** — computed directly from the poll interval
and each run's own measured duration.

**Not verified**: Vercel Functions/Fluid Compute per-invocation and GB-hour
pricing, for the same reason the sandbox rate is unverified — this
environment cannot reach the pricing page. Two bounds, both reasoned rather
than vendor-quoted:

| Scenario | Per-invocation assumption | 46-invocation cost | Share of $0.4752 |
|---|---|---|---|
| Realistic | 500ms, 256MB (DB read/write work) | ~$0.0003 | ~0.07% |
| Deliberately generous upper bound | 2s, 1GB | ~$0.0051 | ~1.07% |

Under a realistic assumption this is clearly immaterial. Under a deliberately
generous one it sits at the materiality threshold rather than clearly below
it. **Verdict: do not instrument now** — the realistic case is the honest
expectation for what these steps actually do (metadata reads and writes, not
computation), and the generous case is a worst-case bound, not a claim about
what is actually happening. Revisit if the poll interval shortens materially
or the step count grows.

## PART I/J — economy re-analysis

Unchanged from Sprint 0050 for runs #3–#8, because nothing about those rows
changed — see the reasoning in PART G. The number that matters for a future
run is structural, not statistical: once a validation completes under this
fix, its sandbox cost is a **point estimate**, not a floor-to-bound range.
That is proved in `point-estimate.test.ts` rather than claimed here.

## PART K — verdict

**NOT READY FOR CREDIT PRICING.**

What is now true: model spend is exact (reconciles to 4 decimals against
`ai/pricing.ts`), the agent sandbox is fully measured, the validation-capture
bug that suppressed active CPU and egress is fixed at its source for every
future run, the rate card's mechanics are corroborated by a second SDK
reference, and Function/Workflow overhead is analysed and reasoned negligible.

What is still missing, and is the reason for NOT READY:

1. **The rate card is not verified against a primary source.** Every dollar
   figure in `deriveSandboxCost` traces back to `operator_supplied`. This is
   the one gap actually blocking pricing — a Credit price built on an
   unverified infrastructure rate is a guess wearing a nanodollar.
2. **Historical runs #3–#8 still carry no validation-sandbox point estimate**
   — only the pre-existing floor/bound. The fix helps every run from today
   forward; it cannot retroactively fix the six that exist.
3. **n = 6, `non_production_economics = true` throughout.** No statistical
   confidence, stated in Sprint 0049/0050 and unchanged here.

Item 1 is the blocker. Items 2–3 are honestly-labelled limitations a Credit
model can be built around; item 1 is the one number the whole rate card
depends on, and it has not been confirmed from a primary source in three
sprints of trying.

### Addendum, same day — item 1 resolved by founder attestation

After this sprint's own attempts closed with the verdict above, two more
things were tried, in order, and only the second was accepted:

- A screenshot claiming a different AI assistant had browsed the pricing page
  and confirmed the same figures — **rejected.** No way to tell a real fetch
  from a recollection that happens to match, and the numbers being identical
  to what was already `operator_supplied` is not independent evidence of
  anything.
- Vibe's own founder confirming the five figures directly, by name, on
  2026-08-20 — **accepted.** `infrastructure-rates.ts` gained a new
  `sourceKind`, `founder_attested`, distinct from `official_public_pricing`
  precisely so this sign-off is never confused with a technical verification
  this environment did not perform. `VERCEL_SANDBOX_RATES.verified` is now
  `true`; the five numeric rates are unchanged.

**Item 1 is resolved.** See `docs/business/ECONOMY_MODEL.md`'s "Open
decisions" for the live status — items 2 and 3 above are unaffected and still
stand as labelled limitations, not blockers.

## Gate

lint 0 errors / typecheck / full unit suite / build / E2E green, no migration
(nothing here changes schema — the fix changes what a future row *contains*,
not the shape of the table). No paid agent run started; none was needed —
every claim in this sprint is either read from existing rows or proved by a
test against the already-installed SDK's compiled source.

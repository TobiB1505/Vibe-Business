# The thousandth row, and the reads that would not have noticed

**Recorded 2026-09-02, after the work.** Three commits, no migration, no product change. Closes the half of PERF-018 that [ADR 0068](../decisions/0068-retention-periods.md) §1 deliberately separated from retention and refused to authorize.

## The premise stopped being a premise

Every previous sprint on this said the same thing: `supabase/config.toml` sets `max_rows = 1000`, that file governs the *local* stack, and the deployed value is an open verification the audit lists as "Supabase-Dashboard → API-Settings". I could not read it — PostgREST's configuration is not in the database, and no table with more than a thousand rows is readable by `anon`.

**It is 1000, and it is no longer settable in the dashboard.** So it is not a setting that happens to be low; it is a fixed property of the platform that can never be raised out of the way.

That converts PERF-018's truncation half from a conditional finding into a present one, and it sharpens the deadline: **`agent_execution_events` passed a thousand rows on 2026-08-31**, at a single operator's usage. Not a scaling concern.

## Twenty-five reads, and how many actually mattered

A script found every `.from("<growing table>")` with no `.limit`, `.range`, `.single`, `.maybeSingle` or `count` in its statement. Twenty-five. That number is close to useless on its own, and taking it at face value would have produced a sweep of pointless `limit(1000)` calls — each one suggesting a risk that is not there.

What separates them is **what bounds the set**, and three kinds turned out to be fine:

- **Bounded by the caller.** `.in("id", ids)` cannot return more than the caller passed.
- **Bounded by a constraint.** `product_scan_events.sequence` has a CHECK confining it to 1–24.
- **Bounded by a live status that empties.** `lotsWithLiveHolds` and `listActiveReservations` read `status = 'held'` / `'active'`, which is a concurrency set rather than a history. Measured rather than assumed: **zero active reservations and zero held allocations** — all 262 reservations and all 43 allocations had reached a terminal state. Truncation there needs a thousand simultaneous holds on one account, which is a different incident with a different name.

And one kind looked dangerous and is not, for a reason worth writing down because it took a measurement to be sure of: **`withinStartWindows` is unaffected either way.** Both its reads are `count: "exact", head: true`, so no rows cross the wire, and whether PostgREST caps the *count* under `max_rows` does not matter here — every threshold in `START_LIMITS` is at most 120 per day and 20 per hour. A count capped at a thousand still exceeds all of them, so the gate refuses and admits identically. That is a stronger answer than measuring the cap, because it does not depend on the cap.

## What was left, and it was not what the audit pointed at

Nine reads survived the argument. Six were operator probes, four of those bounded per run or per refund. The two that were genuinely unbounded were both in code no customer reaches, and both would have been wrong in the same way:

**`readProjectChangeEconomics` was dead.** One occurrence in the entire repository — its own definition. No caller, no test. It also carried three of the nine, chained into a per-project cost sum: every agent run for a project, then every usage row for those runs, then every sandbox row. Deleted, because bounding code nobody calls is the worse repair.

**`dogfood.probe.ts` read the whole AI ledger twice with no filter**, reconciled it against stored cost, and asserted exactness. Past a thousand rows that assertion still passes — over the oldest thousand — and prints a smaller count as if it were the total. **The file that exists to catch a wrong number was about to produce one.** It pages now, by `id` rather than `created_at`, because these rows are written in bursts inside one run and paging on a non-unique column can repeat or skip a row where values tie.

## The part that outlasts the sweep

A one-time inventory is worth little; the twenty-sixth read is written next week. So the inventory is a test.

It is an **allowlist with arguments**, the shape `service-boundary.test.ts` already uses for the service-role client: an unbounded read must appear in the list with a `why` that names what bounds the set **by construction**. A size argument is refused outright — `operation_runs` was small until it was not — and the test rejects the phrases that smuggle one in.

Two properties make it more than a linter:

- **A stale entry fails.** An allowlist line pointing at a path with no unbounded read left is a claim nobody is checking, and it silently pre-approves whatever gets written there next.
- **It fails on the read, not on the file.** The message is `modules/x/y.ts:101 reads audit_events` — the work item, not a prompt to re-run the query by hand.

## Verification

`pnpm lint` 0/0 · `pnpm typecheck` clean · `pnpm test` **7,377 tests in 427 files** · `pnpm build` green.

Four planted defects against the guard, each caught: a paginated read losing its `range`, a new unbounded read in an unreviewed file, an allowlist entry gone stale, and an entry arguing from size.

Two plants that did **not** fail, and both were informative rather than embarrassing. Removing a `.limit()` inside a file that is *on* the allowlist changes nothing, which is correct — the entry is the review, and the whole file is reviewed. And the first attempt planted into a file that does not exist, which the guard cannot be blamed for.

**No E2E run** — the same container limitation as the last seven sprints.

## What has not been proved

- **Whether `max_rows` caps an exact count.** The question was made irrelevant for every current caller rather than answered. A future comparison against a threshold near a thousand would need the answer, and getting it needs a local Supabase stack rather than reasoning.
- **That the growth-table list is complete.** It names seventeen tables chosen by one rule — rows accumulate because the system ran, not because a person added something. A table added later is covered only if somebody adds it here, which is the same gap `METRIC_AVAILABILITY` has and records.
- **That `summarizeChangeEconomics` still earns its place.** Its store-side caller is gone; it remains a pure, separately tested function with no production consumer. That is a deletion question for a sprint that is looking at `economy/`, not one to answer while passing.

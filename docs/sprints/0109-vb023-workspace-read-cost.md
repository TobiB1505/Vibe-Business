# VB-023 — the reads the Agent screen makes

**Recorded 2026-08-28, after the work.** The launch audit's B5/B15 finding, left partly open by [Wave 2](0104-wave2-database-and-performance.md): *"`/agent` per-change fan-out + zero Suspense → batch per-table `.in()`; Suspense around GitHub preflight."*

Both halves are closed. What made it worth writing down is not the batching — that is a known shape — but that **the first thing this sprint built was a way to count**, and every number below came out of it rather than out of reading code.

## The measurement, before anything was changed

`workspace-cost.test.ts` already guarded this path and is honest about how: it reads the source and looks for `await` inside a loop, and its own comment says it *"proves nobody wrote the obvious form of the mistake, not that the cost is optimal."*

A fan-out spread across six modules' services has no obvious form to look for. Every call site is a single `await` in a `Promise.all`, and the cost is only visible in the total. So the fake Supabase client learned to record the table behind every query, and `getPreparedChangeWorkspace` — **which had no executable test at all** — got one.

The first run:

| prepared changes | reads |
| --- | --- |
| 1 | 14 |
| 8 | 105 |

**Thirteen reads per change**, on a list capped at twenty. Seven of the thirteen were re-fetching a row the render was already holding: `prepared_changes` three times per change, `validation_runs` three, `review_artifacts` twice, `change_merges` twice.

With a repository connected — which is every project that can prepare a change — the merge card's own eligibility read adds five more. **Upwards of 360 round trips for one render.**

## What it is now

| shape | before | after |
| --- | --- | --- |
| 8 changes, none validated further | 105 | **7** |
| 8 merged changes | 55 | **34** |
| the cheap summary list, 8 changes | 9 | **2** |

Seven, for any number of changes up to the cap.

## How

Six tables answer the same question — the newest row for one prepared change — and all six answered it with the same twelve lines. `readLatestPerPreparedChange` asks it once for the whole list, and each store keeps its own `COLUMNS` and `mapRow`.

The batch is **exact, not exact-if-history-is-short**. PostgREST has no `distinct on`, so "latest per group" is assembled from an ordered read, and an ordered read needs a row budget or it is an unbounded transfer ([rule 27](../../CLAUDE.md)). What makes truncation safe is the ordering: rows come back newest-first *globally*, so for any change that appears at all, its first row is its latest. Truncation can therefore only **omit** a change, never mis-answer one — and an omitted change is re-read individually, which is the query this replaced. The budget cannot be reached with realistic data, which is exactly why the tests drive it directly.

Each card service takes the row it needs as `prefetched` rather than reading for itself. That moves the ownership scope out of the query and into the caller's bookkeeping, so the rows are checked against the change they are used for; a mismatch throws rather than falling back to a read, because a wrong row is a programming error and a quiet re-read would hide it behind the cost this removes.

## What deliberately still costs a read per change

Three things, and the read-count test names all three so a fourth cannot join them quietly:

- **The standing approval for the current artifact identity.** Keyed by identity, not by change. An approval identity is the one thing in this product that must never be resolved from a convenient nearby row ([rules 55, 70](../../CLAUDE.md)).
- **`getReviewImages`'s ownership and readiness re-check**, immediately before it signs URLs. Ownership is the query, not a later check.
- **The GitHub merge preflight**, which is what the merge card exists to report and would be worthless from a stored snapshot.

## The shape the first pass got wrong

The first measurement used one lifecycle shape: a change with a passing validation and nothing else. Eight of those cost what one costs, the test went green, and it would have shipped.

Seeding **merged** changes instead: 55 reads for eight, 13 for one. Six per change still fanning out — and a merged change is the one that accumulates, because nothing moves a change out of `prepared`. Every change a founder has ever merged stays on this screen for the life of the project. The list that grows was the list still fanning out.

Those six were the project's public origin (one row, asked once per merged change, same answer every time), the repository snapshot the change was prepared against (in practice the same snapshot for all of them), and the measurement-plan chain. The first two are now read once for the list and only when something in it was merged; the third is batched inside `business-measurement`, because a merge names a plan and a plan names its measurements, and a caller batching that for itself would have to know the chain — which is how a module's internals end up restated in a page.

## Streaming

`AgentPanel` is built from three single-row reads and waited behind the merge preflight. It no longer does: the prepared changes arrive inside a `<Suspense>` boundary, and `preparedCount` — the sentence "three changes are below" — comes from a `head`-only count that transfers no rows, so it can be true before the three exist. That count moves into `countPreparedChangesForProject`, which the navigation badge now delegates to, so the `status = 'prepared'` filter that makes the badge match the page is stated once.

Covered from both sides, because neither half reaches the other:

- **A browser test** takes one synchronous DOM snapshot while the boundary is pending and finds the panel painted, the skeleton present and the section absent. Playwright's matchers each auto-wait, so three of them in a row would satisfy themselves at three different moments — including after the slow half landed, which would pass against a page that never streamed.
- **A structural test** asserts the real route puts no workspace read before its `return`. That route needs a signed-in session against a Supabase project the browser suite deliberately does not have — the same gap [Wave 5](0108-wave5-verification.md) recorded.

The fixture the browser drives reproduces the route's render shape with an artificial delay standing in for the preflight. It is labelled as such where it lives.

## Verified by breaking what it guards

Every assertion in this sprint was checked by planting the defect it exists to catch:

| planted | caught by |
| --- | --- |
| the truncation fallback removed | `latest-per-change.test.ts` — one repair query missing |
| every card handed the first change's review | the scope check, in three tests |
| every card's approval dropped | the equivalence comparison |
| every card's snapshot dropped | the equivalence comparison — *after* a fixture fix |
| the public origin never resolved once | the read count returns to one per change |
| the plan lookup returning nothing, and returning the same plan for everyone | the batch's own test |
| the `<Suspense>` boundary removed | the browser test's first flush |

**Two of those did not fail on the first try, and both were fixture defects rather than test defects.**

The snapshot fixture carried `result: {}`. An empty result makes the outcome contract *unsupported*, so a card built from the right snapshot and a card built from no snapshot at all came out identical — dropping the snapshot entirely passed every test. It also used a capability string that is not in `EXECUTION_CAPABILITIES`, which short-circuits before the snapshot is ever consulted. Both had to be made real before the comparison discriminated anything.

The second is structural and worth remembering: once `getBusinessImpactCard` delegates to `getBusinessImpactCards`, **comparing the two proves nothing about the chain they share**. An equivalence test between a wrapper and its implementation is a tautology. The batch is therefore tested directly, in the module that owns it.

## What this did not do

- **VB-022** (id-only existence variants) is a separate finding and is untouched.
- **The remaining B15 routes.** The audit names `/agent`, experiments and Health as blocking before any HTML streams. Only `/agent` is addressed here — the one VB-023 points at.
- **Nothing was measured against the deployed application.** Every number above is a query count against the in-memory database, which counts *queries* and says nothing about latency, planner behaviour or network time. The indexes those batched queries want — `(prepared_change_id, created_at DESC)` on all six tables — were read from the live catalog and already exist, but no `EXPLAIN` was run and no page was timed.

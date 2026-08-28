# The open code items

**Recorded 2026-08-28, after the work.** Everything the launch audit left open in code: VB-025, VB-022, VB-016, B15's remaining routes, VB-043, VB-044, and the copy Wave 4's revoked-installation work never wrote. Two migrations, both deployed and verified by reading the catalog back.

What the batch has in common is that **most of these were already half-closed, and the half that was missing was the half nobody could see.**

## VB-025 — the reads that grow with the customer

Four unbounded reads. Two — the agent activity log and the audit-score history — were already capped in Wave 2. The other two were not, and the reason is worth reading.

### The ledger, and why it could not simply be capped

`listLedgerEntries` transferred **every** entry an account has ever had, on every render of the billing page, and it did so for two unrelated reasons: to show the last handful of movements, and to re-derive the posted balance so the materialized figure can be checked against the history that defines it ([ADR 0042](../decisions/0042-billing-reconciliation-authority.md)).

A cap serves the first and breaks the second. Summing a capped list on an account with more history than the cap reports drift that does not exist — and a false drift is not cosmetic: it alerts an operator, and with `BILLING_REPAIR_ENABLED` it *repairs* a balance that was correct.

So the sum moved to where the rows are. A PostgREST aggregate would have needed no new database object at all, and this project's PostgREST refuses them — measured, not assumed:

```
GET /rest/v1/billing_credit_ledger?select=credit_delta.sum()
{"code":"PGRST123","message":"Use of aggregate functions is not allowed"}
```

So `sum_ledger_deltas`, `SECURITY INVOKER`, with RLS deciding which entries are visible exactly as it does for a direct select. Verified by reading `pg_proc` back — invoker, stable, `search_path=""`, ACL exactly postgres/authenticated/service_role, `anon` cannot execute — which is the check [sprint 0106](0106-the-three-open-decisions.md) learned to make after shipping a revoke with no compensating grant.

The test seeds more entries than the cap and asserts the shown list is capped, the balance is not, and the two numbers differ. Replacing the database sum with a sum of the capped rows fails it.

### The dashboard, and a contract that was right

`dashboard-contract.test.ts` **forbade** a cap on the cross-project audits read, and its reasoning was correct: the read is ordered newest-first across every project and reduced to the latest per project, so a window filled by a busy product starves a quiet one and its card says *never analysed* about a project that has been analysed.

The cap is therefore paired with a re-read of any project the response hid — and only when the budget was actually spent, because a short response saw everything. The contract now asserts both halves stay together, and `getDashboardOverview` got the executable test it never had: a busy project with forty audits all newer than a quiet project's only one, and the quiet project's score read back. Removing either repair fails it.

## VB-022 — a fix that shipped, and could not be checked

Wave 2 closed half of this with React `cache()` on six getters, and [its own commit](https://github.com/TobiB1505/Vibe-Business/commit/1e204f9) says what was missing:

> The benefit itself is NOT verified. `cache()` only memoizes inside a render, so a unit test cannot observe it — the first attempt at one asserted a dedupe and failed, correctly.

That is exactly right, and it is also why `cache()` was the wrong shape. Measured again here: outside a render it calls straight through, so the duplication survived everywhere except the one render it was written for — a Server Action, a workflow step, anything else.

`readAuditEvidence` makes the deduplication explicit instead. The page reads the six documents once and hands them to `getAuditCurrency` and `getAuditReadiness`, which used to fetch them again, as did the profile-currency check inside the second. Now countable, and counted: each evidence table read exactly once, where the same composition previously read the repository snapshot three times before the page added a fourth.

The finding's other half was untouched: **existence checks that pull whole documents.** Onboarding fetched the analyzer result and the scored audit on every poll to evaluate `Boolean(x?.result)`. `hasSuccessfulSnapshot` and `getLatestAuditStamp` answer without them — and `status = 'completed'` is provably the same predicate, by CHECK constraint rather than by observation:

```sql
repository_intelligence_completed_has_result
CHECK (status <> 'completed' OR (result IS NOT NULL AND completeness IS NOT NULL))
```

**Found while writing that test:** the in-memory Supabase client dropped the options on `select(columns, { count, head })`, so every `head`-only count answered zero against it. `countPreparedChangesForProject` — what the Agent route's Suspense shell renders — was being tested against a double that could not have disagreed with it.

## VB-016 — a ceiling that was a delay

The gateway decided whether to forward by reading how much the run had spent, and that number comes from usage rows written in `after()` — after the response, because the tokens are not known until the stream ends. Two requests arriving together both read the same total and both passed.

`claim_gateway_request` increments a counter in one statement before the credential is injected and returns what it wrote; the route decides on that return. Never decremented: an attempt that failed still happened, and a counter an unreliable network could reset would be worth less than none, because it would look like one. `max_tokens` is lowered to what the run may still spend — lowered, never raised.

**The migration test says plainly what it does not prove.** Its first version claimed to test serialization; planting a read-then-write implementation passed it unchanged, because the harness runs one connection and sequential statements each see the previous one's effect. The atomicity is a property of `col = col + 1` under a row lock, and the decision property lives in the route test, where a claim landing past the ceiling refuses while the stale read still says there is room.

## B15 — the boundary that was the wrong fix

The audit asked for `<Suspense>` on `/agent` (done in [VB-023](0109-vb023-workspace-read-cost.md)), experiments and Health.

Experiments got something better. `getProjectImpact` built a full merge **card** per prepared change, and a merge card spends up to four read-only GitHub calls so it can tell a user whether an approved branch is still where their approval expects it. That is the right question on the Agent screen and a meaningless one here: this page lists changes that **already merged**, and a merged change is past that preflight. The whole third-party round trip bought a fact `change_merges.status` already states. The route now makes no GitHub call at all — which is why no boundary was added, and both files say so. A boundary would have moved the same wait behind a spinner and called it progress.

Health got no boundary either, and its file says why: its blocker was the duplicate document fetches, closed above, and `loading.tsx` is already a Suspense boundary around the page.

`project-impact-concurrency.test.ts` proved those GitHub calls overlapped without overlapping too much. Both properties are gone with the calls, so it is replaced by the stronger one: `repository_connections` is never read, which is the observable shape of never reaching GitHub.

## VB-043, VB-044, and the copy nobody wrote

**VB-043.** `/e2e/[scenario]` is a 404 unless `VIBE_E2E_FIXTURES=1` — a good argument that rests on a variable staying unset forever, in a dashboard, by everyone. `VERCEL_ENV` is set by the platform and a production deployment cannot unset it, so production refuses on its own terms too.

**VB-044.** Rule 53 said only `src/modules/operations/` may hold a service-role client; `service-boundary.test.ts` has enforced something else for a while — operations plus five reviewed sites with no session to scope a client with. A rule that forbids what the repository does, and what its own tests permit, teaches a reader to disbelieve the rules. And `UX-CONTRACT.md` said Product Scan polls every 2.5 seconds where the code says 1.8. Both old sentences are now retired claims, verified by putting the 2.5 back and watching the currency test fail.

**The copy.** Wave 4 gave Vibe the ability to notice a removed GitHub App and gave "Connect GitHub" somewhere sensible to send that user — and nothing ever said anything, so the Repositories page went on describing repositories as connected that Vibe could not read. The fact was already stored, so the row costs a joined column rather than the round trip this page deliberately never makes.

## Verified by breaking what it guards

| planted | caught by |
| --- | --- |
| the ledger summed from the capped list | the account with more history than the cap |
| the dashboard cap without its repair | the quiet project beside a busy one |
| `readLatestPerGroup`'s repair removed | the same, and the sets crowding case |
| the gateway claim ignored | the request landing past the ceiling |
| `max_tokens` forwarded unclamped | the call with 200 tokens left |
| a read-then-write claim | **nothing — see VB-016 above** |
| the merged filter dropped | the unmerged changes appearing as experiments |
| the 2.5s poll interval restored | the documentation-currency test |
| the revoked fixture set to null | four browser assertions |

## Validation

6980 unit tests (407 files) · 383 browser · 175 migration (12 files) · typecheck clean · lint 18 warnings, 0 errors · build green. Both migrations deployed before the code that needs them, each verified by an independent catalog read rather than from the apply response, and the local filenames converged to the stamped versions (rule 34).

## What is still open, and it is not code

- **A Supabase plan with backups.** The organization is on the free plan: no PITR, no automatic backup, under a database holding the Credit ledger and every customer analysis. [Wave 5](0108-wave5-verification.md) recorded this; nothing here changes it.
- **The four Sentry alert rules**, **VB-011's environment-variable scoping**, **a spend ceiling**, and **leaked-password protection** — all dashboard state, none of it reachable from a repository.
- **Synthetic DB scale tests**, which need a branch database that is not configured.

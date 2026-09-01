# The queries, and what the screen does while it waits

**Recorded 2026-09-01, after the work.** The audit's [Phase 2 and Phase 3](../audits/2026-09-01-performance-code-health/README.md), taken together in one session after [the six P0 fixes](0115-the-audits-first-six.md). Fourteen commits, no migration, no new dependency, no new infrastructure.

The two phases have one through-line, and it is the sentence the [region verification](../audits/2026-09-01-performance-code-health/region-verification.md) ended on. Moving the functions to Stockholm removed about 110 ms from every round trip, which left the **number** of round trips as the binding constraint rather than the distance of each — and, behind that, the fact that a render costing 665 ms of database time shows nothing at all while it happens.

Phase 2 is the count. Phase 3 is the wait.

## Phase 2 — the count

**The Action Plan asked every Move the same project-scoped questions.** `getActionPlanReadiness` was called once per Move inside a `Promise.all`, and every input it needs — the audit's currency, the founder intent, the opportunity set — is a property of the project, not of the Move. Five Moves meant roughly forty queries to compute five answers that differ only in which id they are asked about. It is now one `readActionPlanReadinessInputs` and a pure function mapped over the Moves, and `one-loop.test.ts` asserts the shape rather than the count so a returning N+1 fails on the call site rather than on a number somebody can adjust.

**Business Health was handed evidence and read it again.** `getAuditAccessStatus` and `getAuditEntitlementFacts` took no evidence pack, so the route read it, passed it to the two read models beside them, and watched this one read the whole pack a second time. The parameter is the fix, not `cache()`, for the reason [Sprint 0110](0110-the-open-code-items.md) gives: a value a caller can hand over is one whose absence a test can count.

**The bug that fix introduced, and the fixture that caught it.** The first version read `prefetched?.latestAudit ?? getLatestSuccessfulAudit(...)`, which re-reads the table whenever the pack legitimately says `null` — a project that has never completed an audit, which is every project on its first day. Presence of the pack decides now, not truthiness of the value inside it. The same mistake was avoided deliberately in this sprint's `getDeepScanAccessStatus`, where a missing project and a project with no production URL are two different answers that used to end at one branch.

**The Product Scan wrote its timeline four round trips at a time.** Each event verified the run, checked its own key, read the maximum sequence and inserted — up to 96 sequential round trips inside a workflow step, while the browser polled every 1.8 seconds for events that had not been written yet. `appendProductScanEvents` takes a batch: one read of what exists, one insert, sequence from position, `23505` answered by reading back. Its test asserts that one event and twenty cost the same number of reads, which is the property, rather than asserting a number.

**Two pairs were sequential because they were written on consecutive lines.** The billing overview read the credit account and then the subscription; `withinStartWindows` counted an account's recent starts and then a project's, with the second sitting behind a condition on an argument the caller supplied. Neither ever needed the other's answer.

**Onboarding awaited six state-gated reads in a row.** They are now one wave; only `auditFailure` stays sequential, because it depends on the result of one of them.

**One Supabase client per request.** `createClient` is wrapped in React `cache()`. This repository turned `cache()` down for the evidence pack and was right to — there the duplication was inside one render and the value could be passed explicitly. Here a layout and a page render independently, so there is no call site that could hand the client from one to the other: memoizing per request is not the easier fix, it is the only one. **No test covers it and none can**, which is written into the file rather than into this record alone: `cache()` memoizes only inside a React request scope and the test environment is Node. What would show it is the read count in production — one `projects` row per project navigation instead of two.

**A defect in the test double, found by a cap test.** `FakeDatabase` sorted every column lexicographically, so `sequence` ordered 1, 10, 11, 2. It was found because a cap test reported the 24th row as "9". It also mis-modelled agent execution events and the activity feed, so it went in as its own commit.

## Phase 3 — the wait

**Four routes had no first frame and three borrowed the wrong one.** Both halves of onboarding and both connect screens answered a click with nothing until their reads finished — onboarding being the longest read chain in the product and the screen a founder meets before they have any reason to believe it works, and the connect screens sitting on the return leg of a GitHub hand-off, where a blank page reads as the hand-off having failed. Profile, Settings and Repositories inherited the dashboard's skeleton, which draws a product grid none of them has: a skeleton that promises the wrong screen moves the layout twice, and the first move was a guess.

`loading-coverage.test.ts` holds the invariant, because a missing first frame is invisible in review — the route works, the tests pass, and the only symptom is a click that does nothing for as long as the reads take, which nobody sees locally where the database is milliseconds away. The two operator-only dogfood routes are exempt in a list that carries its reason.

**Three section headings had drifted.** Every workspace section is rendered twice, by its page and by the `loading.tsx` standing in for it, and the founder sees the skeleton first — so where the two disagreed they watched the description of the screen they were waiting for get replaced at the moment it arrived. Experiments promised "What actually changed after a merge" and delivered "Every change Vibe shipped". Project Settings offered to disconnect and then also to delete. My Product described where its understanding came from and then did not.

The audit found the first two by reading the files. **The third turned up only once the copy was in one place**, which is the argument for the shape of the fix: `WorkspaceSection` takes its title and description from its id and no longer accepts them as props. Matching strings is a rule somebody has to remember; having nothing to disagree about is not. The test asserts the absence of the props rather than the equality of the strings.

**Four Client Components read a clock or a locale while rendering.** The server renders them first, and Node and the browser answer differently — a second or so apart for the clock, a whole timezone and locale apart for the formatters — so React found a mismatch and threw the server's subtree away. [`format-datetime.ts`](../../src/lib/utils/format-datetime.ts) was written for exactly this defect and says so; these were the panels still asking the question on their own.

The clocks now come from `useBrowserClock`, which is null until an effect has run. **Not a hydration flag plus `Date.now()` in the render**: the React compiler's purity rule is right that an impure read does not belong in a render whoever is doing it, and the first attempt at this — a `useSyncExternalStore` hydration flag — was correct about hydration and still wrong about purity. The formatters moved to the shared helpers, including the Action Plan's refresh bar, which pinned UTC and still went through `Intl`, whose ICU data is per-runtime.

`hydration-safe-formatting.test.ts` makes it a repository rule rather than a review note, since this is the second time it has been fixed.

**Two API routes left the session proxy.** The Stripe webhook and the Agent Gateway each say in their own docblock that authentication is the signature, or the token, and nothing else, and neither reads a cookie — so a session refresh in front of them put Supabase Auth inside Stripe's delivery timeout and inside a paid upstream call, for a session nobody holds. **And the proxy's own client got the deadline it was missing**: it was the last Supabase client in the repository without one, on the critical path of every matched request.

**The staleness sweep stopped running on every poll.** `getOperationStatus` opened a service-role client and read the run by primary key *before* its own read, without condition — every tick of every polling surface, for everyone signed in, to answer "no". The order is reversed, not the guarantee: the read it was going to make anyway says whether a sweep could do anything, and `expireStaleOperation` still re-reads under its own authority before it writes. Evidence, not permission.

**Three retired addresses answer again.** `/score`, `/prepared` and `/understanding` still take traffic and still 404'd. Temporary redirects, not permanent, because a 308 lives in browser caches indefinitely.

## What the audit asked for and did not get

**No `<Suspense>` on Health or Plan.** [Sprint 0110](0110-the-open-code-items.md) already considered and rejected this, and the reason still holds: `loading.tsx` **is** the Suspense boundary of a route, both routes have one, and both skeletons already draw the same `WorkspaceSection` header. The reads sit in one `Promise.all` wave, so the slowest dominates with or without a boundary. The audit established the premise correctly — there is no `<Suspense>` in either file — and the conclusion does not follow from it.

**No `next/dynamic` for `product-scan-experience` or `audit-intelligence`.** Both are the *main content* of their routes. A dynamic import moves the main content later, not earlier.

**No `LazyMotion`, and the audit's version of it would have broken things.** It proposed `domAnimation` across all twenty motion files; `domAnimation` includes neither layout nor drag, and `product-scan-experience`, `action-plan-workspace` and `audit-intelligence` use `layout`, `drag` and `layoutId` — all three would have stopped animating silently. The Agent subtree is genuinely safe (twelve files, no layout, no drag, no `AnimatePresence`), and it is still not converted, because **the change could not be measured here**: Turbopack's build output prints no First Load JS table, and the per-route client manifest attributes none of the seven chunks that mention motion (about 96 kB gz in total, largest 30.8 kB) to any one route. What was measured is recorded below. The analyzer and the CI size gate are Phase 6 in the audit, and that is the right place for them.

**No poll-interval tiers.** Fourteen files each define a `POLL_INTERVAL_MS` between 1.8 s and 15 s, and naming them at the hook is cosmetic now that the in-flight guard from [Sprint 0115](0115-the-audits-first-six.md) has removed the hazard the audit named. It would also make `UX-CONTRACT.md`'s sentence about where that number lives false, for no measured benefit.

**Nothing from Phase 2 that touches Billing correctness.** [PERF-007](../audits/2026-09-01-performance-code-health/README.md) also asks for the expiry sweep to be batched and the double `ensureCreditAccount` removed. Those are inside the credit admission chain and belong in a slice that runs the concurrency gate as its own subject, not at the end of a frontend sprint.

## Measured

Client chunk totals at the end of this sprint, gzipped, from the per-route client-reference manifests — recorded so Phase 6 starts from a number rather than from nothing:

| route | chunks | gz |
| --- | ---: | ---: |
| project home | 12 | 239.5 kB |
| plan | 11 | 114.0 kB |
| agent | 11 | 113.1 kB |
| product | 10 | 99.1 kB |

Seven built client chunks mention `motion`, totalling roughly 96 kB gz. **How much of that is the library rather than the application code beside it is not measurable without an analyzer**, which is exactly why the conversion was not made on the strength of it.

## Verification

`pnpm lint` 0 errors and 22 pre-existing `no-unused-vars` warnings, `pnpm typecheck` clean, `pnpm test` **419 files / 7,210 tests green**, `pnpm build` green with the redirects present in the route output.

Six of the new guards were checked by planting the defect they exist to catch: a `title` prop back on a `WorkspaceSection`, an unknown section id, the ignored `owned` project, the unconditional staleness sweep, the missing proxy deadline, and a `toLocaleTimeString` back in a client component. Each failed, and only the intended assertion failed.

**The E2E suite did not run.** Playwright expects `chromium_headless_shell-1234` and this container's image carries `-1194` — the same limitation [Sprint 0115](0115-the-audits-first-six.md) recorded. `product-scan.spec.ts`, `agent-streaming.spec.ts` and `auth.spec.ts` are the specs this touches, and none of them has been run against these changes.

## What has not been proved

- **That the hydration mismatches are gone.** They show as warnings in a browser's console, and no browser has opened these screens. What is proved is that the code no longer contains the constructs that cause them, and that a test now refuses their return.
- **That the first frames look right.** A skeleton is a visual claim about a screen, and these were written by reading the routes they stand in for.
- **That `cache()` removed the duplicate project read.** Stated in [`server.ts`](../../src/lib/supabase/server.ts) as an open question with the observation that would close it: one `projects` row per project navigation in Supabase's edge logs instead of two.
- **That any of this moved a page-load number.** The TTFB and LCP budgets in the audit remain unassessed for the reason the region verification gives — Speed Insights is not readable from this environment and the egress proxy refuses the production domain. Reading them in the Vercel dashboard is still the next piece of evidence worth having.
- **`ProductLogo` still shifts its row**, deliberately. The obvious fix would resize customers' logos on the two call sites that pass no className, and that is a change to make while looking at the screen rather than while reading the file.

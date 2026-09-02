# The rule that forbade what shipped

**Recorded 2026-09-02, after the work.** Five commits, no migration, no product change. PERF-024 and PERF-025 — the last two audit items that were blocked on nothing.

## A rule in the working agreement was false

CLAUDE.md rule 38 said: *do not introduce browser automation or headless-browser dependencies (Playwright, Puppeteer, Chromium, Browserless, Browserbase, Firecrawl, Apify)*. `@browserbasehq/sdk` and `playwright-core` are **production dependencies**.

The rule was not violated. Its own escape clause — "changing that requires a new ADR" — was honoured: [ADR 0012](../decisions/0012-authenticated-browser-analysis.md) decided authenticated browser analysis on 2026-08-11 and says in its header that it *complements* the static-inspection decision rather than replacing it, and [ADR 0017](../decisions/0017-visual-review-artifacts.md) builds visual review on top. The rule simply never learned that it had been amended.

**Rule 83 names CLAUDE.md as a current-state document**, which makes this a defect in the governing document itself — and the worst kind, because a rule that forbids what already shipped will stop a future session from doing something that is decided. Rewritten in place, never renumbered: the public scan stays static, the two exceptions are named with their ADRs, and a third use is still a new ADR.

That is the same repair rule 24 got when `pg_cron` arrived, and it is becoming a pattern worth naming: **a rule with an escape clause needs the escape recorded in the rule, or the rule becomes a lie the moment somebody uses it correctly.**

## Twenty-five log lines that were not only noise

`pnpm build` printed `[auth.session] Supabase is not configured; treating as signed out.` twenty-five times. Measured, not recalled.

The cause is not a misconfiguration. `createClient` awaits `cookies()` **before** it reads the environment, and during static generation `cookies()` raises Next's `DynamicServerError` — the framework's own signal that a route is dynamic. `getSession` caught every throw and reported all of them as "not configured".

So the noise was the visible half. The other half is that a caller asking *is anyone signed in* got `null` for a question the framework was trying to refuse.

The fix inverts the catch: the configuration failure gets its own type, and everything else is rethrown. Two alternatives were rejected. Matching on the error message works and breaks the first time somebody improves the wording. Recognising the dynamic error by type needs `isDynamicServerError` from under `next/dist/` — a deep import into a framework's internals to identify one error, which is a worse dependency than inverting the condition.

**Verified both ways**: 25 lines to 0, and the route table is identical before and after — 51 routes, the same one static, none changed its rendering mode. That second check is the one that mattered: rethrowing a dynamic-rendering signal could plausibly have flipped prerendered routes to dynamic, and it did not.

## The pin that added a warning instead of removing one

PERF-024's other half cites an `engines` warning as build-log noise. `engines.node` was `>=20.9.0` while `.nvmrc` says `24.13.0` and CI installs from `.nvmrc`, so the two disagreed about what this project runs on.

Pinned to `24.x` — and **this does not remove a warning, it adds a true one.** On the Node 22 in this container there was none before and there is one now, because Node 22 really is unsupported here. The warning the register saw could not be reproduced in this environment, so the alignment of two files that should agree is the whole argument, and the noise half of that item is the log lines rather than this.

## Not every stale-looking name was stale

PERF-025 asked for `agent-dogfood` to be renamed. Reading it produced a more specific answer than the register's.

`agent-dogfood/page.tsx` is **already** nothing but a compatibility redirect for links made before the Agent workspace became canonical. Renaming that directory would defeat the one thing it exists to do. And `[stepKey]` under it is a live, allowlist-gated URL, so a rename needs a redirect with traffic evidence — the standard PERF-023 set for exactly this, and evidence I do not have.

What *was* wrong is that the production Agent screen imported `startDogfoodRunAction`, `getDogfoodRunStatusAction` and `resolveDogfoodFounderInputAction`. A run started there is an agent run; nothing about starting, polling or answering it belongs to the internal allowlist. Those are renamed.

**`isDogfoodEligibleProject` and `resolveDogfoodPlanRoutes` keep their names**, and that is the finding rather than an omission: they name the operator-managed allowlist [CLAUDE.md](../../CLAUDE.md) rule 78 requires, so "dogfood" is accurate there. A sweep over the word would have made two correct names wrong.

## Two of the five were already true

Checked rather than assumed, and neither needed a change:

- The ROADMAP entry `documentation-currency.test.ts` was said to cite without existing **exists** — module READMEs, `docs/ROADMAP.md` line 166.
- The UX-CONTRACT sentence naming `POLL_INTERVAL_MS` in `product-scan-experience.tsx` as "where the number lives" is **true at HEAD**: `POLL_INTERVAL_MS = 1_800` at exactly that path. It stayed true because [Sprint 0116](0116-the-queries-and-the-wait.md) dropped the poll-tier commit that would have moved it — a deferral that turns out to have kept a document honest.

## Verification

`pnpm lint` 0/0 · `pnpm typecheck` clean · `pnpm test` **7,379 tests in 427 files** · `pnpm build` green.

The narrowed catch was checked by planting the old broad one: the rethrow test fails and nothing else does.

**No E2E run** — the same container limitation as the last eight sprints.

## What has not been proved

- **That the `engines` warning the register saw is gone.** It could not be reproduced here, so the change rests on `.nvmrc` and `engines` agreeing rather than on a measurement.
- **That `agent-dogfood` should keep its directory name.** The argument above is why it was not renamed *here*; whether the live child route is worth moving behind a redirect is a decision with traffic evidence behind it, and nobody has that evidence yet.

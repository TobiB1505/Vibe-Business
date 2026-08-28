# Wave 5 — final verification

**Recorded 2026-08-28, after the work.** The launch audit's last wave is not a building wave: *"Only successful verification moves items to Done."* So this record is mostly a status table, and its value is in the rows that say **no**.

Three things came out of it that were not on anyone's list: a claim in this repository's own runbook that turned out to be false, a test the matrix asked for that had never been written, and a header set nobody had ever seen a browser receive.

## What was actually run

Everything below was executed in this session. Nothing is inferred from code reading.

| Check | Result |
| --- | --- |
| `pnpm audit --prod` | **no known vulnerabilities** |
| Supabase security advisors | **zero database WARN** — the two `record_auth_attempt` definer warnings are gone with VB-053. Four INFO `rls_enabled_no_policy`, all deliberate: the absence of a policy *is* the access control on those tables |
| Supabase performance advisors | zero WARN. `auth_rls_initplan` 0, `unindexed_foreign_keys` 0, 82 `unused_index` INFO — still meaningless on a pre-launch database |
| Cross-tenant sweep (new, real PostgreSQL) | every table in `public` for `anon`; every owner-scoped and project-scoped table for a second signed-in user — **zero leaks** |
| Security headers on a real HTTP response (new) | all six present with their expected values, CSP still report-only, `X-Powered-By` absent |
| `/api/health` over HTTP (new) | 200, exactly `status`/`commit`/`environment`, `no-store`, no redirect without a session |
| Unit / migration / browser / canary suites | see Validation below |

## The claim that was false

[The rollback runbook](../deployment/migrations-and-rollback.md) — written three sprints ago, in this session — said:

> Supabase's own point-in-time recovery is the only mechanism that undoes a destructive migration…

Checking it rather than repeating it: the Supabase organization is on the **free plan**, and [Supabase's documentation](https://supabase.com/docs/guides/platform/backups) says daily backups cover *"all Pro, Team, and Enterprise Plan projects"* and recommends free-plan projects *"regularly export their data using the Supabase CLI `db dump` command."*

**There are no automatic backups and no PITR.** Every audit, action plan, prepared change and Credit-ledger row lives in one database with no recovery point behind it. The runbook now says that, describes the manual `db dump` that is the whole of the safety net, and states plainly that neither the dump nor a restore has been exercised.

It is worth naming how this got written: the sentence was true of Supabase in general and never checked against *this* project. That is the same shape as VB-041 (a table describing installations "verified as accessible" that nothing re-verified) and VB-053 (a grant assumed from a platform default that `pg_proc.proacl` disagreed with). Three times in this audit, the defect was a plausible general fact that nobody had asked the specific system about.

**Buying a recovery point is an operator's decision, not an engineer's**, so it is not made here. The pre-launch checklist item *"Supabase PITR confirmed on; restore runbook written and exercised once"* **cannot be ticked**, and that is the honest state.

## The test the matrix asked for and nobody had written

> **RLS direct** — PostgREST calls with B's JWT against A's rows on all 50 tables; anon-key calls with no JWT → *zero rows / 42501*

Every other migration test in `supabase/tests/` checks one table, one policy or one function, each written when that thing was built and each therefore scoped to what its author was thinking about. None of them answers the question the plan asks: **is there any table at all where this fails?**

`cross-tenant.migration.ts` enumerates from the catalog rather than from a literal — so a table added next month is in the sweep the day it exists, and one whose grants nobody thought about fails here rather than in production. It records *how* each table is protected, because the plan accepts two answers and they are not equally strong: a table the client cannot reach at all is protected by privilege, one it can query but sees nothing in is protected by a policy.

Verified by planting the failures it exists to catch: a permissive `select … using (true)` on `projects`, and a `grant select on projects to anon`. Each makes the sweep name that table.

## The headers nobody had seen a browser receive

`headers.test.ts` asserts the header *table* — that the function returns six entries with the right values. Nothing asked whether the server sends them. That is [rule 69](../../CLAUDE.md)'s named failure mode: the domain state tested, the contract tested, and the thing a client actually receives untested. A `headers()` block that never matched would have passed every test in `pnpm test`.

The Playwright `webServer` runs `next start`, so `e2e/security-headers.spec.ts` reads real responses from the production server. It also closes VB-034's own residue — sprint 0105 recorded that `/api/health` had never been called over HTTP, and now it has.

## What is not executable from this session, and why

Each of these was **attempted**, not assumed:

- **Lighthouse / RUM against the deployed site.** The session's egress gateway answers `403` to `CONNECT vibebusiness.de:443` — a policy denial by this environment, not a fact about the site. Confirmed against `$HTTPS_PROXY/__agentproxy/status`, which lists the rejections by host. Field p75 across real users is what the SLO is about anyway, and that lives in Vercel Speed Insights.
- **Deployed header verification.** Same denial. What is proven is that the application's own configuration produces the headers; Vercel's edge may add or strip others, and nobody here has read a deployed response.
- **Cross-user IDOR through the running application.** The sweep proves the database layer, which is where the guarantee lives — a policy that denies there denies through any client. Driving every route and action as a second real user needs two real accounts, and the browser suite points at a Supabase project that does not exist by design.
- **The remaining Security Test Plan rows that need a real session or a real provider**: CSRF against a deployed Server Action, Stripe webhook replay, OAuth state replay, gateway token replay, sandbox env enumeration. Each has unit or migration coverage of its mechanism; none has been driven end to end against production.
- **Synthetic DB scale tests.** The audit forbids ANALYZE-heavy experiments against the production project and points at branch databases; none is configured.

## The pre-launch checklist, as it actually stands

| Item | State |
| --- | --- |
| VB-001/002/003 validated | Covered by migration tests; **not dogfooded** — no real account has been erased |
| Security headers live; cookies `Secure` | Proven on real local responses. CSP report-only, and the *"≥1 week then enforced"* clock has not started |
| `pnpm audit --prod`: zero high | **Green** |
| Window limits + auth throttling active; `bundled_with_free_audit` gated | Code and migration tests green; no real sign-in has met the throttle |
| Preview proven unable to touch production data or spend money | **Open — VB-011.** Not answerable from here; the Vercel MCP surface exposes no environment-variable scoping |
| Alerting fires on synthetic events | **Open.** Wave 3 made the events reach Sentry; no alert rule exists and none has fired |
| Stripe stuck-claim expiry deployed; replay test green | Deployed; replay not exercised against Stripe |
| `anon` surplus grants revoked; advisors clean | **Green**, and now swept table by table |
| Staleness coverage for all operation families | **Green** — total `Record`, one stated exemption |
| Supabase PITR confirmed on; restore runbook exercised | **Cannot be ticked.** See above |
| Security Test Plan matrix executed with zero unexplained failures | **Partly.** Every row executable from here is green; the rows above are not executable from here |
| Vitals met on marketing + dashboard (mobile) | **Open.** Egress denied; needs Speed Insights |
| CI green at the launch commit | **Green** |

## What has not been proved

- **No item above moved to Done by dogfood.** Everything green here is green against tests, a local production server, or the deployed database's catalog — not against a customer using the product.
- **The cross-tenant sweep is psql, not PostgREST.** That is the layer the guarantee lives at, and a defect in PostgREST's own claim handling would not appear.
- **The header assertions are local.** Vercel's edge is a second hop nobody here has observed.
- **`db dump` has never been run** against this project, so the one recovery path that exists on the free plan is itself untested.

## Validation

| check | result |
| --- | --- |
| Unit tests | 6929 passed, 402 files |
| Browser tests | 377 passed (was 366 — the header and liveness specs) |
| Migration tests (real PostgreSQL) | 167 passed, 11 files (was 158/10 — the cross-tenant sweep) |
| Agent canaries (real SDK, zero provider cost) | 22 passed, 1 skipped |
| `pnpm audit --prod` | no known vulnerabilities |
| Supabase advisors | 0 security WARN from the database, 0 performance WARN |
| `pnpm typecheck` | clean |
| `pnpm lint` | 18 warnings, 0 errors |

The two new suites were verified by planting the failures they exist to catch: a permissive `select … using (true)` on `projects` and a `grant select on projects to anon` each make the cross-tenant sweep name that table.

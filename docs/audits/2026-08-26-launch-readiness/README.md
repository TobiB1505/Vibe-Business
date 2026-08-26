# Launch Readiness Audit — 2026-08-26

**Scope:** full-repository production launch readiness — security & abuse protection, performance & scalability, reliability & operations, release environment.
**Audited at:** commit `39a2bbf` (HEAD of `main` at audit time) · 1,054 TS/TSX files, ~242k lines, 63 migrations, 50 live tables.
**Method:** direct inspection of production paths (entry points, migrations, workflow steps, sandbox/gateway code), `pnpm audit` against the live registry, and the full unit suite executed at HEAD (359 files / 6,453 tests, all green, 32s). Repository evidence overrides comments, ADRs and intent throughout. Read-only: no code was changed by this audit.
**Record status:** this is an audit record under `docs/audits/` (CLAUDE.md rule 83) — it states what was true at `39a2bbf` and is never edited to match the present.

Statuses: `PASS` / `PARTIAL` / `FAIL` / `N/A` / `UNKNOWN`. Risk: `CRITICAL` / `HIGH` / `MEDIUM` / `LOW`. Backlog lifecycle: `New → Implemented → Needs Review → Validated → Done`; **Implemented ≠ Done** — only successful verification permits Done.

---

## 1. Executive Summary

**Overall launch readiness: not yet advisable for public launch.** The codebase is unusually well engineered where it matters most — authorization, RLS, billing atomicity, sandbox isolation, SSRF, and injection defense are implemented to a standard well above typical early-stage SaaS, with security rationale documented at the point of enforcement and structurally tested (CI-enforced route-guard tests, a real-Postgres billing concurrency gate, a service-role import allowlist test). No cross-tenant read/write path (IDOR) was found anywhere. However, the audit found one **FAIL/HIGH cluster** (data deletion is structurally impossible and the erasure/retention model is wrong-by-default), one **FAIL/MEDIUM** browser-hardening gap (zero security headers, with a JS-readable session cookie raising the stakes), several **unmetered cost/abuse paths**, one small but real **billing bypass**, and **no production alerting**. These are all closable; none requires an architectural rewrite.

**Top 10 risks:**

1. **Deletion is impossible; erasure is wrong-by-default (A22, C15-1 — FAIL/HIGH).** The `execution_specs` immutability trigger raises on cascaded deletes, so any user or project that ever resolved an execution spec is permanently undeletable; where deletion *would* work, the billing ledger is CASCADE-wiped with the auth user; `disconnectProject` failures are silently swallowed and the user is shown success; the 7-day screenshot retention promise is never executed at the storage layer.
2. **Zero explicit security headers (A17 — FAIL/MEDIUM)** — no CSP, HSTS, `nosniff`, frame protections, Referrer-Policy or Permissions-Policy anywhere; combined with the `@supabase/ssr` default `HttpOnly:false`, `Secure`-less session cookie (A1), any future XSS is session theft.
3. **Unlimited free paid-inference loop (A6/A7).** Product scan/understanding are free by policy, include a paid Anthropic call, and have no window limit; validation/preview/review starts spend Vercel Sandbox and Browserbase money with no credit admission and no rate limit.
4. **Billing bypass via `bundled_with_free_audit` (A7).** The onboarding opportunity action starts generation free with no onboarding-state check — after any paid audit it substitutes for the 20-credit workspace path.
5. **Preview/production separation unproven (D1/D2 — UNKNOWN/HIGH).** One Supabase project exists; if Vercel Preview scope carries the production service-role key/Anthropic key/gateway secret, every preview deployment can write production data and spend real money.
6. **Known high-severity advisories in production dependencies (§0).** undici 7.28.0 (2 high + 3 moderate, cross-user cache disclosure among them) and nanoid 5.1.6 (high), both transitive via `workflow@4.8.2` / `@vercel/sandbox@3.0.0`.
7. **No alerting (C8).** `credit_drift.*`, settlement failures, staleness expiries and gateway refusals are persisted and nothing pages anyone; Sentry is wired but no alert rules exist as code.
8. **Stripe webhook stuck-claim (A20/C5).** A crash between event claim and completion leaves the event `processing`; every Stripe retry then gets 200/`duplicate` — the customer paid and the grant never posts, silently.
9. **Died workflows wedge un-swept operation families forever (C6).** `product_scan`, `product_understanding`, all `change_*`, `business_measurement` have no staleness path — a dead run holds the single-active identity index and renders "Analyzing…" indefinitely.
10. **Owner self-forgery of pipeline evidence (A3-2).** Broad owner UPDATE policies let a user set their own `validation_runs.status='passed'` or rewrite `prepared_changes.commit_sha` — no cross-tenant impact and merge re-verifies live state, but "validated" becomes client-writable, against rule 66.

**Item counts (Master Backlog, §11):** **P0: 3 · P1: 16 · P2: 24 · P3: 9** (52 tracked items).
**Biggest security gap:** absent security-header/CSP layer over a JS-readable session cookie (A17 + A1.3).
**Biggest performance gap:** duplicate JSONB document fetches (repo snapshot ×4, audit ×3 per Business Health render) plus three unbounded ever-growing reads (credit ledger, audit readings, cross-project audit history).
**Biggest reliability gap:** no alerting, no health endpoint, and the unswept-operation/stuck-claim recovery holes.
**Launch verdict:** complete Wave 0 (P0) and Wave 1 (P1) before public launch. The deletion/erasure cluster and the headers work are the pacing items; everything else in P1 is S/M complexity.

---

## 2. Architecture / Trust Boundary Map

```
UNTRUSTED                                TRUSTED (Vibe)                                 EXTERNAL (trusted vendors)
─────────                                ──────────────                                 ──────────────────────────
Browser (user) ──cookies (RLS)──▶ Next.js App Router (Vercel)
  │  Server Actions (origin-checked,       │
  │  requireSession + ownership)           ├──anon key + user JWT──▶ Supabase Postgres (RLS on all 50 tables)
  │                                        ├──service-role key─────▶ Supabase (RLS bypassed; only operations/ +
  │                                        │                          3 tested billing sites; ownership re-derived)
  │                                        ├──App JWT/installation──▶ GitHub (Metadata:RO + Contents:RW only;
  │                                        │   token (in-memory)       create-ref-only writes; FF-only merge)
  │                                        ├──ANTHROPIC_API_KEY────▶ Anthropic API (no tools, no reasoning stored)
  │                                        ├──Stripe secret────────▶ Stripe (webhook = HMAC + 3-layer idempotency)
  │                                        └──▶ Vercel Workflows (durable log: ids only — EXCEPT candidate
  │                                             file bytes in agent-execution, rule-52 deviation VB-017)
  │
Customer repository (UNTRUSTED data, never instructions)
  └─▶ read via GitHub API under budgets; sensitive paths never fetched
  └─▶ executed ONLY in Vercel Sandbox microVMs:
        Validation sandbox: deny_all egress in every repo-controlled phase; no credentials;
                            clone credential destroyed + absence verified before repo code runs
        Agent sandbox:      egress = [gateway host] only, narrowed before the agent exists;
                            env = 3 inert vars + scoped HMAC gateway token; tools = Read/Write/
                            Edit/Glob/Grep/Bash only (no WebFetch/WebSearch/MCP);
                            diff observed by Vibe (marker+listing), never taken from the agent
Customer website (UNTRUSTED) ──▶ safe-fetch boundary only (DNS-pinned, private-IP/metadata blocked,
                                  per-hop redirect revalidation, budget-bounded) / Browserbase screenshots
Stripe / GitHub webhooks (UNTRUSTED payloads) ──▶ signature-verified; owner resolved from Vibe's own mappings
Agent Gateway (/api/agent-gateway/v1/messages): the ONE endpoint an untrusted VM can reach —
  HMAC token (exact route+model binding, expiry) AND durable state re-read per request; opaque refusals
```

**Trust labels:** browser input, customer repo content, customer website content, webhook payloads, and all model output are untrusted data (rules 18/25/36/42/57 — verified enforced in code, §3/§8). Vercel, Supabase, GitHub, Anthropic, Stripe, Browserbase are trusted vendors reached with least-privilege credentials. The durable workflow log is a third-party store that must carry ids only — one verified deviation (VB-017).

---

## 3. Security Audit (Track A)

### §0 Dependency & framework security — **PARTIAL · HIGH (advisories) — VB-007**

| Package | Installed | Latest at audit | Assessment |
|---|---|---|---|
| next | 16.3.0 | 16.3.3 | Patch-level behind; **no advisory against 16.3.0 in the npm audit DB at audit time**; upgrade with the batch |
| react / react-dom | 19.2.8 | 19.2.8 | Current |
| @supabase/supabase-js / ssr | 2.112.2 / 0.12.4 | 2.112.4 / 0.12.5 | Patch-level behind |
| @anthropic-ai/sdk | 0.115.0 | 0.120.0 | Behind; no known advisory |
| stripe | 22.5.0 (API `2026-07-29.dahlia` pinned) | 22.5.0 | Current, pin documented |
| zod | 4.4.3 | 4.4.3 | Current |
| workflow | 4.8.2 | 4.8.5 | **Carries vulnerable undici + nanoid** (below); also exempted from the release-age quarantine in `pnpm-workspace.yaml` |
| @vercel/sandbox | ^3.0.0 | 3.1.0 | **Carries vulnerable undici**; only caret-ranged critical runtime dep |
| playwright-core | 1.62.1 (patched) | — | Patch adds `./browsers.json` export only — benign |
| node | >=20.9.0, `.nvmrc` 24.13.0 | — | Current LTS line |

**Live `pnpm audit --prod` result (2 high, 4 moderate):** `undici@7.28.0` (<7.29.0) — high: cross-user information disclosure via degenerate private cache directives; moderates: downstream response mixup, CRLF injection via blob-like body, cookie attribute injection (paths: `@vercel/sandbox`, `@workflow/world-local`, `@workflow/world-vercel`); `nanoid@5.1.6` (<5.1.16) — high: non-secure generator infinite loop on negative size (path: `@workflow/core`). All server-side clients to fixed vendors, so practical exploitability is low — but these are exactly the HTTP clients under the durable-execution and sandbox layers. **Fix:** bump `workflow` and `@vercel/sandbox`, or add pnpm `overrides` for `undici>=7.29.0` / `nanoid>=5.1.16`; re-run `pnpm audit --prod` to verify zero high findings. Install-script hardening is already good (`pnpm-workspace.yaml` allowBuilds restricted; agent SDK exact-pinned and installed `--ignore-scripts` inside the sandbox only).

### A1 Authentication — **PASS with two PARTIALs**

| Item | Status | Evidence |
|---|---|---|
| Session verification | PASS | `getClaims()` (JWT signature verified) everywhere: `src/lib/supabase/proxy.ts:107`, `src/modules/auth/session.ts:49`; **zero** callers of unverified `auth.getSession()`/`getUser()`; fail-closed on verification error; `requireSession()` in `src/app/app/layout.tsx:11` and every action |
| Cookie flags | **PARTIAL · MEDIUM — VB-006** | No `cookieOptions` passed anywhere; `@supabase/ssr@0.12.4` defaults verified in the package dist: `SameSite=Lax`, `HttpOnly:false`, `Path=/`, 400-day maxAge, **no `Secure` attribute**. Rec: `cookieOptions:{secure:true}` in `server.ts`/`proxy.ts`/`client.ts`; document the accepted `HttpOnly:false` tradeoff |
| Google OAuth / PKCE | PASS | Server-side `signInWithOAuth` under `@supabase/ssr` PKCE (`src/modules/auth/actions.ts:139–161`); `exchangeCodeForSession` (`auth/callback/route.ts:71`); replayed codes fail on verifier cookie / consumed flow state; codes never logged |
| Password reset | PASS | `verifyOtp` on `token_hash` (`auth/confirm/route.ts:64`); recovery redirects to a fresh `/reset-password` so the token never survives into history/referrer; expired/reused/tampered → uniform `expired_link` |
| Password policy | PARTIAL · LOW — VB-037 | Minimum 6 chars (`actions.ts:230`, `signup-form.tsx:105`); raise to ≥8 (code + Supabase dashboard policy) |
| Account enumeration | PASS | Fixed-copy classified errors (`errors.ts:157–161`), identical taken-vs-fresh signup results regression-tested (`actions.test.ts:257–281`); forgot-password always succeeds |
| Logout / revocation | PASS | `signOut({scope:"global"})` (`actions.ts:268–277`) — leaked session copies revoked server-side |
| Redirect origin | PARTIAL · LOW | `requestOrigin()` trusts `x-forwarded-host` (`actions.ts:38–45`), bounded by the Supabase Redirect-URL allowlist — **verify the allowlist has no wildcard** (external, §15) |
| Open redirects | PASS | `sanitizeNextPath` (`redirects.ts:105–141`): blocks absolute, `//`, backslash, control chars, convergent-decoded escapes; relative `Location` only; property-tested (`redirects.test.ts:36–155`) |

### A2 Authorization / multi-tenancy — **PASS · LOW**

All 23 `actions.ts` and 6 `route.ts` entry points were enumerated and each traced: identity always from the verified session, never a parameter; ownership by explicit `projects.eq("user_id", session.userId)` and/or RLS on the cookie-scoped client; every ID class (`projectId`, `operationId`, `preparedChangeId`, `auditId`, `planId`, `interruptId`, `approvalId`) probed for IDOR — another tenant's ids resolve to nothing. **Structural guarantee:** `workspace-routes.test.ts:122–133` asserts in CI that every project page calls `requireProjectAccess` and never reads `userId` from params. Model output never controls ids, refs, branches or paths (verified, §8). Minor (VB-045, P3): two read actions (`getReviewStatusAction`, `readProductionOutcomeAction`) rely on RLS alone — safe, add explicit checks as defense in depth. Dogfood pages are ownership- **and** operator-allowlist-gated with `notFound()` (tested in `agent-dogfood/security.test.ts`), and still hold credits — no billing bypass there.

### A3 Supabase RLS — **PASS (qualified) · MEDIUM**

Complete inventory of all 50 tables (Database Review, §6): RLS enabled on 50/50; deny-by-default (SELECT-only or no policies) on every financial and execution-record table; `billing_stripe_events` fully deny-all; all policies permissive with ≤1 per command (no stacking hazards); every join-through predicate terminates at `projects.user_id = auth.uid()`; the approvals→merges→outcome INSERT-policy chain re-verifies SHAs including merge read-back equality. Storage: `review-screenshots` private, owner-scoped SELECT only, 300s signed URLs.

Findings: **A3-2 (MEDIUM — VB-018)** owner self-forgery: blanket owner UPDATE policies on `validation_runs` (can set `status='passed'`; migration `20260812170000:138–144`), `prepared_changes` (can rewrite `commit_sha`/`base_sha`/`branch_name`/`files`; `20260812060000:152–158`), `business_readiness_audits` (can rewrite `result`/score; `20260810013000:183–189`) — downstream `change_approvals` INSERT treats these as evidence. Mitigated (merge is service-role, fast-forward-only, live-revalidated; own-repo only; no cross-tenant path) but "sandbox_validation_passed" must not be client-writable (rule 66). **A3-3 (MEDIUM-LOW — VB-019)**: UPDATE `WITH CHECK` does not re-pin the denormalized `user_id` on `operation_runs`/`prepared_changes`/`validation_runs`/`preview_sessions`/`review_artifacts` — an owner can poison the trusted-owner column workflow steps filter on (impact: stalled op, not cross-tenant). **A3-5 (LOW — VB-036)**: client INSERT into `ai_usage_events`/`deep_scan_provider_usage` permits cost-ledger pollution and pre-claiming a `job_id` unique slot (denial of the real usage write). **A3-4 (LOW — VB-049)**: `execution_interrupts` owner UPDATE field-unconstrained.

### A4 Service-role safety — **PASS · LOW**

`@/lib/supabase/service` importers are exactly `src/modules/operations/**` plus three reviewed sites (Stripe webhook, `billing/actions.ts`, `connect/github/repositories/actions.ts`) — enforced by `service-boundary.test.ts` whose `REVIEWED_SITES` list is the review record. Key is `server-only`, presence-validated without echoing, never `NEXT_PUBLIC_`, never logged, never in any client component. Every service-role query re-derives ownership from a persisted row or signature-verified token claims — never caller args; workflow steps receive only `operationId` (`vercel/executor.ts:65`). CLAUDE.md rule 53's literal wording lags the tested allowlist — doc-currency nit (VB-044).

### A5 Input validation — **PARTIAL · LOW-MEDIUM — VB-028**

Validation is by construction (minimal surfaces, closed enums, domain parsers: `parseCreditPackKey`, founder-intent enum tables, correction field allowlist + 600-char cap, https-only production URL normalizer, interrupt answers validated against the *stored* schema under CAS) rather than boundary schemas — zod is a dependency but used only in `src/lib/env` and agent tool defs. AI output validation is strong: cited evidence ids verified against the pack with unknowns dropped, unassessable lenses forced to `null` never zero, bounded text — rules 44/45 enforced in code. Gaps: no UUID-format guard at any boundary (non-UUID path segment → Postgres 22P02 → 500 instead of 404); GitHub/Stripe API responses are typed casts, not runtime-validated (VB-028, P2; adapter zod P3).

### A6 Rate limiting — **PARTIAL · MEDIUM — VB-008/VB-010**

Exists: audit 5 starts/project/hour (provider failures excluded), deep scan 5/hour + 2-min abandonment cooldown, gateway per-run 429s, DB single-active dedupe everywhere. **Missing:** application-level limits on sign-in/sign-up/reset (Supabase's IP-keyed limits are diluted because all server-side calls originate from shared Vercel egress IPs — per-account throttling needed), project creation, **product scan/understanding** (constant identity ⇒ unlimited sequential free runs, each with a paid inference), validation/preview/review starts (Vercel Sandbox + Browserbase spend with no admission), Stripe checkout creation. The proven entitlement-window pattern extends to all of these with no new infrastructure (rule 24-compatible).

### A7 Economic abuse — **PASS with gaps · MEDIUM — VB-009**

Admission chain verified end-to-end: entitlement → reuse-by-identity → active-run dedupe → affordability pre-read → operation row (unique idx) → credit hold (atomic claim + lot allocation) → enqueue → settle-once/release. Overspend impossible at the DB (`available_non_negative` CHECK, `settled_within_reserved`, idempotency uniques); marker-before-paid-call implemented (rule 50, `business-audit/execution.ts:546–575`); provider caps layered (input-token gate pre-call, `maxOutputTokens`, agent 100-credit/20-min/sandbox-lifetime/gateway ceilings); welcome-grant farming ruled out (account-scoped identity). **Gaps:** (1) the free-inference loop above; (2) **`bundled_with_free_audit` bypass — `onboarding/[projectId]/actions.ts:306–350` starts opportunity generation free with no onboarding-state check**, substituting for the 20-credit path after any paid audit (VB-009); (3) failing validation re-runnable indefinitely at Vibe's sandbox cost (covered by VB-008).

### A8 Idempotency / concurrency — **PASS · LOW**

Duplicate ops: partial unique indexes + raced-loser-re-reads-winner in every start path. Stripe webhook: three independent idempotency layers (event-id claim insert, ledger idempotency key, one-lot-per-entry) with claim release → 500 → genuine retry on processing error. Founder answer and interrupt resolution: CAS with the winner's answer standing. Approvals bind to immutable artifact identity; merge re-runs preflight inside the workflow, fast-forwards to the exact approved commit or refuses, verifies by independent read-back with a DB constraint — and never retries an ambiguous write (rule 73 verified). Race classes proven against real PostgreSQL in CI (ADR 0040 gate; 60 iterations). Minor accepted residual: gateway usage recorded in `after()` can undercount if the callback dies.

### A9 CSRF / origin — **PASS with PARTIAL · LOW — VB-042**

All browser mutations are Server Actions (Next 16 origin check; no `allowedOrigins` widening) over `SameSite=Lax` cookies. The two POST APIs authenticate by signature/token, carry no cookies, and fail closed when unconfigured. GET-with-side-effects: `GET /app/connect/github` writes an audit row and starts OAuth on a cross-site-navigable GET (negligible impact); GitHub connect `state` is HMAC-bound to `{uid, nonce, iat}` with 10-min TTL and `timingSafeEqual` but **not single-use** (documented tradeoff; callback independently re-verifies installation ownership). `/.well-known/workflow/*` auth is platform-managed — UNKNOWN, verify externally (§15).

### A10 XSS — **PASS · LOW**

Zero `dangerouslySetInnerHTML`/`innerHTML` in production code (the only grep hits are comments prohibiting it); no markdown/HTML renderer; all AI/repo/founder content rendered as React text nodes. `href`/`src` sinks constrained: production URL pre-normalized https-only with `javascript:`-family schemes structurally impossible; crawled links reject script schemes before parsing; customer logo origin-pinned + `no-referrer`; every `target="_blank"` carries `noreferrer`; Meta Pixel id regex-asserted before inline-script interpolation; untrusted pages are screenshotted, never framed (the one iframe is the sandboxed Browserbase live-view capability URL). Defense-in-depth depends on A17 (VB-005).

### A11 Injection — **PASS · LOW**

No raw SQL (query builder + fixed-name `.rpc()` with object params); no `child_process` in production runtime; sandbox commands are `{command, args[]}` never shell strings — the single `sh -c` (file write) passes content over stdin as base64 with the gateway-normalized path single-quote-escaped; the agent runtime program is a zero-interpolation string constant (test-asserted `not.toContain("${")`); model output never becomes program text or a privileged command; refs via octokit with hash-derived branch names.

### A12 Path traversal — **PASS (hardening notes) · LOW — VB-029**

Two independent refuse-don't-repair layers: gateway `normalizeAgentPath` (rejects `..`, absolute, backslash, NUL, >400 chars) plus the execution-paths allowlist (forbids `.github/`, `.env*`, manifests, lockfiles, `supabase/`, `next.config.*`, `proxy.*`, CI dirs, `.git`, `node_modules`), re-checked at candidate verification. GitHub reads are tree-listed per-path at a pinned SHA with symlinks/submodules rejected and sensitive basenames never fetched (rule 28). Hardening (VB-029): the sandbox read-back in `agent-execution/execution.ts:1909–1938` reads observed changed paths **before** the path policy filters them (a tracked sensitive file transits Vibe memory though it is never persisted); `find` listings split on `\n` (use `-print0`); VM symlinks not `lstat`-checked.

### A13 SSRF — **PASS · LOW — VB-030**

Textbook safe-fetch boundary: protocol allowlist; all resolved addresses must be publicly routable with mixed answers rejected whole; blocked ranges include metadata (`169.254.169.254` named, CGNAT/Alibaba, IPv6 mapped-v4 and NAT64 unwrapped and re-classified, strict octal/hex parsers, unparseable ⇒ blocked); **DNS-rebinding defeated by pinning the validated address into the transport's lookup hook**; redirects never auto-followed — every hop re-enters full validation; byte/time budgets with socket destruction at the cap. All user/repo/AI-influenced fetches verified to route through it (crawler, outcome verification, served-probe, website preflight); review screenshot URLs are server-resolved only; Deep Scan aborts off-origin navigations; the agent gateway forwards to exactly one fixed upstream. One gap: no destination-port restriction (external-service probing nuisance only) — VB-030.

### A14 Sandbox / agent security — **PASS · LOW** (deep detail in §8)

### A15 Prompt injection — **PASS with stated residual · MEDIUM-inherent** (deep detail in §8)

### A16 Secrets — **PASS (one PARTIAL) · LOW — VB-017**

Repo-wide sweep for key material: every hit is a synthetic test fixture; no `.env` committed; `.gitignore` covers env files and `*.pem`; `patches/` benign. Secret env map verified (browser bundle carries only the five public-by-design `NEXT_PUBLIC_` values). Boundary sanitizers redact `sk-ant-`/`gh*`/`github_pat_`/JWT/`AKIA`/gateway-token patterns from stored command output and events. **PARTIAL (VB-017):** the agent-execution workflow passes full candidate file contents across a durable step boundary (`workflow.ts:258–268` → `execution.ts:1842–1845, 2102–2107`) — customer-repo-derived bytes in the third-party workflow log, contradicting rule 52 and ADR 0013's "only ids" claim. Fix: persist the verified candidate in the (ownership-scoped) DB and pass `id + digest`.

### A17 Security headers — **FAIL · MEDIUM — VB-005**

No `headers()` in `next.config.ts`, no `vercel.json`, middleware sets only Supabase cookie/cache headers; repo-wide grep for CSP/HSTS/XFO/`nosniff`/Referrer-Policy/Permissions-Policy: zero hits; `X-Powered-By` on. Only platform-inherited HSTS at Vercel's edge (unverifiable from the repo, lost on migration). With the A1.3 cookie posture, this is the biggest browser-side gap. Fix: `headers()` block — CSP (nonce-based or allowlisting the Meta Pixel `connect.facebook.net`/`www.facebook.com` and Sentry ingest), explicit HSTS with preload, `nosniff`, `frame-ancestors 'none'` + XFO, `Referrer-Policy: strict-origin-when-cross-origin`, restrictive Permissions-Policy, `poweredByHeader:false`; record as an ADR (rule 13). Verify: header scan + pixel/Sentry still functional in preview.

### A18 CORS — **PASS · LOW**

No `Access-Control-*` headers or `OPTIONS` handlers anywhere; no wildcard origins; both APIs are server-to-server and cookie-free; browsers' same-origin default governs.

### A19 GitHub integration — **PASS · LOW — VB-041**

HMAC state (144-bit nonce, `timingSafeEqual`, 10-min TTL, session-bound uid); ADR 0009 installation-ownership verification enforced before persist; **no GitHub token stored anywhere** (no credential column exists in any migration; App JWT→installation token lives in-process; the one raw token minted is the sandbox clone credential, destroyed with `.git` and its absence verified); scopes are Metadata:RO + Contents:RW only; write restriction is structural (create-ref-only port; hash-derived `vibe/` branch names; disjoint fast-forward-only merge port with `force:false` + read-back); cross-project confusion blocked by RLS INSERT verification and project-scoped workflow reads. PARTIAL (VB-041): revocation hygiene — a GitHub-side uninstall is discovered only by API failure; stale `github_installations` rows never cleaned.

### A20 Webhooks — **PASS (Stripe) / N/A (GitHub, by decision) — VB-013**

Stripe: raw-body `constructEventAsync` with no environment bypass; 503 when unconfigured; SDK 300s timestamp tolerance plus event-id DB dedup; duplicates → 200; processing failure → claim released → 500 → genuine retry; line items and subscription state re-fetched live from Stripe rather than trusted from the payload; owner resolved from Vibe's own customer mapping. GitHub webhooks deliberately disabled ("Active: unchecked"); drift is handled by live re-reads at each consequential step. **Gap (VB-013):** a crash between claim insert and completion strands the event at `processing`; all Stripe retries then read as duplicates and the paid grant never posts — add a stale-claim expiry (re-claimable after N minutes).

### A21 Logs / privacy — **PASS (PARTIAL Sentry) · LOW — VB-021**

No token/cookie/password/payload logging found across ~140 production `console.*` sites; sandbox output sanitized at the boundary; audit-event metadata is ids/enums/short-SHAs with per-domain never-lists and a reader-side display allowlist; the usage ledger never stores prompts/output/reasoning. Sentry: `sendDefaultPii:false` in all three runtimes, traces 0.1, no Replay — but **no `beforeSend` scrubber**, so uncaught error messages reach Sentry unscrubbed (VB-021: apply the `validation/logs.ts` patterns in `beforeSend`).

### A22 Data lifecycle — **FAIL · HIGH — VB-001/002/003/004/040**

1. **No account-deletion flow exists; admin deletion is broken in both directions.** If it worked, `billing_credit_accounts.user_id → auth.users ON DELETE CASCADE` (migration `20260817180000:39`) would erase the entire credit ledger, reservations and usage events with the user — financial-record retention unhandled. And it does not work: the `execution_specs` BEFORE UPDATE/DELETE trigger raises unconditionally **including on cascaded deletes** (`20260818131106:135–150`), so any user or project that ever resolved an execution spec is permanently rooted — the codebase's own analysis states this verbatim (`credits/concurrency/agent-fixture.ts:356–384`).
2. **Project deletion fails silently for real projects.** `disconnectProject` issues a single `DELETE FROM projects`; the specs trigger plus immediate-`RESTRICT` snapshot FKs abort it (C15-1, §6); the server action **ignores** `{ok:false}` and redirects to success (`projects/[projectId]/actions.ts:14–29`).
3. **Storage retention is declared, never executed.** Review artifacts carry `expires_at` +7d and the UI says "the images are gone", but the only `storage.remove()` call is failed-capture cleanup — expired PNGs and disconnected projects' screenshots live forever.
4. `ai_usage_events`/`billing_usage_events.project_id` CASCADE erases measurement history on project deletion (tension with rule 7; ledger `project_id` is correctly SET NULL); `audit_events` metadata (`githubLogin`) outlives the user with no erasure story.

**Fix (Wave 0):** an erasure/retention ADR (ledger and audit events survive erasure via tombstoning/SET NULL; personal metadata scrubbed), an explicit lifecycle-deletion carve-out for the `execution_specs` trigger (e.g. a `current_setting` flag set only by a dedicated erasure routine) or RESTRICT→NO ACTION conversion, ordered child deletion in `disconnectProject`, surfacing the failure, and storage cleanup on disconnect + read-path expiry deletion. Verify: local-stack delete of a user and a project that each own an audit + an execution spec; storage listing after disconnect.

### A23 Database privileges — **PARTIAL · MEDIUM — VB-015** (detail §6)

### A24 DoS / boundedness — **PASS · LOW — VB-025**

Server Actions on the 1 MB default; repository read budgets (files/bytes/duration, sensitive paths refused, truncation → `partial`); crawl budgets (12 pages/6 MB/20 s, redirects revalidated); agent turn/wall/token/file caps; polling is read-only. Minor unbounded reads: `listAgentActivity` (no `.limit()`), dashboard own-data reads — folded into VB-025.

### A25 Error handling — **PASS · LOW**

Closed failure-code unions mapped by exhaustive `Record`s (a missing message is a type error); `failureDetail` diagnostics are bounded, sanitized and server-side only (zero references under `src/app`); provider errors are reduced to typed codes at each boundary ("raw GitHub responses never reach the UI"); gateway and webhook refusals are deliberately opaque; error boundaries render fixed copy with no digest/stack.

---

## 4. Performance & Scalability Audit (Track B)

| Control | Status | Risk | Headline finding |
|---|---|---|---|
| B1 Query inventory | PASS | LOW | Constant-query read models for dashboard/products (7 queries regardless of project count); explicit column lists everywhere; count-only queries use `head:true`. Heaviest: Business Health ≈30 underlying queries, `/agent` worst case ≈200 DB reads + up to 80 GitHub calls (capped at 20 changes) |
| B2 Indexing | PASS | LOW | `(project_id, created_at)` composites on every listing table, `(run_id, sequence)` on event tables, partial indexes for sweeps, 102 indexes total. Gaps: ~15 unindexed denormalized `user_id` FKs (worst: `product_scan_events.user_id`, which is also its RLS predicate) and unindexed RESTRICT/SET-NULL FKs on the project-deletion fan-out — VB-027 |
| B3 RLS performance | PARTIAL | LOW-MEDIUM | Only 2 of ~62 policies use the initplan-wrapped `(select auth.uid())` form; the rest re-evaluate per row (`audit_events`, `billing_credit_ledger`, `agent_tool_events` are the high-row exposures). One mechanical migration fixes all — VB-026 |
| B4 Query plans | UNKNOWN | — | Not run against production (read-only mandate). Follow-up commands in §Performance Test Plan |
| B5 N+1 | PARTIAL | MEDIUM | Plan route: 3 reads/Move, capped 5, parallel — acceptable. `/agent` `getPreparedChangeWorkspace`: ~9 reads per prepared change + GitHub preflight per approved change — batch per-table with `.in(preparedChangeIds)` — VB-023 |
| B6 Waterfalls | PARTIAL | LOW-MEDIUM | Worst: `getProjectImpact` awaits `getMergeCard` in a sequential `for` loop (up to 20 iterations, each with DB + GitHub work) — VB-024. Minor: billing account→subscription sequential though independent. Everything else correctly `Promise.all`s |
| B7 Over-fetching | PARTIAL | MEDIUM | **Top perf finding:** Business Health fetches the repository-intelligence JSONB ×4, live snapshot ×4, audit document ×3 per render (composite read models re-run the same getters, `health/content.tsx:86–121` + `business-audit/service.ts`); existence checks pull full documents. One `select("*")` exists, bounded, off the page path — VB-022 |
| B8 Pagination | PARTIAL | MEDIUM | Bounded: activity (range, cap 200), prepared changes (20), scan events (24), agent events (2000), operations (`limit 1`). Unbounded growing reads: **full credit ledger per billing render**, **all audit readings per Health render**, **all completed audits across all projects per dashboard render** — VB-025 |
| B9 Connections | PASS | LOW | Stateless PostgREST-over-HTTPS clients per request; no `pg` driver, no pools to exhaust, no long transactions (atomicity = single-statement predicates); local JWT verification avoids per-request Auth round trips |
| B10 Table growth | PARTIAL | MEDIUM (long-horizon) | Fastest growers: `audit_events`, `billing_credit_ledger`/`billing_usage_events`, `operation_runs`, event tables, audit JSONB documents. **No physical retention/cleanup exists anywhere** (cron forbidden without ADR — rule 24); growth bites the B8 unbounded reads first — VB-051 |
| B11 Caching | PARTIAL | LOW | **No caching of any kind** — zero `"use cache"`/`unstable_cache`/`revalidate`/React `cache()`. Everything under `/app` correctly dynamic. Flip side: request-scoped duplicate work (B7). Adopt React `cache()` for per-request memoization only — VB-022 |
| B12 Unsafe caching | PASS | LOW | Nothing cached ⇒ nothing keyed wrong; billing/operation state always fresh; the proxy propagates `@supabase/ssr` no-cache headers on token refresh — the one CDN session-leak vector, handled |
| B13 Rendering | PASS | LOW | Marketing `/`, `/privacy`, `/terms` static; all `/app/**` dynamic (correct for tenant data); dashboard cards are server components |
| B14 Client components | PASS | LOW | 52 `"use client"` files ≈12.1k LOC; largest subtrees are route-scoped panels; **zero client-side data fetching** (no fetch/SWR/react-query — all live data via server actions through one poll hook) |
| B15 Suspense/streaming | PARTIAL | LOW-MEDIUM | 12 routes have `loading.tsx` skeletons; **zero `<Suspense>` boundaries** — `/agent` blocks on the GitHub preflight, experiments on the merge loop, Health on 13 read models before any HTML streams — VB-023 |
| B16 Bundle | PASS | LOW | No server SDK reaches any client bundle (grep-verified); no chart lib; hand-written SVG icons; `playwright-core` externalized + lazy. Minor: full `motion` in 3 files — `LazyMotion` would trim ~30–45 kB gz — VB-046 |
| B17 Images/fonts | PASS | LOW | Self-hosted subset fonts with metric-matched fallback (CLS-safe, `display:swap`); no remote `next/image` by design (signed screenshot URLs must not enter a public optimizer cache). Minor: review screenshots `<img>` without dimensions/aspect-ratio → reflow — VB-047 |
| B18/B19 Polling/re-renders | PASS | LOW | One shared `useOperationPoll` for all 12 surfaces: never immediate, skips hidden tabs, stops at terminal state, tears down on unmount; `router.refresh()` only on state transitions; intervals 1.8–15s, enabled-gated so idle pages hold zero timers |
| B20/B21 Loading UX / vitals | PASS | LOW | Identity-preserving skeletons; distinct empty/failed/loading states; no dead screens found. Doc drift: UX-CONTRACT says 2.5s scan polling, code is 1.8s (rule-83 defect) — VB-044. Real-user vitals: UNKNOWN until Speed Insights reviewed (§15) |

---

## 5. Reliability & Operations Audit (Tracks C & D)

| Control | Status | Risk | Headline finding |
|---|---|---|---|
| C1/C2 Timeouts/retries | PARTIAL | MEDIUM | Anthropic: per-operation measured timeouts, `maxRetries:0` as a documented billing-accuracy decision with marker-before-call re-entry refusal. Stripe: `maxNetworkRetries:2`, pinned API. Sandbox/Browserbase/safe-fetch: explicit deadlines everywhere. **Gaps: Octokit has no request timeout/retry/throttling anywhere; Supabase clients have no HTTP timeout** — a hung call is bounded only by the 300s platform step kill, this codebase's documented worst failure mode — VB-031 |
| C3 Concurrency | PASS | LOW | Duplicate starts prevented by partial unique indexes (23505 → winner returned); status-CAS winner owns billing finalization (enforced at all six family sites + sweeps after Sprint 0070's audit); proven against real PostgreSQL in CI (path-triggered gate, stated ADR 0040 limit) |
| C4 Operation lifecycle | PASS (one window) | MEDIUM-LOW | Status CAS first, settle/release second, gated on winning — so **terminal status does NOT imply billing settled**: a crash between the winning CAS and settlement leaves a terminal op with an `active` reservation that no sweep touches (both sweeps act only on `running`). The Stage-3 drain query is a manual detector — automate it — VB-020 |
| C5 Billing lifecycle | PASS | LOW | Hold→settle/release verified idempotent under DB constraints; ADR 0042 repair layer **implemented and live in production** (`BILLING_REPAIR_ENABLED`, detect→repair→re-verify→audit-event, never throws into the read). Minor: shadow provider-usage reconciliation has no production caller — manual only — VB-033 |
| C6 Crash/stuck recovery | PARTIAL | MEDIUM | Read-triggered staleness exists for the three billed deterministic families + agent execution (deadline + grace, release gated on CAS win). **Uncovered: `product_scan`, `product_understanding`, all `change_*`, `business_measurement` — a died workflow wedges them `running` forever**, holding the single-active identity index and rendering "Analyzing…" indefinitely (sandboxes themselves cannot leak — VM timeouts) — VB-014 |
| C7 Observability | PARTIAL | MEDIUM | Sentry in all three runtimes (0.1 traces, PII off, error boundaries wired); closed-vocabulary audit events incl. `credit_drift.*`; four usage ledgers. No structured logger (tagged `console.*` only) |
| C8 Alerting | FAIL | MEDIUM | **Nothing pages anyone.** No alert rules as code; drift/settlement/staleness/gateway-refusal events land in tables and consoles only. Minimum: Sentry alert rules + a scheduled read of the existing events — VB-012 |
| C9 Health checks | FAIL | LOW-MEDIUM | No health/readiness endpoint of any kind — VB-034 |
| C10 Backups | UNKNOWN | — | No PITR/restore evidence in repo; verify in Supabase dashboard + write a restore runbook (§15) |
| C11 Deployment safety | PARTIAL | MEDIUM | CI: lint → typecheck → 6,453 tests → build + required browser-E2E against a production build + the real-Postgres billing gate — strong. **No migration automation**: Vercel auto-deploys `main` while migrations are applied manually via the linked CLI — schema/code skew is process-guarded only; no general rollback runbook (only the billing-flag procedure) — VB-039 |
| C12 Migration safety | PASS | LOW | Exemplary: nullable→backfill→NOT NULL sequences, fast-defaults, guarded backfills, the reconciliation cutover uses fixed-order `LOCK NOWAIT` + drift certification that aborts before touching data. Watch: repeated full-table CHECK revalidation on `operation_runs` (switch to `NOT VALID`+`VALIDATE` at scale) |
| C13 Kill switches | PARTIAL | MEDIUM | Real levers exist: agent allowlist (unset ⇒ nobody), gateway secret rotation (documented emergency stop), `STRIPE_ALLOW_LIVE_MODE` (live-money gate), `BILLING_REPAIR_ENABLED`. **No switch disables paid inference operations or billing mutations without a redeploy** — VB-032 |
| C14 Spend protection | PARTIAL | MEDIUM | Per-run protection excellent (holds before work, versioned rate cards, input-token gate, reuse-by-identity, gateway per-request budget re-reads). **No per-user/day/global aggregate limit and no abnormal-spend detection** — the ledgers exist, nothing reads them on a schedule — VB-033 |
| C15 DB integrity | PASS (one defect) | MEDIUM | Best-in-class duplicate/billing constraints. Defect: **project deletion structurally blocked** by immediate-RESTRICT FKs inside the projects cascade (see §6) — VB-001 cluster |
| D1 Environment separation | PARTIAL | MEDIUM-HIGH | App-origin tiering clean (`NEXT_PUBLIC_APP_URL` → `VERCEL_URL` → localhost; gateway origin deliberately separate). **Database separation: no evidence any exists** — one Supabase project in the org; whether Preview scope carries production keys is dashboard state — VB-011 |
| D2 Preview safety | PARTIAL/UNKNOWN | MEDIUM | Live-mode Stripe requires the explicit `STRIPE_ALLOW_LIVE_MODE="true"` act (structurally test-mode elsewhere if production-scoped). If Preview carries service-role + Anthropic + gateway secrets, previews can spend real money against production data. Strip those from Preview scope and document — VB-011 |
| D3 Env validation | PARTIAL | LOW | All env access zod-validated but lazy (fail-fast on first use, descriptive, values never echoed); no boot-time pass — acceptable; add a startup probe once a health endpoint exists |
| D4 Debug/test bypasses | PASS | LOW | `/e2e/[scenario]` env-gated (`VIBE_E2E_FIXTURES=1`, set only by the Playwright web server), fixtures only, no data layer; dogfood pages are ownership+allowlist-gated and go through full billing; `test-support` files have no non-test importer; **no environment bypass exists in the webhook or gateway** ("no development shortcut" — verified) |
| D5 Legacy paths | PASS | LOW | One dead-but-armed start path: `startProductUnderstandingOperation` exported and registered with zero UI callers (tests assert its absence from onboarding) — delete or annotate — VB-052 |

---

## 6. Database Review

**Schema:** 50 live tables (51 created, one dropped), uuid PKs, no sequences, no views, 7 functions (zero SECURITY DEFINER at HEAD; all billing functions `search_path=''`, EXECUTE revoked from public/anon/authenticated, service-role only). One storage bucket (`review-screenshots`, private).

**RLS:** enabled 50/50; FORCE on none (deliberate — service-role writes, rule 53). Ownership predicates: direct `user_id = auth.uid()`, EXISTS-through-`projects`, or billing-account joins — all verified to terminate at the owner. Financial and execution-record tables are SELECT-only or deny-all to clients. The linkage-verifying INSERT policies on `change_approvals`/`change_merges`/`change_outcome_verifications` (full artifact chain, zeroed-outcome enforcement, merge read-back SHA equality) are the strongest part of the schema. Defects: the A3-2 owner-forgery UPDATE policies, A3-3 unpinned `user_id` on UPDATE, A3-4/A3-5 minor policies (§3).

**Privileges (ADR 0043):** explicit per-table grants shipped (`anon` granted nothing; `authenticated` exactly its policy commands; `service_role` full CRUD); default privileges for future tables locked down (proven by `product_scan_events` having to grant explicitly). **Still open by acknowledged decision:** the platform-default `arwdDxtm` surplus for `anon`/`authenticated` on the 49 legacy tables is not yet revoked — RLS deny-by-default is the only line, and TRUNCATE is not RLS-governed at all (not reachable through PostgREST, so defense-in-depth rather than an exploit) — VB-015. `set_updated_at()` retains PUBLIC EXECUTE + unpinned search_path (uncallable via REST; tidy with the same migration).

**Constraints:** duplicate/double-spend protection is database-enforced everywhere money or paid work moves — partial unique single-active indexes per operation family, ledger/reservation idempotency uniques, one-lot-per-entry, one-allocation-per-(reservation,lot), Stripe event-id unique, outcome-claims-carry-evidence CHECKs, `available_non_negative`, `settled_within_reserved`. Status enums CHECK-constrained except two documented exceptions.

**The deletion defect (C15-1/VB-001):** `disconnectProject` relies on the `projects` cascade, but immediate-`RESTRICT` FKs among same-project siblings (`business_readiness_audits.*_snapshot_id`, `product_profiles.*_snapshot_id`, `execution_specs.*`, `opportunity_sets.business_audit_id`, `change_merges.change_approval_id`, …) fire per-row in FK-creation order before the cascade reaches the referencing rows — any project owning an audit or profile cannot be deleted; and the `execution_specs` immutability trigger roots users/projects permanently (§3 A22). Fix: RESTRICT→NO ACTION for intra-project FKs (end-of-statement check preserves the invariant for out-of-band deletes) or ordered child deletion; a trigger carve-out for a dedicated erasure routine. `repository_connections.github_installation_id RESTRICT` can additionally block *user* deletion.

**Indexes:** access paths well covered (§4 B2); add the ~15 `user_id` FK indexes (prioritize `product_scan_events.user_id` — also its RLS predicate) and the RESTRICT/SET-NULL FKs on the deletion fan-out (VB-027); rewrite policies to `(select auth.uid())` (VB-026).

**Growth & retention:** no cleanup exists; the unbounded reads (ledger, audit readings, cross-project audits) hit first (VB-025); retention needs an ADR before multi-year accumulation (VB-051).

**Transactions:** none from app code — atomicity is single-statement predicates plus five row-locking RPC functions; no long-transaction risk.

**Migrations:** 63 files, exemplary discipline (§5 C12); deploys are manual-by-process — decide automation or codify the runbook (VB-039).

---

## 7. Frontend / Web Vitals Review

**Rendering model:** marketing static, app dynamic, correct on both sides. No client-side fetching at all; one shared visibility-aware poll hook with terminal-state stops; server components for list cards. Bundle hygiene is genuinely good (no server SDKs client-side, no chart/icon libs, externalized playwright-core after a real outage).

**What will actually slow users down, in order:** (1) the B7 duplicate JSONB fetches on Business Health — the most-visited route re-transfers the same multi-hundred-KB documents up to 4×; (2) `/agent` and experiments blocking all HTML on GitHub network calls with zero Suspense boundaries; (3) the three unbounded growing reads (billing ledger, audit readings, dashboard audit history) that degrade linearly with account age; (4) `getProjectImpact`'s sequential merge-card loop. Fixes VB-022/023/024/025 are all small and behavior-preserving (React `cache()` per-request memoization, `.in()` batching, `<Suspense>` around network-dependent sections, read caps).

**Web Vitals:** official baselines (LCP p75 ≤2.5s, INP p75 ≤200ms, CLS p75 ≤0.1) vs internal SLOs (interaction feedback <100ms, INP <150ms, marketing LCP <2.0s, simple reads p95 <100ms, dashboard reads p95 <300ms, perceived navigation <500ms) are distinguished in the Performance Test Plan (§below). Repo evidence supports good CLS (metric-matched fonts, skeletons that repeat headings; two `<img>`-without-dimensions nits — VB-047) and good INP (no heavy client state, no polling-induced re-render storms). LCP on dynamic routes is dominated by the server waterfalls above. Real-user numbers: UNKNOWN until Vercel Speed Insights is reviewed (it is mounted; §15).

---

## 8. Agent / Sandbox Security Review

**Verdict: this is the strongest part of the system.** The design principle — an effect that must never happen is an *absent capability*, not a denied one (rule 76) — is actually implemented, and the load-bearing claims are proven in code rather than asserted:

- **Gateway (the one endpoint an untrusted VM can reach):** HMAC-SHA256 tokens with length-pre-checked `timingSafeEqual`, signature verified before any claim is parsed; exact-match route binding (`/v1/messages` only) and exact-string model binding; expiry = run wall-clock + 60s; durable run/budget state **re-read on every request, never cached** — run status must be exactly `running`, so cancellation is real revocation; identity re-checked against the stored row; refusals uniform and opaque ("a refusal that named the failing binding would be a probing oracle"); headers to Anthropic rebuilt from scratch (caller-supplied `x-api-key` dropped); **no development bypass** — misconfiguration fails closed 503. Bounded gaps (VB-016): check-then-act budget race under parallel requests (usage lands post-response in `after()`), failed-stream tokens excluded from the spend ceiling though recorded, no `max_tokens` clamp against remaining budget — all financially bounded by `maxRequests` (counts all rows), token expiry and per-call model caps.
- **Sandbox lifecycle:** `@vercel/sandbox` imported in exactly one file; `networkPolicy` always explicit, `persistent:false`, `resume:false` + liveness assertion. **Egress windows proven in order:** create pinned at `baseSha` with GitHub-only egress → Vibe's own `rev-parse` verifies the commit → `rm -rf .git` → **read-back verifies the credential is gone or the run fails `credential_scrub_failed`** (rule 63) → narrow to npm-registry-only → `--ignore-scripts` installs → **narrow to `[gateway.host]` before the agent exists** (rule 81). The validation sandbox re-asserts `deny_all` per repository-controlled phase. Sandbox env is three inert vars; a test asserts the absence of every secret key. Harness env built from nothing: gateway URL + scoped token + `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` + per-run config dir.
- **Harness config (rule 82/76):** all five mandates verified (`settingSources: []`, `persistSession: false`, per-run `CLAUDE_CONFIG_DIR` outside the repo, per-run `cwd`, auto-memory disabled); tool set is exactly `Read/Write/Edit/Glob/Grep/Bash` with a `canUseTool` deny backstop, `mcpServers:{}`, `strictMcpConfig:true`; the runtime program is a reviewed string constant with **zero interpolation**, test-asserted.
- **Diff observation (rule 77):** marker + listing set-difference computed by Vibe; truncated observation **fails the run, never becomes a partial diff**; bytes read back from the filesystem and compared against the pinned base via GitHub; the result protocol has *no field* for the agent's account of its work (test-pinned). Runtime-dir tampering was traced to self-DoS only. Branch names, refs, commit messages and paths are produced by deterministic capability code (rule 57 proven); paths pass three independent gates plus forbidden-pattern lists.
- **Prompt injection (A15) — honest residual:** customer `CLAUDE.md` is not loaded (settings + auto-memory both disabled — **add the missing hostile-CLAUDE.md canary**, VB-035); repo text reaches the model only as fenced untrusted content; no network tool and the egress policy leaves Bash/curl nothing to reach; a repo's own test scripts can self-green, which is why validation "pass" authorizes only a reviewable state (rule 66) and human diff review + fast-forward approval remain the real control. What a persuaded agent can still do: write malicious-but-in-scope code into an allowed file (human review is the control), burn its own run's budget, exfiltrate the repository's own content to Anthropic via sampling (already authorized to reach the model), and raise a deceptive interrupt within bounded stripped labels. No path exists from repository text to another host, a credential, a forbidden path, a ref, another model, another run, or the default branch.
- **Authorization:** production agent economics are structurally off (`EXECUTION_BUDGET_POLICIES = []`); the dogfood allowlist authorizes nobody when unset (proven); starts still hold credits.

Residual work: VB-016 (gateway accounting), VB-017 (candidate bytes out of the durable log), VB-035 (canary), VB-029 (read-back path filter, `-print0`, symlink `lstat`).

---

## 9. Billing / Economic Abuse Review

**The money core is sound and unusually well proven.** Exact-integer credits; retail prices versioned and effective-dated in exactly one module (rule 46 upheld — no route or component names a model or price); reserve → run → settle-once/release with DB-enforced exactly-once at every layer; the ADR 0042 reconciliation layer (idempotent materialization primitives shared by hot path and repair, drift detect→repair→re-verify→audit-event) is implemented, activated in production behind `BILLING_REPAIR_ENABLED`, and its race classes are proven against real PostgreSQL in CI — including the Sprint 0070 pass that found and gated four unchecked-CAS release sites. The Stripe rail: signature-verified, triple-idempotent, live-mode double-gated, owner resolved only from Vibe's own mapping, amounts never client-influenced (catalog SKUs only).

**Where money still leaks or lacks a guard:**
1. **VB-009 — `bundled_with_free_audit` bypass** (§3 A7): a post-onboarding caller skips the 20-credit opportunity charge once per fresh audit.
2. **VB-008 — free operations with real provider cost and no window limit**: product scan/understanding (paid inference), validation/preview/review (sandbox + browser minutes). Vibe absorbs unbounded sequential cost per authenticated user.
3. **VB-013 — webhook stuck-claim**: paid checkout whose grant never posts, with retries swallowed as duplicates.
4. **VB-020 — terminal-op + active-hold crash window**: the acknowledged CAS-win-then-crash leak; automate the drain query.
5. **VB-016 — gateway budget accounting races** (bounded).
6. **VB-033 — no aggregate spend view**: shadow reconciliation unwired, no per-user/day ceiling, no anomaly alert (with VB-012).
7. Known-and-accepted (roadmap-registered, confirmed in code): validation runs after settlement, unreserved and uncapped; cache token quantities unmetered (harmless while `CREDIT_RATE_CARDS` is empty — becomes chargeable-behaviour the moment a rate card exists); sandbox rates founder-attested; `refundCharge` fully built with zero callers — **no operator can correct a charge** (VB-038).

---

## 10. Controls Already Done Well

Do not rebuild these; they pass and are worth protecting with the tests that pin them:

1. **Session verification** — `getClaims()` everywhere, zero unverified readers, fail-closed middleware that is explicitly not the boundary.
2. **Multi-tenancy** — no IDOR found across every entry point; CI-enforced structural guards (`workspace-routes.test.ts`, `service-boundary.test.ts`) — treat both as security-critical.
3. **RLS breadth** — 50/50 tables, deny-by-default financial tables, linkage-verifying INSERT chains with read-back SHA equality.
4. **Billing atomicity** — DB-enforced exactly-once everywhere; real-Postgres concurrency gate in CI; reconciliation live in production.
5. **SSRF boundary** — DNS-pinned, metadata/CGNAT/IPv6-mapped-aware, per-hop revalidated, budget-degrading; all user-influenced fetches routed through it.
6. **Sandbox/gateway architecture** — capability absence over denial, egress windows, credential scrub with verified absence, opaque refusals, per-request durable re-reads.
7. **Injection defense** — no raw SQL, no server-side exec, argv-array commands, zero-interpolation agent program (test-pinned).
8. **Error containment** — closed failure vocabularies mapped exhaustively; provider errors never escape their boundary; opaque webhook/gateway refusals.
9. **Open-redirect defense** — convergent-decode sanitizer, relative Locations, property-tested.
10. **Idempotent consequential writes** — mark-before-write, independent read-back, DB constraints refusing disagreeing terminal rows (merge, outcome, measurement).
11. **Secrets hygiene** — nothing committed, server-only env modules that never echo values, boundary redaction of sandbox output and events.
12. **Polling discipline** — one shared hook, visibility-aware, terminal-state stops, transition-only refreshes.
13. **Deploy validation** — lint/typecheck/6,453 tests/build + browser E2E against a production build, all green at HEAD.

---

## Performance Test Plan (deferred verification — procedures, not results)

**Frontend.** Lighthouse (mobile + desktop, cold + warm) on: `/`, `/login`, `/app` (dashboard), `/app/products`, `/app/billing`, `/app/projects/[id]` (Business Health), `/plan`, `/agent`, `/product`, `/experiments`. Gate on official baselines (LCP p75 ≤2.5s, INP p75 ≤200ms, CLS p75 ≤0.1); track internal SLOs separately (interaction feedback <100ms, INP <150ms, marketing LCP <2.0s, perceived dashboard navigation <500ms). Review Vercel Speed Insights RUM (already mounted) weekly for the first month; treat internal SLOs as targets, not launch gates.

**Server/API.** Measure p50/p95/p99 via Vercel function logs or a k6 run with a seeded test user: project workspace load, dashboard, Action Plan read, Founder Input submit, product-scan status poll (the hottest action at 1.8s intervals), audit start (admission path only), billing overview. Internal targets: simple reads p95 <100ms, dashboard/server reads p95 <300ms where feasible.

**Database.** On a disposable branch/local stack seeded synthetically (100 / 1,000 projects; 10,000 operation runs; 100,000 and 1,000,000 rows in `audit_events`, `billing_credit_ledger`, `agent_execution_events`):
```sql
EXPLAIN (ANALYZE, BUFFERS) SELECT ... FROM audit_events WHERE project_id = $1 ORDER BY created_at DESC, id DESC LIMIT 50;
EXPLAIN (ANALYZE, BUFFERS) SELECT ... FROM billing_credit_ledger WHERE credit_account_id = $1 ORDER BY created_at DESC;      -- before/after VB-025 cap
EXPLAIN (ANALYZE, BUFFERS) SELECT ... FROM business_readiness_audits WHERE project_id = $1 AND status='completed';           -- readings series
EXPLAIN (ANALYZE, BUFFERS) SELECT ... FROM product_scan_events WHERE operation_run_id = $1 ORDER BY sequence;                -- + RLS as authenticated role
SELECT relname, n_live_tup FROM pg_stat_user_tables ORDER BY 2 DESC;                                                          -- growth watch
```
Run RLS-sensitive plans via PostgREST as an authenticated user (policy cost visible), before and after VB-026/VB-027. Never run ANALYZE-heavy experiments against the production project — use `mcp` branch databases or the local stack.

---

## Security Test Plan (verification matrix)

| Test | Procedure | Expected |
|---|---|---|
| Cross-user project access / IDOR | As user B, invoke every action/route with user A's `projectId`, `operationId`, `preparedChangeId`, `auditId`, `planId`, `interruptId`, `approvalId` | `not_found`/`notFound()` every time; zero rows via RLS |
| RLS direct | PostgREST calls with B's JWT against A's rows on all 50 tables (SELECT/INSERT/UPDATE/DELETE); anon-key calls with no JWT | zero rows / 42501; after VB-015: privilege-level denial too |
| Owner self-forgery (VB-018) | As owner, `UPDATE validation_runs SET status='passed'`; `UPDATE operation_runs SET user_id='<other uuid>'` | Both refused after fix (currently succeed — regression proof) |
| CSRF | Cross-origin POST to a Server Action; cross-site top-level GET to `/app/connect/github` | Action refused (origin check); connect flow produces no persistent effect |
| XSS | Project names / founder input / corrections containing `<script>`, `javascript:` URLs as production URL and in crawled content | Rendered inert; URL rejected by normalizer |
| Malformed input | Non-UUID ids on every route/action; oversized strings; unknown enum values | 404/`not_found` (after VB-028), never 500; enums refused |
| Duplicate submission | Double-click every start action; concurrent starts (two parallel requests); replay Stripe webhook event | One operation row; one grant (idempotency layers) |
| Rate limiting / brute force | Scripted sign-in attempts per account; >5 audit starts/hour; sequential product scans; repeated validation starts | Throttled per account (after VB-010); window limits refuse (after VB-008) |
| Cost abuse | `bundled_with_free_audit` invoked post-onboarding | Refused (after VB-009); `billing.operation_reserved` present on the billable path |
| SSRF | Production URL set to `http://`, `https://169.254.169.254`, `https://[::1]`, decimal/octal IPs, DNS-rebinding host, redirect-to-private | All refused with typed reasons; safe-fetch tests green |
| Path traversal | Agent writes to `../x`, absolute, `.github/workflows/x`, `.env`; repo tracking a symlink and a newline filename | Refused at gateway + candidate verification; VB-029 cases added |
| Sandbox secret leakage | Enumerate env inside both sandbox types; attempt egress to non-gateway hosts; read `.git/config` after scrub | Only inert vars + scoped token; egress blocked; scrub verified |
| Prompt injection | Fixture repo with hostile `CLAUDE.md`, `.claude/settings.json`, README instructions ("run curl", "write to .env") | Never enters system prompt (VB-035 canary); tools/eगress make exfil impossible; forbidden writes refused |
| Webhook replay | Re-send a captured Stripe event (same id; stale timestamp) | 200 duplicate; no second grant; >300s-old signature rejected |
| OAuth state | Replay a captured GitHub state as another user; expired state; forged signature | `user_mismatch` / expired / invalid — timing-safe |
| Auth after deletion/disconnect | After project disconnect and (post-VB-001) account erasure, use stale ids and sessions | All resources gone/refused; global sign-out revokes leaked sessions |
| Gateway | Expired/other-run/other-model token; parallel request burst vs budget; captured-token replay after cancel | Opaque refusals; burst bounded (after VB-016); cancelled run refuses instantly |

---

## 11. Launch-Ready Master Backlog

Lifecycle: `New → Implemented → Needs Review → Validated → Done`; every item below is **New**. "Current implementation" per item is documented in §3–§9 under the referenced control. LB = Launch Blocker. Cx = complexity.

### P0 — launch blockers

| ID | Track | Control | Status | Risk | LB | Cx | Gap | Recommendation | Verification | Evidence | Deps |
|---|---|---|---|---|---|---|---|---|---|---|---|
| VB-001 | Security | A22/C15 | FAIL | HIGH | YES | L | User/project deletion structurally impossible: `execution_specs` trigger raises on cascaded deletes; immediate-RESTRICT snapshot FKs abort the projects cascade | Erasure routine with trigger carve-out (`current_setting` flag) or RESTRICT→NO ACTION for intra-project FKs; ordered child deletion in `disconnectProject` | Local stack: delete a user + a project each owning an audit + an execution spec → succeeds; FK/trigger tests | `20260818131106:135–150`; `credits/concurrency/agent-fixture.ts:356–384`; `src/modules/projects/disconnect.ts:24–29` | ADR (VB-002) |
| VB-002 | Security | A22 | FAIL | HIGH | YES | M | Billing ledger/usage cascade-wiped with the auth user; no retention/erasure model; `audit_events.githubLogin` outlives users | Erasure/retention ADR: ledger + audit events survive erasure (tombstone/SET NULL), personal metadata scrubbed; migration changing the `auth.users` cascades | Post-erasure: ledger rows remain owner-tombstoned; no personal data readable | `20260817180000:39,92,342` | — |
| VB-003 | Security | A22 | FAIL | MEDIUM | YES | S | `disconnectProject` failure ignored — user shown success while data remains | Surface `{ok:false}` in the action; audit-event the failure | E2E: failing disconnect shows an error state | `projects/[projectId]/actions.ts:14–29` | VB-001 |

### P1 — before public launch

| ID | Track | Control | Status | Risk | LB | Cx | Gap | Recommendation | Verification | Evidence | Deps |
|---|---|---|---|---|---|---|---|---|---|---|---|
| VB-004 | Security | A22 | PARTIAL | MEDIUM | NO | M | Screenshot retention declared (7d) but never executed; no storage cleanup on disconnect | Read-path expiry deletion + `remove()` of `review-screenshots/{projectId}/**` on disconnect | Storage listing empty after expiry/disconnect | `review/policy.ts:104`; `review/storage.ts:79–87` | VB-001 |
| VB-005 | Security | A17 | FAIL | MEDIUM | YES | M | Zero security headers (CSP/HSTS/nosniff/frame/Referrer/Permissions); `X-Powered-By` on | `headers()` block + CSP (allow Meta Pixel + Sentry ingest; prefer nonces); `poweredByHeader:false`; record ADR | `curl -sI` header scan; Observatory; pixel+Sentry functional in preview | `next.config.ts` (absence); `meta-pixel.tsx:70–82` | — |
| VB-006 | Security | A1 | PARTIAL | MEDIUM | YES | S | Session cookies lack `Secure` (ssr default; `HttpOnly:false`, 400d) | `cookieOptions:{secure:true}` in server/proxy/client factories; document HttpOnly tradeoff | Set-Cookie shows `Secure` after refresh | `src/lib/supabase/{server,proxy,client}.ts` | — |
| VB-007 | Security | §0 | PARTIAL | HIGH | YES | S | undici 7.28.0 (2 high/3 mod) + nanoid 5.1.6 (high) via `workflow`/`@vercel/sandbox`; framework patch drift | Bump `workflow`→4.8.5, `@vercel/sandbox`→3.1.0, next→16.3.3, supabase libs; else pnpm `overrides` | `pnpm audit --prod` → 0 high; full CI green | `pnpm audit` output; `pnpm why undici/nanoid` | — |
| VB-008 | Security | A6/A7 | PARTIAL | MEDIUM | YES | M | No window limits on product scan/understanding (free paid inference), validation/preview/review (sandbox/browser spend), project creation, checkout creation | Extend the entitlement window-limit pattern (per project/hour + per account/day) to each start path | Entitlement tests; N+1th start refused with typed reason | `operations/service.ts:731–798`; `business-audit/entitlement.ts:126–132` (pattern) | — |
| VB-009 | Security | A7 | FAIL | MEDIUM | YES | S | `bundled_with_free_audit` starts opportunities free with no onboarding-state check — skips the 20-credit charge post-onboarding | Gate on onboarding state; route post-onboarding calls to the billable path | Post-onboarding invocation refused; `billing.operation_reserved` present on workspace path | `onboarding/[projectId]/actions.ts:306–350` | — |
| VB-010 | Security | A6 | PARTIAL | MEDIUM | NO | M | No per-account auth throttling; Supabase IP limits diluted by shared Vercel egress | Per-account attempt window on sign-in/reset actions (DB-derived, rule-24-compatible) | Scripted brute-force throttled per account | `src/modules/auth/actions.ts` | — |
| VB-011 | Cross-cutting | D1/D2 | UNKNOWN | HIGH | YES | S+M | Single Supabase project; Preview may carry production service-role/Anthropic/gateway secrets | Verify Vercel scoping; strip `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `VIBE_AGENT_GATEWAY_SECRET`, dogfood allowlist, live Stripe from Preview; document in `environment.md`; consider branch DBs | Preview deployment cannot write prod or spend; env listing per scope | `docs/deployment/environment.md`; billing activation record (“only Supabase project”) | — |
| VB-012 | Reliability | C8 | FAIL | MEDIUM | YES | M | No alerting: drift/settlement/staleness/gateway-refusal events page no one | Sentry alert rules + scheduled read (Routine/cron per ADR) of `credit_drift.*`, failed settlements, expiries, webhook 5xx | Synthetic drift event triggers a notification | `audit-log/events.ts`; Sentry configs (no rules) | ADR (rule 24) |
| VB-013 | Reliability | A20/C5 | PARTIAL | MEDIUM | YES | S | Stripe event stuck at `processing` after crash → retries read duplicate → paid grant never posts | Stale-claim expiry (re-claimable after N minutes `processing`) | Kill mid-processing in test → next delivery grants exactly once | `billing/store.ts:276–300`; `webhook-service.ts:61–89` | — |
| VB-014 | Reliability | C6 | PARTIAL | MEDIUM | NO | M | `product_scan`, `product_understanding`, `change_*`, `business_measurement` never staleness-swept — died workflow wedges them + their identity index forever | Extend the read-triggered deadline map with generous per-family wall-clock bounds (no billing release needed) | Kill a workflow mid-run → status poll expires it; re-run possible | `staleness.ts:33–60` | — |
| VB-015 | Security | A23 | PARTIAL | MEDIUM | NO | M | Platform-default `arwdDxtm` for anon/authenticated still granted on 49 legacy tables (RLS is the only line; TRUNCATE not RLS-governed) | The acknowledged tightening migration: revoke surplus after the 42501 reachability probe; pin `set_updated_at` search_path | `role_table_grants` for anon → zero rows; advisors clean; app E2E green | `20260823210000` header; `config.toml:34–36` | probe first |
| VB-016 | Security | A7/gateway | PARTIAL | LOW | NO | M | Gateway check-then-act budget race; failed-stream tokens excluded from spend ceiling; no `max_tokens` clamp | Pending-attempt marker before `fetch`; count tokens from all rows with usage; clamp `max_tokens` to remaining | Parallel-burst test bounded; failed-stream tokens reflected | `gateway-state.ts:76–89`; `route.ts:147–151,276–280` | — |
| VB-017 | Security | A16/r52 | PARTIAL | MEDIUM | NO | M | Candidate file contents cross the Vercel Workflow durable log (customer-repo-derived bytes in a third-party store) | Persist verified candidate in DB in `extractAndVerifyStep`; pass `id+digest`; rebuild bytes inside `writeAgentBranchStep` | Step-boundary payload inspection: ids only | `agent-execution/workflow.ts:258–268`; `execution.ts:1842–1845,2102–2107` | — |
| VB-018 | Security | A3-2 | PARTIAL | MEDIUM | NO | M | Owner UPDATE policies allow self-forgery of `validation_runs.status`, `prepared_changes` SHAs, audit results | Column-restricted transition policies or drop client UPDATE (durable execution owns these writes — verify with client-side `.update(` grep first) | Owner `UPDATE … SET status='passed'` → 42501 | migrations `20260812170000:138–144`, `20260812060000:152–158`, `20260810013000:183–189` | — |
| VB-019 | Security | A3-3 | PARTIAL | MEDIUM | NO | S | UPDATE `WITH CHECK` doesn’t re-pin denormalized `user_id` (5 tables) — trusted-owner column client-mutable | Add `user_id = auth.uid()` to UPDATE WITH CHECK (or immutability trigger) | Owner `UPDATE operation_runs SET user_id=<other>` → refused | `20260812010000:123–129` | VB-018 |

### P2 — hardening / scalability

| ID | Track | Control | Status | Risk | LB | Cx | Gap → Recommendation | Verification | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| VB-020 | Reliability | C4/C5 | PARTIAL | MEDIUM | NO | M | Terminal op + `active` reservation crash window has only a manual drain query → automate detector on a read path or operator surface | Injected crash recovered; drain query empty in steady state | `agent-execution/execution.ts:2407–2412`; deployment doc Stage 3 |
| VB-021 | Security | A21 | PARTIAL | MEDIUM | NO | S | No Sentry `beforeSend` scrubber → apply `validation/logs.ts` secret patterns; drop request bodies/cookies | Synthetic secret-bearing error arrives scrubbed | sentry configs |
| VB-022 | Performance | B7/B11 | PARTIAL | MEDIUM | NO | S | Duplicate JSONB fetches (repo ×4, audit ×3 per Health render) → React `cache()` on the six hot getters; id-only existence variants | PostgREST log: 1 fetch per document per render | `health/content.tsx:86–121`; `business-audit/service.ts:88–118,277–285` |
| VB-023 | Performance | B5/B15 | PARTIAL | MEDIUM | NO | M | `/agent` per-change fan-out + zero Suspense → batch per-table `.in()`; Suspense around GitHub preflight | Request count per render; TTFB vs LCP with GitHub latency injected | `execution/workspace.ts:147–248` |
| VB-024 | Performance | B6 | PARTIAL | LOW-MED | NO | S | `getProjectImpact` sequential merge loop → parallelize/batch | Render time with 10 changes | `business-measurement/project-impact.ts:85–104` |
| VB-025 | Performance | B8/A24 | PARTIAL | MEDIUM | NO | S | Unbounded reads: full ledger (billing), all audit readings (health), all audits (dashboard), `listAgentActivity` → caps + running aggregate for reconciliation | Row counts bounded in PostgREST logs | `credits/store.ts:215–227`; `business-audit/store.ts:266–278`; `projects/dashboard.ts:275–282`; `coding-agent/store.ts:855–858` |
| VB-026 | Performance | B3 | PARTIAL | LOW-MED | NO | S | ~60 policies re-evaluate `auth.uid()` per row → mechanical `(select auth.uid())` rewrite migration | performance advisors clean; EXPLAIN on `audit_events` | migrations passim; pattern at `20260819120000:107` |
| VB-027 | Performance | B2 | PASS(gap) | LOW | NO | S | Missing FK indexes (~15 `user_id`; deletion fan-out RESTRICT/SET-NULL) → add, prioritizing `product_scan_events.user_id` | EXPLAIN policy check uses index; delete fan-out plans | §6 index list |
| VB-028 | Security | A5 | PARTIAL | LOW-MED | NO | S | No UUID guard; 22P02 → 500 → `parseUuid` at boundaries mapping to `not_found` | `/app/projects/x` → 404 | `projects/queries.ts:41` |
| VB-029 | Security | A12 | PASS(gap) | LOW | NO | S | Read-back precedes path policy; `\n` split listings; VM symlinks → filter observed paths first; `find -print0`; `lstat`/`-type l` exclusion | New traversal tests (newline name, tracked `.env`, symlink) | `agent-execution/execution.ts:1909–1938`; `changes.ts:102–117` |
| VB-030 | Security | A13 | PASS(gap) | LOW | NO | S | No destination-port restriction in safe-fetch → allow 80/443 only | Port-policy test | `net/safe-fetch.ts:130–135` |
| VB-031 | Reliability | C1/C2 | PARTIAL | MEDIUM | NO | S | Octokit no timeout/retry; Supabase clients no HTTP timeout → `request:{timeout}` + bounded jittered retries for read-only GitHub calls; fetch timeout on clients | Fault-injected hang bounded well under step ceiling | `github/app-client.ts:19–34`; `lib/supabase/service.ts` |
| VB-032 | Reliability | C13 | PARTIAL | MEDIUM | NO | S | No paid-ops kill switch → `PAID_OPERATIONS_DISABLED` checked at start paths (+ optional maintenance mode) | Flag on → starts refuse with typed reason, reads fine | `operations/service.ts` start paths |
| VB-033 | Reliability | C14/C5 | PARTIAL | MEDIUM | NO | M | No aggregate spend view; shadow reconciliation unwired → scheduled ledger read + thresholds (with VB-012); per-user/day ceiling decision | Synthetic spend spike alerts | `credits/reconciliation.ts:283–315` (no prod caller) |
| VB-034 | Reliability | C9 | FAIL | LOW-MED | NO | S | No health endpoint → minimal unauthenticated route (build SHA + optional DB ping; no secrets) | Uptime monitor green; no sensitive data in response | route listing |
| VB-035 | Security | A15 | PASS(gap) | MEDIUM | NO | S | No hostile-`CLAUDE.md` canary → fixture repo with hostile `CLAUDE.md`/settings; assert non-ingestion in the real harness | Canary green in `agent:canary` | `sandbox-runtime/canary/` |
| VB-036 | Security | A3-5 | PARTIAL | LOW | NO | S/M | Client INSERT into `ai_usage_events`/`deep_scan_provider_usage` (ledger pollution; job-id squatting) → service-role-only writes | Client insert → 42501; usage still recorded | `20260810013000:257–262`; `20260811190000:329–337` |
| VB-037 | Security | A1 | PARTIAL | LOW | NO | S | 6-char password minimum → ≥8 in action + Supabase policy | 7-char refused | `auth/actions.ts:230` |
| VB-038 | Cross-cutting | billing ops | PARTIAL | MEDIUM | NO | M | `refundCharge` has zero callers; no operator correction surface → minimal operator path (CLI/probe acceptable) with audit event | Test refund round-trip on staging data | roadmap “No operator can correct a charge” |
| VB-039 | Reliability | C11 | PARTIAL | MEDIUM | NO | M | Manual migrations vs auto-deploy skew; no rollback runbook → codify order (migrate→deploy), add generic rollback runbook; consider CI `db push` gate | Runbook exercised once on staging | `docs/deployment/*` |
| VB-040 | Security | A22 | PARTIAL | LOW-MED | NO | S | `ai_usage_events`/`billing_usage_events.project_id` CASCADE erases measurement history → SET NULL (align with ledger) | Project delete preserves usage rows | `20260810013000:213`; `20260817180000:339` |
| VB-041 | Security | A19 | PARTIAL | LOW | NO | S | Revoked GitHub installations linger as verified rows → on 404 probe, mark/remove; document full-disconnect path | Uninstall on GitHub → row cleared on next probe | `github/repositories.ts:65–89` |
| VB-049 | Security | A3-4/A23 | PARTIAL | LOW | NO | S | `execution_interrupts` UPDATE field-unconstrained; `set_updated_at` hygiene → WITH CHECK status constraint; pin search_path | Policy test; advisors clean | `20260818210000:421–433` |
| VB-050 | Cross-cutting | billing | PARTIAL | LOW→MED | NO | M | Cache token quantities unmetered (no SKU) — harmless until a rate card exists, then mischarges by omission → add SKUs + CHECK migration **before** activating `CREDIT_RATE_CARDS` | Rated dogfood run reflects cache tokens | roadmap entry; `billing_usage_events.sku` CHECK |

### P3 — post-launch / optimization

| ID | Track | Control | Risk | Cx | Gap → Recommendation |
|---|---|---|---|---|---|
| VB-042 | Security | A9 | LOW | S | GitHub connect on GET + non-single-use state → POST action + one-time nonce |
| VB-043 | Security | D4 | LOW | S | `/e2e` belt-and-braces prod guard (`VERCEL_ENV==='production'` → notFound) |
| VB-044 | Cross-cutting | rule 83 | LOW | S | Doc currency: rule 53 wording vs `REVIEWED_SITES`; UX-CONTRACT 2.5s vs 1.8s poll |
| VB-045 | Security | A2 | LOW | S | Explicit ownership checks on the two RLS-only read actions |
| VB-046 | Performance | B16 | LOW | S | `LazyMotion`+`m` for the three motion imports |
| VB-047 | Performance | B17 | LOW | S | Dimensions/aspect-ratio on review screenshots and logo |
| VB-048 | Security | A5 | LOW | M | zod-parse GitHub/Stripe adapter responses |
| VB-051 | Performance | B10 | LOW | M | Retention ADR for `audit_events`/usage ledgers before multi-year accumulation |
| VB-052 | Reliability | D5 | LOW | S | Remove/annotate dead `startProductUnderstandingOperation` path |

---

## 12. Recommended Implementation Waves

- **Wave 0 — existence & integrity (P0):** VB-001 → VB-002 → VB-003 (one ADR, one migration family, one action fix). Everything else can proceed in parallel, but public launch waits on this.
- **Wave 1 — security before public traffic:** VB-005, VB-006, VB-007 (one dependency-bump PR), VB-008, VB-009, VB-010, VB-011 (verify first — it may escalate), VB-013, VB-015, VB-018/VB-019 (one policy migration), VB-016, VB-017.
- **Wave 2 — database & performance:** VB-022, VB-023, VB-024, VB-025, VB-026, VB-027, VB-028, VB-036, VB-040 (the three migrations — VB-026/027/036/040 — can ship as one reviewed batch).
- **Wave 3 — reliability & observability:** VB-012, VB-014, VB-020, VB-021, VB-031, VB-032, VB-033, VB-034, VB-039, VB-004.
- **Wave 4 — scale & agent-launch prep:** VB-029, VB-030, VB-035, VB-038, VB-041, VB-049, VB-050 (hard prerequisite for any customer-facing Agent price), synthetic DB scale tests from the Performance Test Plan.
- **Wave 5 — final verification:** full Security Test Plan matrix, Lighthouse/RUM pass, `pnpm audit` re-run, restore-drill (C10), pre-launch checklist sign-off. Only successful verification moves items to **Done**.

Grouping rationale from evidence: the deletion cluster shares one ADR; the RLS tightenings share migration review overhead; alerting (VB-012) should land before the detectors it consumes (VB-020, VB-033).

---

## 13. Pre-Launch Acceptance Checklist

- [ ] VB-001/002/003 validated: a user and a project with full history can be deleted; ledger survives tombstoned; disconnect failures visible
- [ ] Security headers live (CSP report-only ≥1 week, then enforced); cookies `Secure`
- [ ] `pnpm audit --prod`: zero high; framework patch-current
- [ ] Window limits + auth throttling active; `bundled_with_free_audit` gated
- [ ] Preview environment proven unable to touch production data or spend money
- [ ] Alerting fires on synthetic drift/settlement-failure/staleness events
- [ ] Stripe stuck-claim expiry deployed; replay test green
- [ ] `anon` surplus grants revoked; advisors clean
- [ ] Staleness coverage for all operation families
- [ ] Supabase PITR confirmed on; restore runbook written and exercised once
- [ ] Security Test Plan matrix executed with zero unexplained failures
- [ ] Vitals: official baselines met on marketing + dashboard routes (mobile)
- [ ] CI green (unit + E2E + concurrency gate) at the launch commit

## 14. Deferred / Post-Launch (deliberately not launch work)

All P3 items; retention/partitioning (VB-051 — ADR first, volume is years away); LazyMotion/bundle trims; adapter response schemas; per-lens score history, agent live view, outcome verification for agentic changes (roadmap-registered product gaps, not audit findings); Redis or any cache infrastructure — **no evidence supports it**: the fixes needed are request-scoped memoization and read caps, not a cache tier; microservices/queue changes — the modular monolith + Workflows model is holding well within its ADRs.

## 15. Unknowns Requiring External Verification

Repository evidence cannot prove these; verify in the respective dashboards:

1. **Vercel:** Preview/Production env-var scoping (VB-011 — the pivotal one); deployment protection settings; platform HSTS/WAF; `/.well-known/workflow/*` route authentication in a deployed build (unauthenticated POST must refuse).
2. **Supabase:** PITR/backup status + restore procedure (C10); Auth redirect-URL allowlist contains no wildcard (A1.8); Auth rate limits and password policy at the dashboard level; production `get_advisors` security+performance runs.
3. **Sentry:** whether any alert rules exist (C8); quota/sampling behavior under load.
4. **Stripe:** live vs test key scoping per environment; webhook endpoint config + retry window; radar settings.
5. **GitHub App:** installed permission set matches docs (Metadata:RO, Contents:RW, webhooks off); private key rotation practice.
6. **DNS/domain:** apex/ww redirect, CAA records, registrar lock.
7. **Real-user vitals:** Vercel Speed Insights / Analytics dashboards (mounted in code; numbers unverifiable from the repo).

---

*Audit method note: nine parallel deep-inspection passes (auth/CSRF/headers; authorization/IDOR; RLS/schema; validation/rate-limits/economic abuse; XSS/injection/traversal/SSRF; agent/sandbox/gateway; GitHub/webhooks/logs/lifecycle; performance; reliability/environment) over the working tree at `39a2bbf`, cross-checked against `pnpm audit`, the npm registry, the full unit suite run at HEAD, and the repository's own roadmap/ADR record. Investigated-and-ruled-out false positives are recorded per control in §3–§9 sources; the notable ones: the `getSession` name-shadowing (wrapper over `getClaims`), USING-without-WITH-CHECK UPDATE policies (PG applies USING to new rows), Anthropic `maxRetries:0` (deliberate billing-accuracy decision), deny-all "policy-less" tables (intentional service-role-only design), probe/test files reading service keys (not app-reachable), and the e2e fixture route (env-gated, fixture-only).*

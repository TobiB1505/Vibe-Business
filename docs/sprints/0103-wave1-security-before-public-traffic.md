# Wave 1 — security before public traffic

**Recorded 2026-08-27, after the work.** Twelve findings from the [launch-readiness audit](../audits/2026-08-26-launch-readiness/README.md)'s Wave 1: *"security before public traffic"*. Ten closed, one partly, one blocked on a decision that is not an engineer's to make. Seven migrations, all deployed before the code that needs them.

## What was wrong

Wave 0 (VB-001/002/003) had made deletion possible and erasure real — [sprint 0100](0100-vb001-vb002-lifecycle-and-erasure.md). Wave 1 is the block the audit put between that and letting strangers reach the product.

The findings are not one theme. Two are money leaking, four are a browser being trusted with things a browser should not be trusted with, and the rest are limits that did not exist.

## What changed

### The database stopped trusting the browser

Four findings, and they compound, so they are best read as one.

**VB-015** was the platform default: Supabase granted `arwdDxtm` on all 53 public tables to `anon` and `authenticated` at create time. RLS covers most of it and **not `TRUNCATE`, which row-level security does not govern at all** — a role holding it empties a table regardless of every policy. `anon` now holds nothing on any table; `TRUNCATE`, `REFERENCES` and `TRIGGER` are gone from both roles.

**VB-019**: six tables carry a denormalized `user_id` beside a `project_id`, and their UPDATE policies checked only the project. Nothing said the row's own owner had to survive the update, so an owner could write another identity onto their own row and the policy passed. Billing resolves the economic owner through that column and erasure finds an account's rows by it.

**VB-018**: `validation_runs.status`, the SHAs on `prepared_changes`, an audit's result — all things Vibe *concluded* — were writable through the Data API. A customer could mark their own validation `passed`, which the approval and merge machinery downstream treats as a fact Vibe established. Tracing every mutating store function to its callers found that validation and preparation are reached only from durable execution, so both lost client UPDATE outright. The audits table has exactly one legitimate client writer — the founder answering the audit's question, which sets `status` and `pending_question` — so it is column-restricted instead.

**VB-006**: none of the three Supabase client factories passed `cookieOptions`, so the session cookie carried library defaults without `Secure` on a host only ever served over HTTPS.

### Two money leaks

**VB-013**: a Stripe claim abandoned at `processing` — a crash between the insert and either completion or release — was permanent. Every later retry lost the unique index, read `processing`, and was answered `duplicate`, which is a 2xx. Stripe stopped retrying. **The customer paid, no Credits posted, and nothing anywhere was red.**

**VB-009**: `revealAuditAndFindFirstMoveAction` passed `bundled_with_free_audit` unconditionally. It is a Server Action, so anyone who had finished onboarding could invoke it again and regenerate Moves for nothing, indefinitely, while the control beside it charged 20 Credits for the same operation.

**VB-016**, in part: the agent gateway's budget summed tokens from rows whose status was `succeeded`. A stream that fails *after* the provider has emitted tokens is billed for them and its row is `failed`, so those tokens were excluded from the ceiling entirely.

### Limits that did not exist

**VB-008**: only the Business Audit had a start limit. Every other path could be started in a loop, each spending paid inference, sandbox minutes or remote browser time. Enforced in `createOperationRun` because [ADR 0057](../decisions/0057-account-level-durable-operations.md) §5 established it is the single insertion funnel — so the limit also covers the start path nobody has written yet.

**VB-010**: Supabase Auth limits by IP, and Vibe runs behind a shared Vercel egress pool, so one attacker's attempts against one account arrive mixed into everyone else's traffic.

**VB-007**: `pnpm audit --prod` reported 6 vulnerabilities, 2 high. The launch gate requires zero.

**VB-005** ([ADR 0059](../decisions/0059-security-response-headers.md)): no security headers at all.

## What the work found that the findings did not say

- **pnpm 11 reads `overrides` from `pnpm-workspace.yaml`, not `package.json`.** The same keys under `package.json` are silently ignored: the lockfile does not change and the audit stays red. VB-007 looks fixed and is not.
- **`business_readiness_audits` has no `user_id` column at all**, so it was never in VB-019's set — which is why VB-018 had to restrict it by column instead.
- **Customer brand logos are plain `<img>` at arbitrary customer URLs.** A textbook `img-src 'self'` would have blanked every logo on the dashboard.
- **The `execution_interrupts` UPDATE policy is named `answer own …`, not `update own …`.** An earlier draft guessed it from a superseded migration and the real-PostgreSQL harness refused to apply it.

## The mistake worth recording

VB-015's first draft derived the grant set from the policies and re-issued it — *"authenticated gets exactly the commands a policy exists for"*. It was wrong, and it **re-granted `projects.DELETE`**, undoing VB-001's invariant that no Data API role can start a project cascade.

`lifecycle-authority.migration.ts` and `project-write-paths.migration.ts` caught it, because they assert the invariant rather than the migration that established it. It had already reached production by then; `20260827191326` repaired it and the check confirms `projects.DELETE` is held by nobody.

**A policy and a privilege are two independent decisions, and a policy is not evidence that the privilege is wanted.** The migration is now purely subtractive: it can remove an unbacked privilege and it can never re-open a door another migration closed.

## What was not done, and why

- **VB-011 (UNKNOWN/HIGH) — blocked, not deferred.** Whether Preview carries production secrets cannot be answered from here: no tooling available to this session lists Vercel environment-variable scoping, and read access to the project does not include it. `docs/deployment/environment.md` now names the five variables and what a Preview holding each one can do. **It stays UNKNOWN** — the audit's own status — until someone compares the scopes in the dashboard.
- **VB-017 — needs an ADR first.** The finding is real: candidate file *contents* cross the Vercel Workflow durable log at `workflow.ts:258–268`, which is customer-repo-derived bytes in a third-party store (rule 52). But its proposed fix — persist the verified candidate in the database — contradicts a standing decision: `prepared_changes.files` is documented as *"Paths and hashes only — never content (§23)"*. Reversing that is rule 20's territory, not a judgement call inside a security sprint.
- **VB-016, two of three parts.** The check-then-act race before the fetch still needs a pending-attempt marker, and `max_tokens` is still not clamped to the remaining budget. Only the billed-token count was fixed.
- **VB-008's typed reason reaches six paths, not ten.** Merge, outcome verification, review and validation carry narrower result unions of their own. The limit binds them through the funnel; their surfaced reason stays generic rather than widening four more vocabularies inside a security change.

## What has not been proved

- **No dogfood.** Nothing here was exercised against a real session, a real Stripe delivery or a real brute force. The database half is proven against real PostgreSQL; the application half is proven against fakes and a browser.
- **The CSP protects nothing yet.** It ships report-only per the launch gate's own sequencing, and there is no `report-to` endpoint, so violations reach the browser console and nowhere else.
- **The throttle's fail-open is untested against a real outage.** It returns `allowed` on any failure including a thrown one, which is asserted in unit tests and never observed under a real database failure.
- **VB-010's window numbers are chosen, not measured.** Eight failures in fifteen minutes is a round number above what the UI produces and below what a loop does.

## Validation

Measured on the branch head:

| check | result |
| --- | --- |
| `pnpm audit --prod` | **no known vulnerabilities** (was 6, 2 high) |
| Migration tests (real PostgreSQL) | 136 passed, 9 files |
| Unit tests | 6712 passed |
| Browser suite | 359 passed |
| Security advisors | 2 findings, both non-defects (was 4) |
| Typecheck / Build | clean |
| Lint | 19 warnings, 0 errors — unchanged from main |

Every guard added here was checked for teeth by breaking the thing it guards. The seven migrations were deployed before the code that depends on them, each verified by reading the catalog back rather than from the apply response.

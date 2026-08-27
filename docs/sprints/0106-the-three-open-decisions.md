# The three open decisions

**Recorded 2026-08-27, after the work.** Three findings that Waves 1–3 left open **not** because they were hard but because each needed a decision somebody had to make: VB-053, VB-017 and VB-033. All three are now decided and implemented. One ADR, two migrations, no new infrastructure.

The fourth, VB-011, is still open, and this record says exactly how far it got.

## VB-053 — the throttle's authority is who may call it

### What was wrong

[VB-010](0103-wave1-security-before-public-traffic.md) added per-account sign-in throttling and granted `record_auth_attempt` to `anon`, on the reasoning that sign-in happens before there is a session so the caller *is* `anon`. That is correct about the caller and wrong about the consequence: `anon` is anyone holding the publishable key, and the publishable key is published in every browser bundle by design.

[Sprint 0104](0104-wave2-database-and-performance.md) closed one of the two vectors — an anonymous caller could no longer *clear* somebody's window. It could still **spend** it: eight POSTs carrying `sha256(lower(victim@example.com))` refused that account sign-in for 884 seconds, repeatably, forever.

That is not a weakness in the control. It is the control used as a weapon. Before VB-010 nobody could stop a known address from signing in.

### The decision

**`execute` is revoked from both Data API roles and the only caller is a service-role client obtained inside `throttle.ts`** — [ADR 0060](../decisions/0060-sign-in-throttle-authority.md).

Two alternatives were available and both were rejected on stated grounds. A **server-held secret** works and cannot be committed ([rule 12](../../CLAUDE.md)), so it ships inert and stays inert until two manual steps are done in the right order — with the vector open and nothing saying so. **Dropping the account throttle** removes the lockout and returns the guessing bound to what it was before VB-010, which leaves the gap VB-010 correctly named.

The forgery was a transport-layer fact, so removing the transport removes it by construction rather than by validation.

Sprint 0104's JWT-derived clear is **replaced, not rolled back**. It existed to make a publicly callable function safe; under this decision the function is not publicly callable, and the check would now break the one legitimate caller, because a service-role caller carries no `email` claim and would clear nothing.

### The mistake worth reading

The ADR's first draft said `service_role` "needs no grant: it holds the platform default". **Reading `pg_proc.proacl` back after the apply is what said otherwise:**

```
proacl = {postgres=X/postgres}
```

Nobody but the owner. `service_role` is an ordinary role with `bypassrls`, not a superuser and not a member of `postgres`; Supabase's default privileges apply when a function is *created*, and `create or replace` keeps the existing ACL while `revoke all from public` clears what the default had left.

**The failure would have been silent.** The throttle fails open by design, so every call would have errored, every call would have returned `allowed`, and sign-in would have worked perfectly — the control present, wired, tested, and doing nothing.

And the test could not have caught it. The harness connects as the function's owner, so every behavioural assertion passed with `service_role` holding no privilege at all; the privilege block asserted the *absence* of the grant for the two roles that must not have it and never its *presence* for the one that must. Every behavioural call now runs under `set local role service_role`, so removing the grant fails six assertions instead of none.

## VB-017 — the bytes stop travelling

### What was wrong

`extractAndVerifyStep` returned the changed files with their contents and the workflow handed them to `writeAgentBranchStep`. A step's return value crosses the Vercel Workflow log, which is a third-party durable store — so a customer's repository bytes were sitting in one, against [rules 26 and 52](../../CLAUDE.md) and against [ADR 0013](../decisions/0013-durable-operation-execution.md)'s own claim that only identifiers travel.

### The decision

The audit's proposed fix was to persist the verified candidate and pass an id, which contradicts a standing decision: `prepared_changes.files` is documented as *"Paths and hashes only — never content (§23)"*.

Neither store should hold the bytes, so **neither is where they go**. Rule 52 already says what to do in its own words — *pass identifiers and rebuild bounded data inside the step* — and that is what this does. The boundary carries the observed paths and a 64-character digest; `writeAgentBranchStep` rebuilds the files from the sandbox, which is still alive because cleanup runs after it.

### What tracing it found that the finding did not say

`candidateDigest` already travelled **beside** the files and was never compared against them. It was used to compute the change identity and nothing else — so the write step wrote whatever came back out of the third-party log, unverified.

Now the digest is the only thing that travels and the rebuilt bytes have to earn it. A mismatch refuses, in the same posture [rule 56](../../CLAUDE.md) takes toward a moved base: the difference is not reasoned about, it blocks. Every failure mode in the new path is a refusal to write.

## VB-033 — spend is noticed where it is spent

### What was wrong

Nothing watched what an account was costing. VB-008's start limits bound how *often* work can begin; a customer with a large balance running expensive executions is inside those limits and spending real money.

### The decision

The finding's remedy is a *"scheduled ledger read + thresholds"*, and that is why it sat blocked: a scheduler is a background technology this product has not decided to have, and [rule 24](../../CLAUDE.md) says an ADR rather than an import.

It is also the wrong shape for the question. **The observation now runs at the write that causes the spend.** `recordAIUsage` has already computed the provider cost and written the row, so summing the account's last day sits off the latency-critical path, on the same service-role client that just did the insert. A periodic sweep learns about a spike up to one interval late; this learns immediately, and adds nothing to run.

**It refuses nothing**, and that is the other half of the decision. A per-user spend ceiling is a judgement about what a customer may do with money they have already paid for — a product decision, not an engineering one. This tells Vibe; it tells the customer nothing.

## What was not done, and why

- **VB-011 is still open, and this is how far it got.** The Vercel MCP surface available to this session was tried rather than assumed unavailable: `list_teams` and `get_project` both answered, returning project metadata, deployment state and the five configured domains — and **no environment-variable scoping**. There is no tool in the surface that lists which variables a Preview deployment carries. The finding stays UNKNOWN, which is its own status, until somebody compares the scopes in the dashboard. `docs/deployment/environment.md` already names the five variables and what a Preview holding each one can do.
- **Platform-wide spend.** Summing every account on every paid call would put a growing aggregate on the hot path of the thing it measures. That view is the half that genuinely wants a scheduled reader, and it is the only part of VB-033 still open.
- **A spend ceiling.** Stated above: not an engineering decision, and inventing one would be exactly the kind of product requirement [rule 14](../../CLAUDE.md) says to stop and report rather than invent.
- **The Sentry alert rules.** They live in the Sentry dashboard, not in this repository. Wave 3 made the events exist as issues; nobody has configured a rule.

## What has not been proved

- **No sign-in has been made against the new throttle.** The privilege boundary is proven against real PostgreSQL and the RPC's unreachability was re-probed against the deployed database; a real sign-in through the deployed application has not been run.
- **The rebuild has not been dogfooded.** `writeAgentBranchStep`'s new path is proven against a fake sandbox provider. No agent execution has written a branch through it against a real repository, and that is the one change here with a consequential external write behind it.
- **The spend threshold has never been crossed.** $25 in a day is chosen, and no account has approached it, so the alert has never fired in anger.
- **The throttle's fail-open is still untested against a real outage**, unchanged from Wave 1.

## Validation

Measured on the branch head:

| check | result |
| --- | --- |
| Unit tests | 6899 passed, 402 files |
| Browser tests | 366 passed |
| Migration tests (real PostgreSQL) | 147 passed, 9 files |
| Deployed-database probe | anon `POST /rest/v1/rpc/record_auth_attempt` → `42501`; `pg_proc.proacl` read back and `has_function_privilege` confirmed for all three roles |
| `pnpm typecheck` | clean |
| `pnpm lint` | 19 warnings, 0 errors — the baseline `main` already carried |
| `pnpm build` | clean |

Each new guard was checked by breaking what it guards: granting `execute` back to the Data API roles fails two privilege assertions, removing the `service_role` grant fails six behavioural ones, disabling the digest comparison fails the branch-write refusal, and dropping the `user_id` filter fails the spend observer's tenant assertion.

One existing assertion changed, and it was strengthened rather than relaxed: `lifecycle-authority.migration.ts` pinned `record_auth_attempt` as the single reviewed `SECURITY DEFINER` function reachable by a Data API role. There are now none, and the comment records that the argument for that exception was wrong — the bound was on what an argument could reach, never on who could pass one.

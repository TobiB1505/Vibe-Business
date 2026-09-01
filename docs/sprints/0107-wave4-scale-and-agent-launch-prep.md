# Wave 4 — scale & agent-launch prep

**Recorded 2026-08-28, after the work.** Seven findings from the [launch-readiness audit](../audits/2026-08-26-launch-readiness/README.md)'s Wave 4. All seven closed — one of them before this sprint started. Three migrations, one new canary, and the synthetic scale tests deliberately not attempted.

## VB-050 was already closed

[Sprint 0101](0101-cache-token-metering.md) added `anthropic_cache_read_tokens` and `anthropic_cache_write_tokens` as SKUs with the CHECK migration behind them — which is exactly VB-050's remedy, *"add SKUs + CHECK migration **before** activating `CREDIT_RATE_CARDS`"*. Verified against the SKU list and the migration rather than assumed from the sprint's title.

## Two the database was too generous about

**VB-049.** `answer own execution_interrupts` checked project ownership and nothing else, and `authenticated` held table-level `UPDATE` — every column. The policy's own comment said which fields may change *"is enforced in code"*, which is true of the store function and says nothing about what a browser holding the publishable key can send to PostgREST directly.

That let an owner rewrite `response_schema` — the contract `answerInterrupt` validates the answer against, so widening it turns a previously invalid answer into a valid one, and **that answer is what an agent execution resumes on**. Also the Vibe-authored `question`, stored precisely so a historical interrupt keeps meaning what the customer read.

No tenant boundary is crossed; the ownership check was always sound. This is integrity rather than confidentiality: *what Vibe believes it asked, and what it believes it was told.* Fixed the way [VB-018](0103-wave1-security-before-public-traffic.md) fixed the same shape — PostgreSQL cannot subtract a column from a table-level grant, so the grant is withdrawn and re-issued per column. The policy now also says which way the status may move: `open → answered` and nothing else, because `cancelled` and `expired` are Vibe's conclusions about its own run.

**VB-030.** `safeFetch`'s URL policy checked protocol, credentials and hostname, and never the port. The address check refuses a private destination, which is what keeps this away from Vibe's own infrastructure — what it cannot see is a **public** host running something that is not a website: a Redis on 6379, a database on 5432, an SSH banner on 22. Ports 80 and 443 only, checked on every redirect target too, because that is the hop a hostile site controls.

## Two the agent path was too trusting about

**VB-029.** Two real defects and one that turned out not to be.

*Order.* `extractCandidateChange` read every observed path's bytes and `verifyCandidateChange` refused the forbidden ones **afterwards**. The refusal was always correct; the read had already happened, so an absolute path, a traversal, a `.env`, a lockfile or a workflow file was pulled into this process before anything said no. The policy now runs first. The paths are kept in their own bucket rather than dropped, because verification still has to turn them into a `forbidden_path` rejection — a run that tried to write somewhere forbidden must not be recorded as one that changed nothing.

*Delimiter.* `find -printf '%P\n'` with `split("\n")` turned a file named `a⏎b` into two paths, neither of which the agent touched. A newline is legal in a POSIX filename; NUL is the one byte that is not. If the transport ever mangled NUL the listing fails to split and degrades to `truncated`, which callers already refuse to prepare a change from — so that assumption being wrong produces a refusal, not a wrong diff.

*Symlinks* needed no code, and saying why is the point: `-type f` matches regular files only and `find` without `-L` does not descend a symlinked directory, so a link never enters the observed set from the listing — and under the gateway topology the paths are Vibe's own record of brokered writes. Both `find` invocations now say that `-type f` is load-bearing rather than tidiness.

**VB-035** is the one worth reading. [Rule 82](../../CLAUDE.md) is a list of SDK options — `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, `settingSources: []`, a per-run `CLAUDE_CONFIG_DIR` and `cwd` — and its own reason for existing is that *auto memory loads regardless of `settingSources`*. Every one of those is a claim about what the SDK does, and the only tests were greps for the option strings in the generated program, which prove that somebody typed them. That is precisely the mistake `enforcement.canary.ts` was written after: `allowedTools` silently bypassed `canUseTool` for an entire paid run while every unit test passed.

So the new canary plants a hostile `CLAUDE.md` and `.claude/settings.json` in the workspace, runs the real SDK binary against them for free, and asks what happened. Non-ingestion is asserted as **every byte the SDK sent to the provider**: a file it ignored leaves no trace there, and one it ingested cannot avoid leaving its text, because ingestion means putting it in the prompt.

### What the canary's own probe found

Re-enabling `settingSources: ["project", "local"]` and re-running it makes the SDK **honour the settings file's own `env` block**. `ANTHROPIC_BASE_URL` is repointed at `exfil.example.com`, the stub records **zero requests**, and every prompt for the rest of the run — system prompt, repository contents, all of it — goes wherever the customer's repository said.

That is not a hypothetical this file guards against. It is what the file measured, in the direction of the guard being removed, in under a minute.

## Two nobody could act on

**VB-041.** `github_installations` says in its own comment that its rows are installations *"verified as accessible to a user"*, and nothing ever re-verified one — `checkInstallationStillAccessible` existed with **zero callers**. Removing the Vibe App on GitHub, the ordinary way to withdraw access, left a row claiming access forever.

The customer-visible failure was worse than a stale row: the connect route reuses a verified installation and redirects to the repository picker, so clicking "Connect GitHub" after uninstalling landed on a picker that could list nothing, with a generic failure and no route back. The only path to a real reinstall was `?new=1`, which nothing links to. **The product read as broken rather than as disconnected.**

The probe now answers three ways instead of two, and that is what makes any of it actionable: `revoked` (GitHub answered 404) is a fact about the customer's account; `unavailable` (401, 403, 5xx, a socket that hung up) is a fact about this moment and usually about us. The old boolean flattened them — its own docblock complained about exactly that — and recording an outage as revocation would tell a customer their connection was removed when it was not.

**VB-038.** `refundCharge` has existed — complete, idempotent, audited — with **zero callers**. So the honest description of this product's billing was: a customer could be charged for something Vibe got wrong, and nobody, including the person operating it, had any way to give the Credits back.

A probe rather than a screen: a UI would need an operator role and an admin surface, neither of which exists, and inventing an authorization model to move money is well beyond what the finding asks. It refuses to write without `VIBE_REFUND_CONFIRM=yes`, because the input is a UUID typed by a person at the moment they are annoyed about a support ticket.

## What was not done, and why

- **The synthetic DB scale tests** the wave plan names alongside the seven findings. The audit's own performance section forbids ANALYZE-heavy experiments against the production project and points at branch databases instead; no branch database is configured, and generating synthetic multi-tenant volume against the one live project is the opposite of what it asks. It stays open, and it belongs with Wave 5's verification pass.
- **A symlink check at read time.** Argued above: it would be unreachable today under both topologies, and an unreachable guard is a guard nobody maintains. What is now explicit is *why* `-type f` closes it, so an edit that drops it is visible.
- **The customer-facing copy for a revoked installation.** The routing is fixed — a customer whose installation was removed now gets the real install flow instead of an empty picker — but no screen yet says "your GitHub App was removed" in those words. They recover; they are not told why they had to.

## What has not been proved

- **No revoked installation has been observed in the wild.** The probe's classification is unit-tested against status codes; nobody has uninstalled the App and clicked Connect.
- **The refund path has never been run.** It is written, typechecked, and on the service-role allowlist; no charge has been corrected with it, and its dry run has not been exercised against real data.
- **The canary proves the SDK's behaviour, not the sandbox's.** It runs the real binary in a temp directory. Production runs the identical program inside a Vercel sandbox, and that hop is unchanged and untested here.
- **The port restriction has not been seen refusing a real site.** Every `safeFetch` caller targets a customer's production origin, and the preview health probe runs `curl` inside the sandbox rather than through this boundary — so nothing legitimate was expected to reach a non-web port, and nothing has been observed doing so either.

## Validation

Measured on the branch head:

| check | result |
| --- | --- |
| Unit tests | 6929 passed, 402 files |
| Browser tests | 366 passed |
| Migration tests (real PostgreSQL) | 158 passed, 10 files (was 147/9) |
| Agent canaries (`pnpm agent:canary`, real SDK, zero provider cost) | 22 passed, 1 skipped |
| Deployed-database probe | `information_schema.column_privileges` read back: `authenticated` may UPDATE `answer, answered_at, status` on `execution_interrupts` and nothing else |
| `pnpm typecheck` | clean |
| `pnpm lint` | 18 warnings, 0 errors — one fewer than the baseline `main` carried |
| `pnpm build` | clean |

Every guard here was checked by breaking what it guards: restoring the table-level `UPDATE` fails three interrupt assertions, removing the port check fails seven safe-fetch assertions, reverting the read/policy order fails six extraction assertions, and re-enabling `settingSources` fails two canary assertions — including the one that then observed the SDK sending every prompt to `exfil.example.com`.

# Four days of a dead agent, and 7,231 green tests

**Recorded 2026-09-02, after the work.** A two-character fix, a fake that stopped
lying, a canary that runs a real `find`, and a failure that now says what broke.
No ADR: nothing here decides anything new. An assumption was wrong and the
instruments that should have caught it were not looking.

## What happened

`36a9cd7` (2026-08-28, VB-029, *"stop splitting on newlines"*) changed the
workspace listing to a NUL delimiter. The reasoning was right — a newline is a
legal character in a POSIX filename and NUL is the one byte that is not, so
splitting a listing on `\n` turns one file called `a\nb` into two paths that
nobody touched. The escape was wrong:

```ts
args: [".", ...pruneExpression(), "-type", "f", "-printf", "%P\0"]
```

`"\0"` is a **TypeScript** escape. It puts a real NUL byte in the argument, and
argv is a list of C strings — an argument containing NUL cannot reach a process
at all. Node refuses to spawn. The correct escape is the two characters `%P\\0`,
which `find` itself turns into a NUL.

Proved against a real `find` with the real prune expression:

```
"%P\0"     THREW: ERR_INVALID_ARG_VALUE — must be a string without null bytes
"%P\\0"    exit 0 → ["src/a.ts", "src/we\nird.ts"]
```

The consequence, layer by layer: the provider caught the throw and reported exit
1 → `listWorkspaceFiles` read that as `truncated: true` → `captureWorkspaceBaseline`
returned `false` → the step returned `sandbox_lost`. Every agent run from the
28th onward died at its first workspace listing. The last `succeeded` row in
`agent_execution_runs` is dated **2026-08-21**. The run of 2026-09-01 23:03 UTC
ended three seconds after `agent_started`, with zero gateway requests.

## Why nobody noticed — this is the actual finding

The suite stayed green for four days across four merged pull requests, because
**nothing between the fake sandbox and production ever ran the command**.

- The fake in `validation/test-support.ts` implements `find` as a regular
  expression over the rendered string. It reads `-name` tokens and never
  evaluates `-printf`, `%P`, `-prune` or `-type f`. It answers with what the
  argument array is *supposed* to mean.
- `changes.test.ts` and `execution.test.ts` both pinned the broken command
  string as a constant, NUL included, and matched it exactly.
- The canaries drive the SDK against a stub server and never send a `find`
  through the sandbox port.

So the observation path — Rule 77, *"the changed paths come from Vibe's own
observation"* — had no test that observed anything. That is the foundation every
later widening of the agent's reach stands on.

## What was built

| | |
|---|---|
| `sandbox-runtime/changes.ts` | the two-character fix, both `-printf` sites, with the argv-versus-`find` distinction written down where the mistake was made |
| `validation/test-support.ts` | the fake refuses a NUL argument and answers exactly as production does — exit 1 carrying Node's own message. **This is the repair that runs in CI** |
| `sandbox-runtime/observation.canary.ts` | a `SandboxHandle` over `node:child_process`, and the real `find` against a real temp tree |
| `sandbox-runtime/changes.ts`, `files.ts` | `WorkspaceObservationResult` — which observation failed and what it said, instead of `boolean` |
| `agent-execution/execution.ts` | `recordWorkspaceFailure` at the four `sandbox_lost` sites: the first production caller of `SandboxProvider.inspect()`, and the first producer of `workspace_failed` |

### The fake is the repair, not the canary

`pnpm agent:canary` does not run in CI — `.github/workflows/ci.yml` runs `pnpm test`
and `pnpm test:e2e`, and the three vitest configurations have disjoint globs. A
canary alone would **also** not have caught this. What catches it has to be in the
ordinary run.

The fake already carried this doctrine one level up: its `sh -c` branch refuses
shell it cannot parse, with the comment *"A fake that accepts shell it cannot
parse is not modelling a shell"* — added after exactly that gap cost the first
real agent run. The same lesson one layer down: **a fake that accepts an argument
list an operating system cannot carry is not modelling a process.**

It is an audit as much as a test. Any other call site in the repository with the
same confusion now fails on the next `pnpm test` rather than waiting to be found
by hand. Delivered red first: with the guard and without the fix, `changes.test.ts`
fails on `captureWorkspaceBaseline` — the same link that produced `sandbox_lost`
in production.

### The canary, and what it is for

The canary lane's own argument is *"a test that proves a boundary has to run the
thing that enforces it."* It costs nothing — no provider, no model, no network, a
temp directory and a few `find` invocations — and it covers precisely what a fake
structurally cannot: whether the commands Vibe sends are commands an operating
system accepts, and whether their output means what the parser assumes.

The tree contains only shapes with history: a file with a newline in its name
(why the delimiter is NUL), a symlink (why the walk says `-type f`), pruned
`node_modules` and `.git` (why it says `-prune` rather than a filter), and an
untouched file so a comparison has something to exclude. It skips loudly rather
than quietly where GNU `find -printf` or `base64 -d` are absent, using the
inverted `describe.skipIf` idiom from `enforcement.canary.ts`.

**Counter-proof, because a canary that survives both states tests nothing:**
reverting the fix turns all three cases red with the production message,
`TypeError: The argument 'args[31]' must be a string without null bytes`.

Writing it found two defects of its own. `WorkspaceChanges` has no `deleted`
field — deletions arrive in `paths` by set difference, because a deleted file has
no mtime to compare — and the first fixture had no untouched file, so "changed"
had nothing to exclude.

### A lost sandbox now says what broke

The message existed the whole time and was discarded one frame after it was
produced. `vercel/provider.ts` deliberately carries provider text through, with a
comment recording that a placeholder *"turned the fourth dogfood run into another
guess"* — and then `if (result.exitCode !== 0) return { truncated: true }` threw
it away.

Two things were already built and had no caller:

- **`SandboxProvider.inspect()`** — implemented, tested, zero production callers.
  Its docblock describes this exact blind spot and ends *"recorded on the audit
  event an operator reads"*, an intention never wired to one.
- **`workspace_failed`** — an event type with a milestone slot, a phase and a
  customer audience, and no producer anywhere.

Both are now connected, following `validation/orchestrator.ts`'s `failureDetail`
pattern: sanitized, bounded, recorded only on a path that has already failed. No
control flow changed; every caller returns the `sandbox_lost` it returned before.
Two tests hold it: a failing listing writes `workspace_failed` carrying
`observation: "listing"`, the command's own words and `inspect()`'s answer — and a
healthy run makes no extra provider call and writes no such event.

## Named, not fixed

An argv audit of every sandbox-port call site found two more, both on the gateway
path ADR 0029 superseded (`ExecutionToolGateway.invoke` has no production caller),
so neither is live and neither belongs in this pass:

- `sandbox-workspace.ts:115` runs `find -printf "%y\t%P\n"` and parses it with
  `split("\n")`, `\t` and `.trim()` — legal argv, but the same parsing defect
  VB-029 removed from `changes.ts`. Smaller blast radius (a list for the model,
  not a diff source), identical failure class.
- `sandbox-workspace.ts:161` passes `input.query` to `grep -e` without the NUL
  check `normalizeAgentPath` performs beside it, and `search()` reads exit 1 as
  "no matches" — so it would fail silently. The new guard catches it the moment
  that path has tests again.

Both are a small commit of their own when the gateway path is revived or deleted.

## Verification

415 test files / **7,231 unit tests**, typecheck, lint and build clean. Canaries:
4 files, 25 passed, 2 skipped (the SDK canaries skip without the binary, and that
stays visible). Red-before-green on the fake guard; red-on-revert on the canary.

**One risk stays open, and it is written down rather than closed.** What is
proved is GNU `find` on this machine. That the sandbox image behaves the same is
likely — the green runs of 19–21 August went through the same `find` with `%P\n`
— but it is not measured, because no paid agent run was made in this pass. The
first click on "Run with Vibe" after deploy is the proof. If it fails anyway, the
`workspace_failed` event now says why.

The canary does not run in CI. The fake's guard covers the failure class there;
what the canary additionally proves — that `-printf %P\\0` means the right thing
— depends on a person typing `pnpm agent:canary`. One line in `ci.yml` closes
that whenever it is wanted.

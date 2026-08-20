# POST-IMPLEMENTATION COMPLETION CONTROL

## Run #5 validated first (PART A)

Prepared change `61c3fc86`, commit `3c4cc7ed6243393401d67a7a96232e41b9021e8f`,
branch `vibe/agent-b762f636cbfc`. Validation run `ad6c3141`, profile
`nextjs_node_v1`, sandbox policy `sandbox-policy-v5`.

| Step | Result | Duration |
| --- | --- | --- |
| `pnpm install --frozen-lockfile --ignore-scripts` | passed (exit 0) | 13.2s |
| `pnpm run typecheck` | passed (exit 0) | 86.9s |
| `pnpm run test` | passed (exit 0) | 87.1s |
| `pnpm run build` | passed (exit 0) | 111.1s |

Revision integrity: `revisionMode: provider_pinned`, `gitCommitObserved: true`,
requested revision matches the prepared commit exactly, `changedFilesVerified:
true`, all four build-identity files verified, none unverified. Sandbox
`stopped`, 340.7s total. **Final result: passed.**

The faster verification strategy produced a valid candidate. The agent ran no
typecheck at all and the independent typecheck passed anyway — which is the
evidence that supported forbidding it at LOW.

## The tail, reconstructed (PART C)

Last edit at 59.3s; run ended at 191.8s.

| t | tool | detail | in brief? | classification |
| --- | --- | --- | --- | --- |
| 62.5s | Read | `src/app/layout.tsx` | yes | required verification |
| 63.0s | Read | `src/app/app/layout.tsx` | yes | required verification |
| 63.3s | Grep | `src` | — | exploration |
| 68.2s | Read | `…/generators/nextjs-seo-foundations.ts` | **no** | unrelated exploration |
| 84.7s | Bash | `node -e "…dependencies.next"` | — | orientation — re-derived a brief fact |
| 91.1s | Grep | `src/app` | — | exploration |
| 91.1s | Glob | — | — | exploration |
| 96.8s | Grep | `landing-contract.test.ts` | — | locating a test |
| 101.6s | Bash | `vitest run …contract.test.ts` | — | permitted targeted test |

Provider calls after the last edit: **8 of 15**, $0.1496 of $0.3199.
Reads beyond the brief after the last edit: **1**. Searches: **4**.

Answers to the questions asked:

1. **Legitimate**: the two diff-review reads, the search that located a test,
   and the targeted test. Four of nine.
2. **Redundant**: three broad searches, one unrelated file read, and a command
   that printed the Next.js version — a fact the Execution Brief had stated.
3. **Preventable without risking convergence**: all five. None followed a
   failure; none referenced anything the change touched.
4. **The targeted test ran after the final edit** (101.6s vs 59.3s).
5. **No tool failed.** There was no `command_failed` event and no error in the
   feed, so nothing in the evidence justified widening.
6. **8 provider calls.**
7. **$0.1496.**
8. **1 read beyond the brief.**

LOW's budget of six post-edit tool calls comes directly from this: enough for
the four legitimate actions plus two, and less than the nine taken.

## What was built

| File | What it is |
| --- | --- |
| `execution-context/completion.ts` | Observed phases, `CompletionBudget`, deterministic activity classification, `decideCompletionAction`, the sandbox policy |
| `sandbox-runtime/program.ts` | `PreToolUse` as the decision point; `PostToolUseFailure` as the repair signal |
| `sandbox-runtime/canary/` | A stub Anthropic server and a runner for the real SDK binary |
| `sandbox-runtime/enforcement.canary.ts` | Proof that the boundary refuses, and that the refused command does not run |
| `sandbox-runtime/completion.canary.ts` | Proof that the budget binds, and that repair survives it |
| `vitest.canary.config.mts` | A third config, so canaries are never confused with billable probes |

Plus four event types, ten nullable columns, and an "After the change" panel in
Developer Details.

## Two bypasses found, both by running things rather than reading them

**`permissionMode: "default"` skips `canUseTool` for safe tools.** Removing
`allowedTools` in `38dd27f` fixed Bash and left Read, Glob and Grep
unmediated. `PreToolUse` has no such carve-out.

**A failed `Read` unlocked unlimited exploration.** The completion canary hit
this immediately: reading two non-existent files set `unresolvedFailure`, which
outranks every budget. Now only a failed **command or write** counts — a missing
file says the agent guessed a path wrong, not that the implementation is.

## Enforced versus asked

| | Mechanism | Real? |
| --- | --- | --- |
| Which checks may run | `PreToolUse` inspects the command | **Enforced**, canary-proved |
| Post-edit tool budget | `PreToolUse` counters | **Enforced**, canary-proved |
| Outside-brief read allowance | `PreToolUse` + brief paths | **Enforced**, canary-proved |
| Repair-cycle cap | `PreToolUse` counters | **Enforced**, canary-proved |
| Repair unlock | `PostToolUseFailure` on command/write | **Enforced**, observed by the harness |
| Do the reading before you write | Prompt wording | Asked |
| Reading its own diff | Prompt wording | Asked — no command to intercept |
| Whether the change is safe | Independent validation, human approval | **Unchanged** |

The harness is Vibe-authored and versioned, but it runs inside the customer's
VM. It bounds what the *model* spends. It is **not** a hostile-repository
security boundary, and nothing in this sprint should be read as making one.

## Gate

Typecheck clean, **4,997 unit tests**, **14 canary tests** against the real SDK,
**304 E2E**, eslint 0 errors, `next build` green. Migration `20260819220000`
deployed via the Supabase MCP with the remote history inspected first (rule 30)
and the ledger reconciled to the filename (rule 34). No billing table touched.

## Run #6 benchmark plan

Not run. Same robots step, project, model, context system, budgets, candidate
policy and independent validation profile. Only completion control changes.

| | #3 | #4 | #5 | #6 target |
| --- | --- | --- | --- | --- |
| Duration | 8m 44s | 6m 28s | 3m 12s | 1.5–2.5 min |
| Provider calls | 21 | 13 | 15 | < 10 |
| Provider cost | $0.3465 | $0.2272 | $0.3199 | $0.10–$0.18 |
| Calls after last edit | — | — | 8 | materially fewer |
| Cost after last edit | — | — | $0.1496 | materially lower |
| Reads beyond brief | — | 6 | 11 | materially fewer |
| Agent builds | 1 | 1 | 0 | 0 |
| Agent full suites | 1 | 1 | 0 | 0 |
| Agent typechecks | 1 | 1 | 0 | 0 |
| Candidate | 2 files | 2 files | 2 files | 2 files, correct |

Targets, not thresholds. A correct two-file candidate that costs $0.20 beats a
cheap one that fails validation.


---

# Run #6 and the two findings it produced

Run #6 (`0c481729`) succeeded: 79.9s, 10 provider calls, $0.1444, the same
two-file candidate, prepared SHA `c9d1b8d2`, independent validation passed
(install 15.0s / typecheck 93.6s / test 91.1s / build 120.8s, revision integrity
verified, sandbox stopped). `policy_decisions: 14` — the enforcement path was
live for the first time in a paid run.

It also produced two measurement defects, both fixed here.

## 1. A grep was recorded as a targeted test

The command was:

```
grep -rn "robots" src/app/landing-contract.test.ts ; find . -iname "*metadata*.test.*"
```

The old rule was `\b(vitest|jest|playwright|test)\b`, and `test` appears in both
*filenames*. `\bbuild\b`, `\btypecheck\b` and `\blint\b` had the same flaw: any
command that so much as mentioned one would have been classified as running it
— and since sprint 0042 that means **refused**. An agent grepping for the word
`build` would have been told it may not build.

A check now has to look like something being *run*: a known runner binary
(`vitest`, `tsc`, `eslint`, `next build`) or a package-manager script
invocation (`pnpm test`, `npm run build`). Mentioning a word is not running it.

Fifteen real commands are asserted, including run #6's exact one. This is a
convergence control rather than a security boundary (ADR 0033), so the question
it answers is "what did this command do", not "what could a hostile caller
disguise".

## 2. An ordinary second edit was recorded as a repair

Run #6 wrote `src/app/layout.tsx`, then `src/app/app/layout.tsx`, and recorded
`repair_cycles: 1`. Nothing had failed. One counter was being asked to mean both
"the completion window reset" and "the agent fixed something it got wrong".

The budget semantics were right — any mutation resets the window, because an
agent still changing files has not finished — but a number that overstates
convergence trouble is one a reader acts on.

```
completion_windows   mutations after the first. Each bought back a window.
repair_cycles        of those, the ones that answered an observed failure.
```

Each now bounds its own thing: `maxCompletionWindows` stops
edit → explore → edit → explore, and `maxRepairCycles` stops an agent that keeps
failing. The repair branch is checked first, so an agent genuinely answering
failures is bounded by its repair allowance rather than by the window backstop.

LOW: 4 windows, 2 repairs. Run #6 used one window and no repairs.

## Both proved against the real SDK

Two new canaries: run #6's exact shape replayed (expects `completion_windows: 1`,
`repair_cycles: 0`, `verification_commands: 0`), and a command exiting non-zero
followed by an edit (expects `repair_cycles: 1`). Sixteen canary tests total,
zero provider cost.

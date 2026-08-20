# AGENT VERIFICATION & COMPLETION — Part A inventory

What actually made Run #4 spend 4m58s of a 6m28s run repeating the independent
validator's work. Read out of the code and the run's own durable records before
anything was changed.

## The measured problem

| | Run #4 (`415fdbb6`) |
| --- | --- |
| Total agent runtime | 6m 28s |
| Reading, thinking, editing | ~1m 22s |
| `pnpm typecheck` | ~89.9s |
| `pnpm test` (4,933 tests) | ~90.6s |
| `pnpm build` | ~118.0s |
| **Self-checks** | **~4m 58s — 77% of the run** |

Then independent validation ran `install 14.1s / typecheck 89.7s / test 88.7s /
build 115.0s` against the prepared branch. The same three commands, twice,
~5 minutes each time. All three passed first time in the agent, so the 4m58s
found nothing.

## Why those three commands ran — the control path

| Link | Where | What it actually does |
| --- | --- | --- |
| 1. Which checks exist | `execution.ts` → `provisionSandboxStep` | `availableChecks` is derived from **discovered project scripts** via `planValidationSteps({packageManager, scripts})` → `["typecheck","test","build"]` |
| 2. The agent is told about them | `prompt.ts` → `systemPrompt` | `- At most ${limits.maxCheckRuns} check runs (typecheck, test, build).` — the names are interpolated straight into the system prompt |
| 3. The agent is told to run them | `prompt.ts` → `systemPrompt` | *"When you have made the change, run the checks and fix what they find. Repeat until they pass or until you are out of budget."* |
| 4. Which command string | **the model** | `pnpm typecheck 2>&1 \| tail -60` was composed by the agent. Nothing in Vibe produced that string |
| 5. What stops it | **nothing** | see below |

### The enforcement gap, precisely

`ExecutionToolGateway.runCheck` does enforce `maxCheckRuns` — and **nothing calls
it**. Under the ADR 0029 sandbox topology the harness runs inside the VM with the
SDK's own tools and never calls back to Vibe's gateway. Run #4's durable proof:

```
tool_calls_allowed  0
tool_calls_denied   0
files_read          0
check_runs          0        ← while the agent ran three checks
repair_attempts     0
```

The `run_check` tool descriptor in `prompt.ts` describes a tool the agent does
not have. What it has is `Bash`, allowed wholesale:

```ts
// sandbox-runtime/protocol.ts
export const AGENT_RUNTIME_TOOLS = ["Read", "Write", "Edit", "Glob", "Grep", "Bash"];

// sandbox-runtime/program.ts
canUseTool: async (name) => allowed.has(name) ? { behavior: "allow" } : { behavior: "deny", ... }
```

`canUseTool` decides on the tool **name** alone. Every `Bash` invocation is
allowed whatever it runs.

**Answer to PART A:** the checks came from *prompt wording plus model
discretion*, over a check list derived from discovered project scripts, with
**zero runtime enforcement**. There is no separate validation/check policy for
the agent, and the one ceiling that exists is enforced on a code path that no
longer runs.

## What already exists, and must not be duplicated

| Question | Answer | Where |
| --- | --- | --- |
| Are command categories already recorded? | **Yes** — a closed vocabulary: `install`, `typecheck`, `test`, `build`, `lint`, `format`, `read`, `search`, `git`, `other` | `observability/events.ts` → `classifyCommand` |
| Can commands be allowed/denied by category? | **No.** `classifyCommand` runs server-side *after the fact*, for the timeline only | — |
| Is there an enforcement point for `Bash`? | **Yes, unused.** The SDK's `CanUseTool` is `(toolName, input, options)`. `input.command` is inspectable, and a deny carries a `message` the model reads. Verified against the installed `sdk.d.ts`, not recalled | `program.ts` |
| Does the agent have a notion of "done"? | **No.** The prompt ends *"Then stop."* Nothing structured says when | `prompt.ts` |
| Does a risk classification exist? | **Yes** — `ExecutionSpec.riskClass` ∈ `low\|moderate\|high\|prohibited`, derived by `classifyExecutionRisk` from **structured fields only** (`changeKind`, `evidenceIds`), never prose | `execution-contract/risk.ts` |
| Do plan/spec carry validation hints? | `spec.validation.sandboxSteps` = the **independent** validator's steps. Nothing describes agent self-checking | `validation-requirements.ts` |
| Can Execution Context supply this without a second source of truth? | **Yes** — it already compiles server-side from the immutable spec at execution time. The plan is compiled beside the brief | `execution-context/` |

## The three findings that shape the design

**1. `riskClass` alone cannot separate these tasks.** Every agentic step is
`changeKind: product_change`, and `classifyExecutionRisk` returns `moderate` for
all of them unless they cite a financial or security surface. Robots metadata and
a multi-component data-flow change are both `moderate`. Risk answers *"how bad if
carried out badly"*; verification effort asks *"how likely is an implementation
mistake and how cheaply is it detectable"*. Related, not the same question.

**2. The evidence-id namespace is the trusted signal that does separate them,
and it is already load-bearing.** `risk.ts` reads `step.evidenceIds` and explains
why that is safe: the ids are minted by Vibe's own deterministic detectors and
the planner is validated to cite only ids that exist in the pack — *"a model can
choose which of our ids to cite; it cannot invent one."* The robots step cites
exactly one:

```
step 4  product_change  "Add robots meta directives…"   ["live.seo.robots_meta_missing"]
```

and its siblings in the same plan cite `live.seo.canonical_missing`,
`live.seo.open_graph_missing`, `live.seo.structured_data_missing`. `live.seo.*`
is minted from the live analyzer's closed `seoSignals` set — deterministic, not
prose. So the classifier reads the **same two fields `risk.ts` reads**, adds a
third named id family beside the `FINANCIAL_SURFACES` / `SECURITY_SURFACES`
constants that already live there, and introduces no parallel policy layer.

**3. Enforcement belongs in the harness, and it is a convergence control, not a
security boundary.** The only place a `Bash` command can be refused is inside
`AGENT_RUNTIME_PROGRAM`, which is Vibe-authored, versioned and asserted against
by tests. It bounds what the *model* chooses to spend. It is explicitly **not** a
defence against a hostile repository — that remains `verifyCandidateChange`,
independent validation and human approval, all unchanged. Saying so plainly
matters more than the enforcement itself.

## Decisions taken from this inventory

- **No new risk engine.** `classifyAgentVerification` sits beside
  `classifyExecutionRisk`, reads the same structured input, and `riskClass` acts
  as a floor that can only raise the mode, never lower it.
- **Categories, not command strings.** The plan allows and forbids
  `CommandCategory` values, reusing the closed vocabulary the timeline already
  records. One source of truth, shipped into the VM as data.
- **Enforced in the harness via `canUseTool`,** with a refusal the agent can read
  and Vibe can observe — never a silent block.
- **The independent Validation Sandbox is not touched.** One controlled variable.

---

# What was built

| File | What it is |
| --- | --- |
| `execution-context/verification.ts` | The whole domain: modes, profiles, the evidence-keyed classifier, `decideVerificationCommand`, bounded escalation, the sandbox policy, the prompt rendering |
| `execution-context/service.ts` | `loadAgentVerificationPlan` — compiled beside the Execution Brief from the plan step the spec names |
| `coding-agent/sandbox-runtime/program.ts` | `canUseTool(name, input)` — the only place a shell command exists before it runs |
| `coding-agent/observability/events.ts` | `COMMAND_CATEGORY_RULES` as data, so one table classifies commands in both places |
| `coding-agent/prompt.ts` | `agent-prompt-v3`: a completion contract instead of "until you are out of budget" |

Plus five event types, seven nullable columns on `agent_execution_runs`, an
`afterLastEdit` split in run economics, and an Agent-verification group in
Developer Details.

## The three profiles

| | LOW | MEDIUM | HIGH |
| --- | --- | --- | --- |
| Required | diff review | diff review | diff review, typecheck |
| Allowed | targeted test | targeted test, typecheck | everything |
| Refused | full suite, build, typecheck, lint | full suite, build | — |
| Commands | 3 | 6 | 10 |
| Wall clock | 3 min | 7 min | 15 min |
| Repair retries | 2 | 3 | 4 |

## The plan compiled for the benchmark step

Structured input, read out of `action_plan_steps` — the step's *words* are not
an input:

```
changeKind    product_change
evidenceIds   ["live.seo.robots_meta_missing"]
riskClass     moderate
```

Compiled plan:

```
mode                        low
requiredChecks              diff_review
allowedChecks               targeted_test
forbiddenChecks             full_test, build, typecheck, lint
maxVerificationCommands     3
maxVerificationWallClockMs  180000
maxRepairRetries            2
rationale                   Every cited signal is presentational, so a diff
                            review is the useful check.
```

What the agent is told (Vibe's own words, unfenced):

```
Before you stop, do exactly this and no more:

- Required: review every file you changed, in full
- Allowed if it would tell you something: one test that covers what you changed

Do not run: the whole test suite; a production build; a project typecheck; a lint run.
These are refused by the runtime, so attempting one costs you a turn and changes nothing.

At most 3 check commands, and at most 180 seconds of checking in total.

After you stop, Vibe validates the change independently and from scratch — a fresh
install, a full typecheck, the whole test suite and a production build, in its own
isolated machine. That is the verdict, and running those yourself does not make it
come out better. What your own checks are for is catching your own mistakes while
you can still fix them.
```

## What is enforced versus what is asked

| | Mechanism | Real? |
| --- | --- | --- |
| Which checks may run | `canUseTool` inspects `input.command` in the harness and denies | **Enforced** — against the model |
| Command count, wall clock | Counters inside the harness | **Enforced** — against the model |
| When to stop | Prompt wording | Asked |
| Reading its own diff | Prompt wording | Asked — there is no command to intercept |
| Escalation | `escalateVerification`, against a counted condition | **Enforced** — no tool to request it |
| Whether the change is safe | `verifyCandidateChange`, independent validation, human approval | **Unchanged** |

The harness is Vibe-authored, versioned and asserted against by tests, but it
runs inside the customer's VM. It bounds what the *model* spends; it is not a
defence against a hostile repository, and this document does not claim it is.

## Gate

Typecheck clean, **4,978 unit tests**, **304 E2E**, eslint 0 errors, `next build`
green. The emitted harness program is syntax-checked with `node --check` and
guarded by a new test against the escape-eating bug this sprint hit (a `\b`
written once instead of twice becomes a literal backspace and ships a program
whose regex no longer parses). Migration deployed through the Supabase MCP with
the remote history inspected first (rule 30) and the ledger reconciled to the
filename (rule 34).

## Run #5 benchmark plan

Not run. Same step, project, model, context system, budgets, candidate policy
and independent validation profile. Only agent verification changes.

| | Run #4 | Run #5 target |
| --- | --- | --- |
| Agent duration | 6m 28s | 2–4 min |
| Provider calls | 13 | materially below 13 |
| Provider cost | $0.2272 | materially below |
| Full builds by the agent | 1 | **0** |
| Full-suite tests by the agent | 1 | **0** |
| Prepared change | 2 files, correct | unchanged |
| Independent validation | authoritative | **unchanged** |

Every row is a column on `agent_execution_runs`, so the comparison is a query.

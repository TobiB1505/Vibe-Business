# What two tools can hold, and two names that must agree

**Recorded 2026-09-02, after the work.** The first half of the audit's [Phase 5](../audits/2026-09-01-performance-code-health/README.md). Four commits, no migration, no product change.

Phase 5 is "structural refactorings with a performance bearing", and its two headline items — generated Supabase `Database` types across ninety-four casts, and splitting a 2,757-line file — are each a sprint of their own. **Neither is in this one**, and the reason is in the last section rather than implied by its absence.

What is here is the half that makes the other half safer to attempt: the checks that will notice when it goes wrong.

## Twenty-two warnings, and twenty of them deliberate

`no-unused-vars` was a warning, and warnings accumulate. Twenty of the twenty-two were parameters a signature requires and a body has no use for — `useActionState`'s `previous` and `formData`, the second argument `@supabase/ssr` hands a cookie writer, the arguments of a mock that only counts its calls. Every one already carried the leading underscore that conventionally means *on purpose*, and nothing was reading it.

**Honouring the convention is what makes the rule worth raising.** With the deliberate ones silent, a warning is a finding again rather than something to scroll past, so it now fails the build. Three symbols were genuinely unused and are gone.

`noUnusedLocals` and `noUnusedParameters` put the compiler on the same question, and it found five more that ESLint does not reach — **including two parameters that made a signature lie**. `crossCheckSignedInProduct` took the live snapshot and read nothing from it; the caller already derives the two booleans it uses. `topOf` took a `Page` and asked the locator instead. Neither is a bug, and both told a reader something untrue about what the function looks at.

## Two constants that must agree and cannot be shared

`agentExecutionWorkflow` polls every twenty seconds. `workflowEventCount` derives how many Workflow events a run produced by dividing its measured wall clock by that same twenty seconds — so the second is a claim *about* the first. Change the interval alone and every cost figure the economy module reports is wrong by the ratio, silently, with the whole suite green. Those figures are what `margin-guard.ts` checks a price against.

They cannot be one constant, and both rules that prevent it are right: `economy/` may not import `operations/`, and nothing outside `economy/` may import `workflow-invocation-cost.ts`. The cost model must not reach into the execution path, and the execution path must not read a number that would eventually authorize something. **A shared module would be a third place readable from both — the same hole with an extra file in it.**

So the agreement is asserted instead, by reading the two files as text. Importing either from the test is exactly what the two rules forbid, and a test that had to be exempted from them would be worth less than the drift it catches.

The second assertion is not about the right value, which the workflow's own docblock argues. It catches a unit slip: a plausible `20` or `20_000_000` would keep the equality true on both sides and make every event count absurd.

## Two functions named `sleep`

Four files had written the same one-line `sleep` — a crawl's politeness delay, a compare-and-swap backoff, a provider poll, and the default a bounded fetch uses between retries. Consolidating four identical lines is not worth a commit on its own.

**The fifth is.** `import { sleep } from "workflow"` is a different function with the same name and the opposite cost model: it suspends a durable run, so the step returns and the function stops being billed. The shared one holds the process open.

Swapping them is not a type error and breaks no test. The blocking one inside a `"use workflow"` body keeps a Node function alive through every poll of a run that may last twenty-five minutes — a real invoice for time spent doing nothing, invisible in every check a change goes through. So the shared file documents the pair and a test asserts both directions.

## Three copies of one security decision

Validation, change preview and review capture had each written `describeError` byte for byte, with its own docblock giving the same reason: a provider error carries request context, headers and occasionally credentials, so the object is never stored and its name and message are. **Identical code carrying a security rationale is the shape where one copy quietly stops matching the others.**

The shared version adds the two things a reader reaching for it needs. It does not bound the length, and says so — every caller sanitizes or truncates, because how much of a failure is worth keeping is a decision each failure path makes. And **it does not apply to a Supabase error**: on postgrest-js's default path the rejected value is the parsed body, a plain object, so `instanceof Error` never matches and this returns "non-error value thrown" for every database failure. [`founder-input/server-writes.ts`](../../src/modules/operations/founder-input/server-writes.ts) records what that cost the one time it was written that way — a guard against committing over an unreleased Credit hold told the founder "try again" when waiting was the only thing that worked.

The agent adapter's own version stays: it normalises whitespace, bounds to 400 and falls back to the name alone on an empty message. A different function that happens to share a purpose.

## A test file that would not have run

`vitest` matched `src/**/*.test.ts`. No `.test.tsx` exists, so nothing changed today — but a test file the runner does not match is indistinguishable from one that passes: no output, no failure, and no count anybody would miss. A component test would be the first written as `.tsx`. The environment stays `node`, so it will fail loudly for want of a DOM rather than quietly for want of a match.

## Verification

`pnpm lint` **0 errors and 0 warnings**, down from 22 · `pnpm typecheck` clean with two new compiler checks · `pnpm test` **7,294 tests in 421 files green** · `pnpm build` green.

Three of the four new guards were checked by planting what they exist to catch: an unused name without the underscore, one side of the poll interval changed, and the blocking `sleep` imported into the agent workflow. Each failed, and only the intended assertion failed.

**No E2E run** — the same container limitation as the last three sprints, and `e2e/needs-user.spec.ts` was edited here (an unused `Page` parameter removed from a local helper), so that file in particular has not been executed against this change.

## What Phase 5 still owes

Both of these were deliberately not started, because starting either badly is worse than not starting it.

- **Generated Supabase `Database` types**, replacing ninety-four `as unknown as` casts concentrated in eight store files. The audit's own note is the reason for care: type generation *moves* existing row types — a generated column is nullable where a hand-written one was not, and JSONB arrives as `Json` rather than the shape a store asserts. Every one of those disagreements is a judgement about which side was right, and there is no version of this that is mechanical.
- **Splitting `agent-execution/execution.ts`**, 2,757 lines with at least five responsibilities. It is the file this session has already changed twice, and a split is a diff where every line moves — which makes it the worst possible thing to combine with a behavioural change, and the reason it waits for a sprint that does nothing else.

## What has not been proved

- **That the compiler flags catch anything in future code.** They found five things today; whether they keep earning their place depends on code not yet written.
- **That `describeThrown`'s caveat is heeded.** Nothing enforces that a Supabase failure does not reach it — the docblock is the whole defence, exactly as it was when the same mistake was made and recorded once already.

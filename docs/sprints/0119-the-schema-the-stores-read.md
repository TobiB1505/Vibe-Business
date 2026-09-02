# The schema the stores read

**Recorded 2026-09-02, after the work.** The second half of the audit's [Phase 5](../audits/2026-09-01-performance-code-health/README.md), continuing [0118](0118-what-two-tools-can-hold.md). Two commits, no migration, no product change.

## What was actually wrong

Seven stores declared `type Row = Record<string, unknown>` and cast every read to it through `as unknown as`. That pair of casts turns checking off completely: the compiler verified neither that a column exists nor that it holds what the mapper reads it as.

**A renamed column passed `tsc` and failed at runtime** — the defect a migration is most likely to introduce, in the one place nothing would catch it.

`Row` now derives from the generated schema, so each mapper is checked against the database it reads. Verified by renaming `business_goal` in the generated types and watching `mapPlan` stop compiling.

## The count did not go down, and that is the right outcome

The audit framed this as replacing ninety-four `as unknown as` casts. **It replaced none of them.** One survives at each read, and `src/types/README.md` says why:

postgrest-js narrows a query result by parsing the **literal** select string at the type level. These stores pass a shared runtime constant — a multi-line concatenation of column names, reused by several queries — which the parser cannot resolve, so the result keeps `GenericStringError` in its union and no direct cast is accepted. Typing the client as `SupabaseClient<Database>` changes nothing; that was tried, and the errors were identical.

Removing the last cast would mean inlining every select as a literal, trading one shared column list per table for several copies that can disagree. That is a worse trade than the cast.

So the hop is unchecked and everything after it is checked. **The number was never the point; the mapper was.**

The narrowing casts inside the mappers stay too. The generated type says `status: string` because the column is `text`, and what narrows it to a closed set is a CHECK constraint a generator cannot see.

## The generated file

`src/types/database.ts` comes from `pnpm db:types` and is committed rather than built, so `pnpm typecheck` stays reproducible without a database — which is what lets CI run it with no secrets at all.

It was generated against the linked project **after confirming its 99 applied migrations match the 99 files**, so it describes the migrations rather than a drifted database (rule 34). It is in `.prettierignore`, because formatting a generated file makes the next regeneration a diff.

`src/types/README.md` is back, this time describing something that exists. [Sprint 0117](0117-the-code-nothing-calls.md) deleted its predecessor for claiming "Sprint 0 status: empty, no business tables exist yet" beside 99 migrations, and said Phase 5 could recreate the directory when there was something to put in it.

## The one that was not the same defect

`coding-agent/store.ts` was counted with the other seven and is not like them. It declares its row shapes in full, and **checked column by column against the live schema they are correct** — no phantom column, no nullability disagreement.

They are also better than a derived row in one way: declaring `status: AgentRunStatus` makes a status nobody defined a compile error, where a derived row would make it a string. Replacing them would have deleted that.

So it holds the agreement instead, as a type-level assertion `pnpm typecheck` enforces. Two columns are deliberately not the generated type, and both are named with the argument rather than skipped:

- **`post_edit_provider_cost_usd`** is `numeric(12,6)`, which the generator maps to `number` — a claim that the value always fits a JS number, which is exactly what `numeric` exists not to promise. The declared `string | number | null` makes no such claim, and the mapper calls `Number()` either way. **The generated type is the optimistic one here.**
- **`response_schema`** is `jsonb`, so the generator says `Json`, while the declared type is the discriminated union actually stored. Narrower, and not assignable to `Json` only because TypeScript will not give a union of object literals an implicit index signature — a property of the checker, not a disagreement about the data.

## The guard that passed twice before it worked

Worth recording, because both wrong versions looked like passing checks.

The first annotated an empty array with the union of unknown columns: `const x: NoUnknownColumns<A, B>[] = []`. **`[]` satisfies `"anything"[]`**, so a planted rename produced no error at all.

The second used `T extends never ? true : …`. The naked form distributes over a union, and distributing over a non-empty union still reaches `never` — so it passed exactly when it should have failed.

The one that shipped is `[T] extends [never]`, and it was verified by renaming a column and reading the column's own name back out of the compiler error.

## Verification

`pnpm lint` 0/0 · `pnpm typecheck` clean · `pnpm test` **7,297 tests in 423 files green** · `pnpm build` green.

Three planted defects, each caught: a renamed column in a converted store, a renamed column in the hand-written rows, and the two guard versions above that did not catch it.

**No E2E run** — the same container limitation as the last four sprints. Nothing here touches a rendered screen.

## What Phase 5 still owes

**Splitting `agent-execution/execution.ts`**, 2,757 lines with at least five responsibilities. Still deliberately unstarted, and the reason has only got stronger: this session has now changed that file three times. A split is a diff where every line moves, which makes it the worst possible thing to combine with a behavioural change — so it waits for a sprint that does nothing else.

## What has not been proved

- **That the generated types match the schema a migration will produce next.** They match the database as it stands today. Nothing regenerates them automatically, and nothing fails if somebody writes a migration and forgets — the guard catches a *rename* through a column the code reads, not a schema that has moved on in a way no store touches yet.
- **That the remaining boundary cast is the last word.** It is the best available given how selects are written here. A future change that made column lists literal would remove it, and nothing currently pushes in that direction.

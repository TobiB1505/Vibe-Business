# types

`database.ts` is generated. Do not edit it.

```bash
pnpm db:types    # supabase gen types typescript --linked > src/types/database.ts
```

Regenerate it in the same change as the migration that moved the schema. It is
committed rather than generated at build time so that `pnpm typecheck` is
reproducible without a database, which is what lets CI run it with no secrets
at all.

## What it is for

Every store used to declare `type Row = Record<string, unknown>` and cast each
read to it through `as unknown as`. That pair of casts turns checking off
completely: the compiler verified neither that a column exists nor that it
holds what the mapper reads it as, so **a renamed column passed `tsc` and
failed at runtime** — the defect a migration is most likely to introduce, in
the one place nothing would catch it.

With the generated shape the mapper is checked. Rename `business_goal` in a
migration, regenerate, and `mapPlan` stops compiling.

## The cast that remains, and why

One `as unknown as` survives at each read, where the client hands the row over:

```ts
return data ? mapRow(data as unknown as Row) : null;
```

postgrest-js narrows a query result by parsing the **literal** select string at
the type level. These stores pass a shared runtime constant — a multi-line
concatenation of column names, reused by several queries — which the parser
cannot resolve, so the result keeps `GenericStringError` in its union and no
direct cast is accepted. Typing the client as `SupabaseClient<Database>`
changes nothing about that; it was tried.

So the hop stays unchecked and everything after it is checked. Removing the
last cast would mean inlining every select as a literal, which trades one
shared column list per table for several copies that can disagree — a worse
trade than the cast.

## What the generated types do not say

That `status` is one of a closed set. The database column is `text` with a
CHECK constraint, and a constraint is not visible to the generator, so the
narrowing casts in each mapper (`row.status as MergeStatus`) stay and remain
the place that claim is made.

## Where it does not apply

`coding-agent/store.ts` declares its own row shapes rather than deriving them.
That is unconverted, deliberately: reconciling a hand-written shape against the
generated one is a judgement per column about which of the two was right, not a
substitution.

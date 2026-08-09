# types

Shared TypeScript types that cross module boundaries (e.g. a generated Supabase `Database` type once real tables exist).

**Sprint 0 status:** empty. No business tables exist yet ([ARCHITECTURE.md §7](../../ARCHITECTURE.md#7-deferred--open-decisions) item 4), so there is no schema to generate types from. Module-local types (e.g. `Session` in `src/modules/auth/session.ts`) live next to the code that defines them until/unless they need to be shared.

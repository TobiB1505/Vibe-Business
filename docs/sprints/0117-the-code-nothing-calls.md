# The code nothing calls, and the one line that reported to nobody

**Recorded 2026-09-02, after the work.** The audit's [Phase 4](../audits/2026-09-01-performance-code-health/README.md), taken after [phases 1–3](0116-the-queries-and-the-wait.md) merged and deployed. Five commits, 206 deletions, no migration, no product change.

Dead-code removal is the part of an audit most likely to be done badly, because "no references" is a claim about a search rather than about the code. Every candidate below was re-checked against the repository as it is now — the register was written at `f1dc651` and `main` has moved twice since — and **three of the audit's own entries did not survive that check**.

## What the register got wrong

**DEAD-004 and DEAD-005 are not dead code.** The register's own evidence column says it: *"0 references outside the file"*. That is a claim about an export, not about a function. `textActionClasses` is called on the next line but one; `HomeIcon` and `ExperimentsIcon` are reached through the icon map in their own file; the three fixture helpers each have callers in the test-support module that defines them. Deleting any of them would have broken the build, which is the cheap failure — the expensive one would have been deleting the two icons, whose only caller is a lookup table a grep for the identifier does find but a reader skimming the diff would not.

What was true is that ten exports were unnecessary. Five became file-local. The icon library was left alone: `HomeIcon` and `ExperimentsIcon` are two of thirty-seven icons in a set built to be uniform, and un-exporting two of them makes the file harder to read, not easier. Same for the fixture modules.

**DEAD-006 is not safe to remove.** Four brand assets with no code references — except `public/brand/README.md` describes them as *canonical* and says "these files are the source", which makes them a deliberate library rather than leftovers. And `public/email/vibe-mark.png` is named for a channel this repository does not contain: Vibe sends no email, so its auth mail templates live in Supabase's dashboard, and a template there referencing `https://vibebusiness.de/email/vibe-mark.png` is exactly the reference a repository-wide grep cannot see. A `public/` file is addressable by anything on the internet; "no references in this repository" is not the same claim as "no references".

## What was removed

**A component, four test helpers, and three UI exports.** `business-map-preview.tsx` was the landing page's proof section until the redesign; its only remaining mention was a comment saying nothing imported it. Four `__reset*ForTests` helpers existed so a test could clear a module cache and no test ever did — the kind of export that looks load-bearing precisely because of its name. `hasSupabaseServiceRoleKey` answered a question nobody asked. `CloseIcon` is in neither the icon map nor any component; `creditPriceLabel` rendered a price as prose for a sentence nobody wrote; `CategoryChip` named a taxonomy no screen shows.

`RatingChip`'s docblock defined itself against `CategoryChip`, so that contrast is now drawn against the idea rather than against a component that no longer exists. A comment that names a deleted symbol is the same defect as a README that describes a directory it no longer matches.

**A stub README that was false.** `src/types/` held one file, and that file said *"Sprint 0 status: empty. No business tables exist yet"* beside 99 migrations. Its citation had rotted too — the ARCHITECTURE item it points at as number 4 is about production hosting. `documentation-currency.test.ts` already argues that a README written to fill a gap is not documentation and that asserting their presence would bless the stubs rather than retire them; this is the retirement. Phase 5's generated `Database` types can create the directory when there is something to put in it.

**Two package pins for versions that cannot be installed.** `minimumReleaseAgeExclude` listed `workflow@4.8.2` and `@workflow/core@4.8.2`; `package.json` pins 4.8.5. Verified with `pnpm install --frozen-lockfile`, which still reports the lockfile passing supply-chain policies.

The rest of that list is deliberately untouched, and the reason is worth recording because it is an argument *against* a bigger cleanup: nine of its entries are framework adapters this project does not install at all, and `minimumReleaseAge` itself is unset here — so the whole block may be inert. But `@vercel/sandbox@3.2.0` is installed at exactly the excluded version, and stripping a supply-chain list on a hunch about a package manager's defaults is not a cleanup.

## The one with a consequence

**A failed harness install reported to nobody, with the customer's output in it.** `execution.ts` ended the "the agent harness could not be installed" path in a bare `console.error` carrying two thousand characters of the install's output.

Both halves are defects. On Vercel a `console.error` is a line in a stream nobody watches, which is the precise failure [`alert.ts`](../../src/lib/observability/alert.ts) was written to end — and a sandbox that cannot be prepared is squarely one of its cases, so this never became an issue with a count or a first-seen. And the detail is untrusted repository output (rule 18): the tail of a command run inside the customer's own tree, printing whatever their install printed.

Sentry's `beforeSend` would have scrubbed it on the way out. **The local log line is the one `beforeSend` never sees**, which is why the redaction now happens before the value is handed over rather than after.

The detail is still passed rather than reduced to an exit code. Without any of it an operator cannot tell a registry timeout from a missing binary, and that distinction is the only reason to report this at all.

## Two things kept, and now findable

The audit listed `premium-ui.json` and the two screenshot scripts as removal candidates, which is what anything undocumented looks like from outside. Both are in use and neither had a `package.json` entry or a mention anywhere, so finding them required already knowing they existed. They are named in [README.md](../../README.md) now, and the screenshots run as `pnpm screenshots:uis1` / `:uis2`.

`premium-audit.json` — the same tool's *output*, with zero findings and an absolute path from the machine that produced it — is deleted and gitignored.

## Verification

`pnpm lint` 0 errors and 22 pre-existing warnings, `pnpm typecheck` clean, `pnpm test` **7,288 tests in 420 files green**, and `pnpm install --frozen-lockfile` for the package change.

The three new tests were each checked by putting the old `console.error` back: the alert stops happening, the credential reappears, and the output stops being bounded.

**No E2E run**, the same container limitation as the last two sprints. Nothing here touches a rendered screen except the deleted `CategoryChip`, which no screen used.

## What this deliberately did not do

- **DEAD-009 and DEAD-010** — one start path with no callers but an open question against it (VB-052), and roughly sixty orphaned domain functions the register itself says must be verified **individually**, several of which are the only typed read path for a table. That is a slice with its own argument per function, not a sweep.
- **DEAD-014** — dropping a redundant index needs a migration and a deploy, which does not belong in a commit about deleting unused exports.
- **DEAD-015** — 83 unused-index advisor hits against a 23 MB database. The audit's own instruction is to re-check in six months with traffic; absence of scans at this volume is not evidence.
- **The other sixty-odd `console.*` sites.** PERF-022's second half is a judgement about which conditions should wake a person, made per site. This closed the one carrying untrusted content.

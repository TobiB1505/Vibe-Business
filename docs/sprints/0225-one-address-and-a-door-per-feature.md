# Sprint 0225 — One address, and a door per feature

Slice 3 of [ADR 0109](../decisions/0109-nova-first-application-shell.md): thirty
Server Actions leave the routing layer for the features that own them, the
project URL gets one owner instead of twelve, and the boundary register empties
and is deleted. Two latent defects surfaced on the way and are fixed. Nothing a
founder sees changes; no address changes.

## What was wrong

Three things, all of them the same shape: a fact with more than one home.

**Commands lived in the routing layer.** Twenty-five `"use server"` modules sat
under `src/app/app/projects/[projectId]/`, five more under the account and
connect routes. That is where the onboarding route decided whether an operation
was free or charged, and where an Agent action built its redirect out of a
layout component. Rule 86 says a route file is an access gate and a
composition; nothing enforced it, because a direction check cannot see what a
file *is*.

**`/app/projects/${id}` was built from parts in twelve files.** The audit found
three owners of the *builder*; the grep found twelve literal constructions,
including one in a domain module that publishes hrefs. Only one was tested.

**`revalidatePath("/app/profile")`** had been pointing at a redirect since
[ADR 0104](../decisions/0104-the-account-level-is-settings.md) moved the account
pages. A redirect source has no cached render to invalidate, so a founder who
changed their name kept seeing the old one until something else refreshed the
page. Lint did not fail, `tsc` did not fail, and nine thousand tests did not
fail, because a string that looks like a path is a valid string.

## What changed, and why that shape

**Thirty commands moved into `features/<x>/commands/`** — agent (11), plan (5),
product (3), project-settings (3), health (2), founder-input (1), onboarding
(1), account (3), connect (1). Each file moved whole and unedited.

`src/lib/consistency/feature-boundaries.test.ts` now asserts that **no
`"use server"` module lives under `src/app`**, with two named exemptions: the
internal operator console, which is its own surface with its own decision
([ADR 0088](../decisions/0088-the-internal-operator-console.md)) and no feature
to belong to, and the design-studies action inside the fixture route, which
refuses to exist in production at all. Mutation-tested: adding an action back
under a route fails the suite.

**`src/lib/routing/project-urls.ts` is the one owner.** `projectPath`,
`projectSectionPath` and the prepared-change anchor pair. `project-shell.tsx`
keeps the section *table* — a section has a label and an icon, and those are
presentation — and takes the arithmetic from lib; `attention.ts`,
`nova-home-actions.ts` and ten other sites now build a project address the same
way. ADR 0058's `?plan=`, `?change=` and `#planned-work` deliberately did
**not** move: they belong with the sanitiser that reads them back, and
splitting a contract from its own validator is how the two stop agreeing.

**The register is empty and deleted.** `StatusTone` moved to `src/lib/ui/tone.ts`
and `score-display.ts` to `src/lib/ui/`, which closed the last two
`modules → components` edges. `TRANSITIONAL_CROSSINGS` ships as `[]`: no file
under `src/features`, `src/modules`, `src/components` or `src/lib` imports from
a layer above it, anywhere, with no exception available.

**One guard had to change meaning rather than pass.** The walk asserted
`CROSSINGS.length > 0` — right while the register was full, and a demand for a
violation the moment it emptied. It counts resolved in-`src` imports instead,
which proves the resolver works without requiring something to be wrong.

**`revalidate-targets.test.ts`** asserts that every literal `revalidatePath`
target names a route file on disk, and that none of them names an address that
only redirects. Mutation-tested against the original defect: restoring
`/app/profile` fails both assertions.

## What the move surfaced

**`/app` could have redirected to `/app/projects/null`.** `resolveLastVisited`
returns `string | null`, and the destination was built by interpolating it into
a template literal — where a null becomes the four characters `null`. The guard
above it means the branch is unreachable today, so this was latent rather than
live. Routing the URL through `projectPath` made the type visible, and the
branch now redirects to onboarding, which is the honest answer to having no
product and the same answer the guard above gives.

**`REVIEWED_SITES` is keyed by file path.** Moving the billing and repository
actions moved two entries in the service-role allowlist — rule 53's enforcement
record. The paths were updated and nothing was added: the same two callers, the
same two reasons, the same review.

## What was decided against

- **A `commands.ts` barrel per feature.** The audit named one. A barrel that
  re-exports server actions is an extra hop with a real cost: a client
  component importing it pulls the whole feature's server graph into the build.
  The directory is the door, and `@/features/agent/commands/merge-actions` says
  more than `@/features/agent/commands` did.
- **Splitting `prepare-change-action.ts`.** It holds a plan command and an
  agent query. Splitting it is a refactor, not a move, and this slice moved
  things. It is in `features/plan/commands/` and the Agent imports it —
  `features → features` is ordinary.
- **Moving `internal/actions.ts`.** The operator console is a separate surface
  under its own ADR, cross-tenant and reachable by nobody unless an environment
  variable names them. It has no feature and inventing one to satisfy a rule
  would be the wrong direction.

## What has not been proved

- **Nothing was opened in a browser.** Files changed address; two behaviours
  changed, both on paths a founder cannot currently reach: the `/app`
  null-branch redirect and the profile revalidation. Neither has been seen
  working in a browser, and the second is exactly the kind of thing only a
  browser shows.
- **`getOperationStatusAction` still lives in `features/health/commands/`** and
  is polled by the plan, Nova and onboarding. Watching an operation is not
  Business Health's business; the honest home is a small shared surface, and
  the slice that needs one can make it. Named here rather than left to be
  discovered.
- **Node 22 ran the suite; the engine field says 24.**

## Validation

- `pnpm lint` — clean.
- `pnpm typecheck` — clean.
- `pnpm test` — 543 files, 9,567 tests, all passing (542 / 9,561 before; the
  difference is the three revalidate-target assertions, the two Server Action
  assertions and the replaced walk guard).
- Mutation-tested: the Server Action rule, both revalidate-target assertions.
- `pnpm test:e2e` — not run; see above.

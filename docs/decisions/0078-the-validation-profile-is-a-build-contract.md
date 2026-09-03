# 0078 - The validation profile is a build contract, not a framework list

Status: Accepted; amended by [0079](0079-the-founder-names-the-application.md) — which application, when a repository holds more than one; and by [0080](0080-the-probe-that-could-not-fail.md) — Vite has a row, and the health probe can now fail for the reason that held it back
Date: 2026-09-03

Supersedes the *Validation profile* section of [Sprint 0010](../sprints/0010-isolated-change-validation.md), which recorded one profile, `nextjs_node_v1`, eligible on "Next.js detected, npm or pnpm, unambiguous single-app workspace, lockfile present". Changes no command, no network policy, no secret handling and no merge rule. Amended by [0079](0079-the-founder-names-the-application.md), which answers the one question this contract cannot answer alone.

## Context

Sprint 0010's reasoning was right and is kept: *a profile is a promise that these exact commands, in this exact environment, mean this exact thing*, and refusing is the feature. What was wrong was the key.

**The framework check changed no command.** `planValidationSteps` takes `{ packageManager, scripts }` and no profile. It plans a locked install and then the repository's own `typecheck`, `test` and `build` scripts, re-read from the sandbox filesystem in each phase. `nextjs_node_v1` never ran `next build`; it ran `pnpm run build`. So the eligibility rule narrowed *which repositories could be checked* without sharpening *what the check claimed* — the two things a profile exists to hold together.

That cost more than coverage, because `resolveExecutionValidation` asks the same function. A repository the profile would not admit is a repository the coding agent cannot run against at all. Of four repositories connected to this product, one qualified.

And the gate was not merely narrow, it was **wrong in the permissive direction** on a real project. `planner-agent` declares `nextjs` from `frontend/package.json`, has no root manifest, and reports `monorepo.detected: false`. The resolver returned `supported` with `workspaceRoot: "."`. A run would have paid for a microVM and failed in `readPlan`, after the money.

The framework-wide union is what made that possible: `frameworks` on the snapshot is repo-wide, so a Next.js application three directories down makes the whole repository read as a Next.js repository.

## Decision

**`node_build_v1` admits an application, not a repository, and it is keyed on what the commands need.** One manifest declaring a `build` script, and a lockfile **in that manifest's own directory** whose package manager Vibe can install from exactly.

`repository-intelligence/detectors/build-targets.ts` supplies the evidence: per-manifest `frameworks` (never the repo-wide union), the nearest lockfile with `inTargetDirectory`, `declaresWorkspaces`, and Yarn's `moduleLinker`. Bounded at 25 targets with `truncated` (rule 27), and `ANALYZER_VERSION` moves to `repo-intelligence-v5`.

The resolver decides in order, and every branch but the last is a refusal that names the missing thing:

| Condition | Reason |
|---|---|
| no `build` intelligence on the snapshot | `repository_analysis_outdated` |
| no targets | `not_a_node_project` |
| targets, none with a `build` script | `no_build_script` |
| buildable, no lockfile in its own directory | `lockfile_missing` |
| a lockfile Vibe cannot honour exactly | `package_manager_unsupported` |
| more than one installable application | `workspace_choice_required` — see [0079](0079-the-founder-names-the-application.md) |
| exactly one | supported |

`monorepo.detected` stops being a refusal reason. The honest question was never "is this a monorepo" but "how many independently installable applications are there", and that is now asked directly.

### `nextjs_node_v1` stays legal and resolves to nothing

Sixteen rows carry it. The value stays in the union and in the CHECK, and no code path produces it any more. **There is no alias and no equivalence table**: reading a stored `nextjs_node_v1` as `node_build_v1` is precisely what rule 65 forbids, because that row was checked under the old rules. The cost is the reuse of sixteen historical runs — at most ≈$0.26–1.03, and absorbed anyway by the policy bump below.

### Two things enter the identity, one does not

**The workspace root does.** `validation_runs.workspace_root` is recorded (`not null default '.'`, which is the truth for every existing row rather than a placeholder), and `computeValidationIdentity` hashes it. Without that, a pass for `apps/a` would answer the question about `apps/b` at the same commit — and "this commit validated" was never the claim.

**The install commands do**, via `SANDBOX_POLICY_VERSION` → `sandbox-policy-v6`: the set of authorized install commands grew, and `registry.yarnpkg.com` joined `DEPENDENCY_HOSTS`. `policyDigest()` hashes both, and a fourth digest line is added rather than the three existing ones being edited.

**Wider admission does not.** A stored `passed` is a statement about a transcript — these commands, this network, this commit, exit zero. Admission answers a different question before any command exists. Were it part of the claim, every widening of coverage would retroactively weaken every earlier run.

### Package managers, and the one refused by name

`pnpm`, `npm`, `yarn_berry`, `bun`, each with an exact locked install and no lifecycle scripts. `INSTALL_COMMANDS` and `SCRIPT_RUNNERS` are exhaustive `Record`s, so a new member is a compiler error rather than a silent `npm ci` in a Bun repository.

**Yarn Classic is refused, deliberately.** Yarn 1's `--frozen-lockfile` does not reliably fail when `package.json` has gained a dependency the lockfile does not know — which is verbatim the hazard `commands.ts` already cited as the reason to exclude Yarn. It is detected as `yarn.lock` **without** `.yarnrc.yml` and refused as `package_manager_unsupported`, naming Yarn 3+ as the way forward. Berry under Plug'n'Play validates normally (`yarn run build` resolves through `.pnp.cjs`) and is excluded from *previews* only, because PnP has no `node_modules/.bin/` for a framework binary to be invoked from.

**Berry and PnP are detected by file existence, never by content.** `.yarnrc.yml` can carry `npmAuthToken`, and rule 28 permits observing that a credential-bearing file exists while forbidding reading it. So the distinction rests on the presence of `.yarnrc.yml` and of `.pnp.cjs` — a derived fact, no fetch, no YAML parser, no configuration copy in the process.

### The preview stops being derived from the profile

Framework knowledge is load-bearing in exactly one place: the preview, where Vibe issues the dev-server command itself. `PREVIEWABLE_VALIDATION_PROFILES` and `previewProfileFor(validationProfile)` are gone — that exhaustive `Record` *was* the coupling — replaced by an ordered table in `change-preview/dev-servers.ts` keyed on the chosen application's own frameworks, most specific first (a Next.js app also declares `react`; SvelteKit also declares `vite`). `next dev`, `nuxt dev`, `astro dev`; everything else is `null`, and `null` means **checking and merging still work, there is simply nothing to look at** — stated in the copy, not only in the type. `PREVIEW_POLICY_VERSION` → v3.

Vite has no row yet, and that is a decision rather than an omission: Vite ≥ 5.4.12 and Astro 5 refuse requests whose `Host` is not in `server.allowedHosts`, and the health probe reaches the server over loopback — so it *passes* while the customer's public URL answers "Blocked request." A real preview against a real Vite project settles it; an argument does not.

## Consequences

**A repository is now refused for a reason its owner can act on**, and refused for free. The rule *what Vibe cannot check, Vibe does not build* is not new — `orchestrator.ts` and `change-validation/execution.ts` both already refused, but only after a microVM had been provisioned and the source verified. This moves an existing refusal from ~$0.016–0.064 and 5.5 minutes to free and immediate.

**Repository intelligence now carries a fact the validator depends on.** `build` is optional on the snapshot because a document written by an older analyzer does not have it, and its absence is `repository_analysis_outdated` rather than a crash. The v5 bump makes every stored snapshot stale once; rule 60 forbids Vibe from starting the re-analysis itself, so each project needs one founder-initiated refresh before anything runs, and the screen says so concretely.

**A deliberate narrowing comes with it.** A workspace monorepo — one lockfile at the root, applications in `apps/*` — has zero installable targets and is refused as `lockfile_missing`. `npm ci` from a subdirectory fails, and `pnpm install --frozen-lockfile` installs the *entire* workspace, which is a larger promise made without saying so. `inTargetDirectory` is recorded anyway, so the decision to make that promise later can be made on data.

**Something is given up in coverage of a different kind.** Deterministic capabilities remain Next.js-only, so a Vite repository is now agent-eligible with *zero* free deterministic capabilities — SEO work there goes to the paid agent rather than to the free generator. Named here rather than discovered later.

**Nothing about a stored pass changes.** No historical row was rewritten, no profile was renamed, and every version that guards a claim moved in the same commit as the claim it guards.

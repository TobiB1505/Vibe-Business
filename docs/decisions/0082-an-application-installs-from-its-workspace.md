# 0082 - An application inside a declared workspace installs from the workspace root

Status: Accepted
Date: 2026-09-03

Amends [0078](0078-the-validation-profile-is-a-build-contract.md), which recorded the opposite as a deliberate narrowing. Changes no command, no network policy, no write policy and no approval rule.

## Context

ADR 0078 replaced a framework whitelist with a build contract: a manifest declaring `build`, and a lockfile Vibe can install from exactly. It admitted one shape, and said so:

> A deliberate narrowing comes with it. A workspace monorepo — one lockfile at the root, applications in `apps/*` — has zero installable targets and is refused as `lockfile_missing`. `npm ci` from a subdirectory fails, and `pnpm install --frozen-lockfile` installs the *entire* workspace, which is a larger promise made without saying so. `inTargetDirectory` is recorded anyway, so the decision to make that promise later can be made on data.

Both halves of that argument are still true. What has changed is that the promise can now be *said* rather than avoided, because the two directories are separate values that reach the transcript, the row and the identity.

**The narrowing is also narrower than 0078 stated.** A workspace whose root manifest declares a `build` script — the usual Turborepo shape, `turbo run build` — is *not* refused today: the root is a target, its lockfile is its own, and it resolves to `workspaceRoot: "."`. What is refused is the workspace whose root has no `build` script, which is the other common shape, and the founder who wants Vibe to work on one application rather than build all of them.

## Decision

**An application whose lockfile belongs to a declared workspace root above it is installable, and the install runs there.**

`installRoot` and `workspaceRoot` become two values on one run:

| | install | typecheck · test · build |
|---|---|---|
| own lockfile | its own directory | the same directory |
| workspace member | the workspace root | the application |

Three consequences follow, and each is a constraint rather than a detail.

**`installRoot` joins the validation identity, and is stored beside `workspace_root`.** The same application installed from its own directory and installed from a workspace root are two different dependency trees. A pass under one must not answer for the other, and a pass that does not record where it installed does not say what it checked.

**A declaration counts only where it is one.** `declaresWorkspaces` was true for any directory holding a `pnpm-workspace.yaml`, and pnpm 10 keeps `overrides`, `patchedDependencies` and `allowBuilds` in that file — so a single-package repository pinning one transitive dependency declared a workspace it did not have. *This repository is one of those.* While nothing read the field that was inert; deciding where an install runs is not inert, so the field now reads the file's `packages:` key (`ANALYZER_VERSION` v7).

**More applications become a question rather than an answer.** A workspace with two members, or a root that builds beside a member that builds, has more than one installable application — so it resolves to `workspace_choice_required` and the founder names one. That is the honest resolution, and it gives the choice screen ADR 0079 built its first real cases. A repository that silently validated its whole workspace now asks once, and the answer persists per project.

## What this does not do

**No preview.** A preview invokes the framework binary by path, and where a workspace install puts that binary differs by package manager: pnpm links it beside the application, npm and bun hoist it to the root. Vibe would be guessing, and a wrong guess is a founder who confirmed a public URL for a server that never starts. Held as `preview_workspace_unsupported` until a dogfood settles it — the same posture [0080](0080-the-probe-that-could-not-fail.md) took, and for the same reason. Validation and merge are unaffected: both go through the package manager, which resolves its own binaries.

**No workspace-aware install command.** Install is the same `--frozen-lockfile` in a different directory. `pnpm --filter` and `npm --workspace` would install less, and choosing them would be a second decision about what "installed" means.

## Two defects this surfaced, both fixed here

**The lockfile went unverified.** Build-identity files were compared relative to `workspaceRoot`, lockfiles among them. For an application inside a workspace the lockfile is at the install root, so it was absent on both sides — and absent on both sides is treated as agreement and skipped. The one file that decides which code gets installed would have gone unchecked with nothing saying so. Lockfiles are now followed to the install root.

**The credential scrub verified the wrong directory.** `rm -rf .git` ran in the application and the verification then read the application's `.git/config` back. A clone puts `.git` at the clone root, so for any application in a subdirectory the removal cleared nothing and the check confirmed the absence of a file that was never going to be there — while the credential store sat above it. Rule 63 asks for absence to be verified rather than assumed, and a check aimed at the wrong path is an assumption in a check's clothes.

That one reached HEAD with 0078, when `workspaceRoot` stopped always being `"."`. It has never been exercised: every run recorded to date is a single-application repository at the root, where the two paths are the same one. Both roots are now cleared and both read back, and `SANDBOX_POLICY_VERSION` moves to v7 because secret handling is part of what a pass was checked against (rule 65).

## Consequences

- A workspace monorepo can be validated, and the agent can run in one of its applications.
- Every stored validation identity moves, because `installRoot` joined the hash. No stored pass is reinterpreted; each is simply not reused.
- Every repository snapshot is stale once more (`ANALYZER_VERSION` v7). Rule 60 keeps the re-scan the founder's to start.
- A workspace application has no preview until the binary question is answered with evidence rather than recall.

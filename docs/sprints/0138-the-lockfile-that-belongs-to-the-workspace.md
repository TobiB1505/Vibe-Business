# 0138 — The lockfile that belongs to the workspace

Date: 2026-09-03
Branch: `claude/agent-preview-diff-logic-sxj5uc`
Decision: [ADR 0082](../decisions/0082-an-application-installs-from-its-workspace.md), amending [0078](../decisions/0078-the-validation-profile-is-a-build-contract.md)

## What this was for

The founder asked which programming language would reach the most of the world's sites and apps — Python, Java, something else. The answer from reading the code was: **none of them.**

The agent can already write any language; Claude Code in a sandbox is not the constraint. What Vibe cannot do is *check* the result, and the Node contract works because `package.json` has a `scripts` block — a standardised place where a project states how to build and test itself. Python has no equivalent (pytest? tox? nox? make?), so a Python contract would have to guess, which is the one thing the build contract exists not to do. Java is *better* standardised than Python here — `mvn verify`, `gradle build` — and reaches almost no founder's customer-facing product.

And the reach question answers itself against Vibe's own shape. Vibe works on web surfaces: SEO, conversion, pricing pages. A FastAPI or Java backend has none. `Jandia-Arena` proves it in the founder's own account — it *has* Python, and the website half is React, which is the half Vibe would touch. WordPress carries roughly 43% of the web and is unreachable for a different reason: those sites live in an admin panel, not in a Git repository with a branch, a check and a merge.

What is actually missing is in JavaScript, and it is the shape most serious JS products now have: **a workspace monorepo.**

## The narrowing, and how narrow it really was

ADR 0078 refused it and said so plainly — one lockfile at the root, applications in `apps/*`, zero installable targets, `lockfile_missing`. Reading the resolver rather than the ADR narrowed the claim: a workspace whose **root manifest declares `build`** already resolves today, as `workspaceRoot: "."`, and builds everything. That is the usual Turborepo shape and it was never refused.

What is refused is the workspace whose root has no `build` script — build is per package — and the founder who wants Vibe on one application rather than on all of them.

## Shipped

`installRoot` and `workspaceRoot` are two values on one run:

| | install | typecheck · test · build |
|---|---|---|
| own lockfile | its own directory | the same directory |
| workspace member | the workspace root | the application |

Both are stored on `validation_runs`, both are hashed into the validation identity, and both are pinned onto the execution spec so a founder answering "which app?" mid-run cannot move one without the other (rule 67). The install commands are unchanged — the same `--frozen-lockfile` in a different directory.

## Three things the work found that were not the work

**A test of mine was vacuous, and the reason was a wrong idea.** `workspaceRootsIn` required a further manifest below a declaring directory, on the argument that a declaration alone over-claims. Deliberately breaking the implementation proved the condition was true every time it was evaluated: the set is consulted only for an application whose lockfile is an ancestor's, and such an application *is* a manifest below that ancestor. Dead code with a false rationale is worse than no code, so it is gone — and the over-claim is fixed where it lives instead.

**`declaresWorkspaces` over-claimed, and this repository is the proof.** It was true for any directory holding a `pnpm-workspace.yaml`, and pnpm 10 keeps `overrides`, `patchedDependencies` and `allowBuilds` in that file. Vibe-Business has one and is a single package. While nothing read the field that was inert; deciding where an install runs is not. It now reads the file's `packages:` key — one line-anchored regex, no YAML parser, no file text leaving the context — and `ANALYZER_VERSION` moves to v7.

**The credential scrub verified the wrong directory, and had since Stufe 4.** `rm -rf .git` ran in the application and the check then read the application's `.git/config` back. A clone puts `.git` at the clone root, so for any application in a subdirectory the removal cleared nothing and the verification confirmed the absence of a file that was never going to be there — a control reporting success by construction, against rule 63's "verified rather than assumed". Both roots are cleared and both read back now. **Never exercised**: all sixteen stored runs are `workspace_root = '.'`, read from the database rather than assumed. `SANDBOX_POLICY_VERSION` → v7, because secret handling is part of what a pass was checked against.

A fourth, found the same way: build-identity files were compared relative to `workspaceRoot`, lockfiles among them. For a workspace application the lockfile is at the install root, so it was absent on both sides — and absent on both sides is treated as agreement and skipped. The one file that decides which code gets installed would have gone unchecked with nothing saying so.

## Verified by breaking it

Every fix was checked by reverting it and watching a named test fail — the practice that caught the vacuous test in the first place.

| planted | caught by |
| --- | --- |
| workspace roots always empty | three resolver cases |
| a declaration without `packages:` counts | two detector cases |
| install back in the application | "installs at the workspace root and builds in the application" |
| lockfile integrity back under the application | "looks for the lockfile where it would install" |
| credential scrub back at the workspace only | "clears the credential store at the clone root" |
| the member condition removed | **nothing — which is why it was removed** |

## What this does not do

**No preview for a workspace application.** A preview invokes the framework binary by path, and where a workspace install puts it differs by package manager: pnpm links it beside the application, npm and bun hoist it to the root. Vibe would be guessing, and a wrong guess is a founder who confirmed a public URL for a server that never starts — the exact failure [Sprint 0137](0137-the-offer-that-could-not-be-kept.md) closed one day ago. Held as its own availability reason and its own panel state, with its own browser scene, rather than folded into the framework sentence. Checking and merging are unaffected.

**Nothing has run.** No workspace repository has been validated, because none of the founder's four is one. This is admission logic proved against fixtures and a real PostgreSQL, and it waits on a repository that has the shape.

**Every snapshot is stale again** — the third round. Rule 60 keeps the re-scan the founder's, and three of the four projects were already due one.

## Verified

Domain 7,725 across 446 files · SQL 323 · browser 498 · typecheck, lint 0/0, build green. Migration applied through the linked project and verified by reading the column, its default and its CHECK predicate back from the catalog — never from the apply response — and the local filename converged to the stamped version (rule 34).

**One thing found and not touched.** The remote database carries a migration this repository has no file for, on any branch: `20260903180738 nova_first_run`, applied today at 18:07 UTC, adding two columns and two constraints to `project_onboarding`. It is not this branch's work and not any branch's work. Reported to the founder rather than reverted — a rollback is a destructive change to production and is theirs to authorise — and the generated database types were **not** regenerated, because doing so would have pulled those columns into the repository and blessed the drift silently. `install_root` was added to `src/types/database.ts` by hand for that reason.

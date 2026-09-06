# 0079 - The founder names the application, from a closed list Vibe computed

Status: Accepted
Date: 2026-09-03

Amends [0078](0078-the-validation-profile-is-a-build-contract.md), which admits an application rather than a repository and therefore has to say *which one*. Grants no new authority: the answer routes, and every gate that decided before still decides.

## Context

Once the profile is keyed on an application, a repository holding two independently installable applications has no single answer to "which app did Vibe just build?" Three options existed.

Picking the first is a guess reported as a verdict — the exact failure 0078 exists to remove, reintroduced one layer down. Refusing outright is what the old gate did, and it means a legitimate repository can never run the agent. So Vibe asks.

Asking is cheap and the question is small, but its answer is not: a workspace root becomes **the directory a sandbox runs a customer's build in**. That is the constraint everything below follows from.

## Decision

**Vibe computes a closed list of candidates; the founder picks one from it; nothing else can become an answer.**

### The answer is selected, never constructed

`selectValidationTarget(resolution, chosenWorkspaceRoot)` matches by **exact string equality** against the candidates the resolver derived from the current snapshot. It does not join, normalize, resolve, trim or repair a path — every one of those is a way for a value that is not a candidate to become one.

So `"../secrets"` is refused **because it is not on the list**, not because a pattern caught it. The list came from build targets derived from tree entries Vibe read itself; nothing a founder submits can add to it. The path shape is checked as well — in the resolver, and again by a CHECK constraint in the database — and neither of those is what makes this safe. The tests assert the mechanism, not only the outcome.

### The stored answer routes; it never permits

A stored root that is no longer a candidate — the application was deleted, renamed, or restructured — **asks again**. Reaching for the nearest surviving candidate would run against something nobody chose. That is rule 55 applied to a stored answer rather than to stored evidence.

`chooseWorkspaceRoot` re-derives the candidate list immediately before the write rather than trusting the list the screen rendered, which may be minutes old and assembled from a snapshot since replaced. And it refuses to record an answer to a question that was never asked: for a repository Vibe resolves on its own the result is `no_choice_to_make`, because a root stored there would silently answer the question the day a second application appears.

### A column, not `founder_input_requests`

Three reasons, and the first is the load-bearing one:

1. That table is the pipe for planner-authored, open-ended business content with free text. A workspace root is a path Vibe `cd`s into, and rule 57 leaves less room for paths than for prose.
2. Its CHECK constraints require an action plan or an execution interrupt. A project setup question has neither.
3. A founder-input resolution is an immutable decision record with a supersession chain; this is a setting a founder should be able to change without one.

`repository_connections.workspace_root` and `workspace_root_chosen_at`, constrained to `.` or a relative path, with `..` excluded **explicitly** — the character class `[A-Za-z0-9._-]+` accepts two dots quite happily — and both columns present or both null, so a root can never be mistaken for a default.

### Who may write it: a column-level grant, not a definer function

`authenticated` holds no table-level UPDATE on `repository_connections`, withdrawn on purpose: the row's RLS update policy lets an owner set *any* column, so a granted UPDATE would let a caller write `detached_at` over PostgREST and walk past the detach gate.

The obvious way back in is a `SECURITY DEFINER` setter. It is the wrong way. `lifecycle-authority.migration.ts` asserts that **no** definer function in `public` is reachable by `anon` or `authenticated`, and records why the two that once were are gone rather than grandfathered. An exception here would spend that assertion on a problem PostgreSQL already solves: `grant update (workspace_root, workspace_root_chosen_at)` says the narrow thing, the existing policy still decides which rows, and `detached_at` stays denied at the privilege layer where it was denied before.

### The screen offers buttons and no field

One submit control per candidate; the directory travels as a bound argument rather than as form data. Not because that is what makes it safe — the server re-derives and matches either way — but because there is then no field for anything else to arrive in. A browser test asserts the **absence** of `input`, `textarea` and `[contenteditable]`, because an absence is only an absence once something has looked.

Choosing is free, reversible and starts nothing. A screen whose subject is what Vibe is about to do is the worst possible place for a control that quietly begins a priced run, and the notice says so.

## Consequences

**A repository with two applications becomes usable**, and the question is asked exactly where it blocks: on the Agent screen, in the place the start control would otherwise be, and only when nothing else is on offer. A screen showing both a Build button and a question about which app to build would be asking about the run it was simultaneously offering to start.

**The answer is now part of what a pass means.** It reaches `validation_runs.workspace_root`, the validation identity, the execution spec's repository binding, and the review classifier's path patterns — which anchored at the repository root and, for an application in a subdirectory, matched nothing at all, classifying every change as `code` and never asking for a preview while every test stayed green. `REVIEW_CLASSIFICATION_VERSION` → v4.

**One thing this deliberately does not do.** A repository where nothing is installable still refuses, and the founder cannot override that by naming a directory. The list is the boundary in both directions: it is what a founder chooses from, and it is also everything they can choose.

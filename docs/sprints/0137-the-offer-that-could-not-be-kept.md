# 0137 — The offer that could not be kept

Date: 2026-09-03
Branch: `claude/agent-preview-diff-logic-sxj5uc`

## What this was for

No ADR. Nothing is decided here that was not already decided; what changes is *when* an existing refusal is spoken.

`buildPreviewCard`'s entire precondition was one boolean:

> A commit to serve is the whole precondition. A preview no longer waits for validation — that is the point of it (Sprint 0114).

That is true and it is not sufficient. `previewProfileFor` returns `null` for an application whose frameworks have no development-server row, and `startPreview` turns that `null` into `preview_not_supported` — **after** the founder has pressed **Start temporary preview** and confirmed, in a dialog, that Vibe may publish an unlisted public URL serving their application.

So the panel offered, the founder agreed to a consequence, and Vibe then said no. The confirmation is load-bearing on the server rather than a courtesy — that is written into `service.ts` and it is the reason this ordering is wrong rather than merely untidy. Asking a person to accept a consequence on behalf of something that cannot happen spends the one piece of deliberate attention the product asks them for, on nothing.

## Why it became reachable now

Stufe 4 widened admission from single-app Next.js to every Node build contract. Before it, nearly every admitted project had a dev-server row by construction: the gate and the table were the same list. Afterwards a Vite project, a project with no framework Vibe starts, or a Yarn Berry PnP workspace can all pass admission and reach a prepared change with no server to run.

## Two reasons, not a boolean

The first implementation was a boolean — *is there a server for this framework* — and it was complete and green before it was thrown away. It conflates two things that a founder acts on differently:

- **`no_dev_server`** is a fact about the framework. Nothing the founder does today changes it.
- **`repository_not_ready`** is a fact about Vibe's *read* of the repository — an analysis older than this check, a lockfile missing beside the application, an unanswered question about which app. Every one of those has a move, and the free scan is the move for most of them.

Under the boolean, a founder whose framework was fine would have read "Vibe does not know how to start a development server for this project's framework" and gone looking for a fault that is not there. That is the same class of falsehood Stufe 6 had just finished repairing on the plan screen, one screen over, and it would have been introduced by the change that repaired it.

So `PreviewAvailability` is a three-valued answer and the panel has two states rather than one. The `repository_not_ready` copy points at **My Product** and says the scan is free; the `no_dev_server` copy says checking and merging still work, because a founder told only "no preview" would reasonably assume they had lost those too.

## Where it is resolved

Once per list, in `execution/workspace.ts`, beside the project's production origin and its lifecycles. It reads the repository snapshot, and `workspace.test.ts` asserts that reads do not grow with the number of prepared changes — the constraint that caught the workspace root the last time a project-level fact was resolved per card.

The single-change path asks the same function, and the batching test asks it rather than asserting a constant, so the list and the detail screen cannot come to disagree about what can be offered.

## The order of the checks is the design

The availability check sits **after** the terminal-session branches, deliberately. A session that ran is a fact. A repository that later loses its server — a framework removed, an application restructured — does not make the session that already ran stop having run. Only the *offer* is withdrawn, and there is a test that says so.

## A flake, root-caused rather than re-run

Adding a spec file changed worker scheduling and exposed a pre-existing race in `auth.spec.ts` — reproducible at roughly one run in four under `--repeat-each`. Two distinct causes, both real:

1. `waitForHydration` waited on the **button**. React's form interception lives on the `<form>`, so there was a window in which the button was hydrated and the form was not, and a click in that window was still a native POST that left the page. It now waits for a *function* in the form's React props, which an unhydrated form (carrying a string `action` attribute) cannot have.

2. The Google test held the Supabase URL open to keep the hand-off observable. That stops the browser leaving but leaves a **navigation pending**, which is precisely the state in which Playwright cannot resolve a locator: the first assertion ran before the redirect was issued and the second waited out its timeout against a document on its way somewhere — reported as a missing button that was on the screen the whole time. Both tests now hold the server-action POST instead, which is the state under test rather than something downstream of it.

Verified at `--repeat-each=10`: 250/250.

## Verified

Domain 7,712 · SQL 312 · browser 496 (5 new) · lint 0/0 · build green. No migration, no version bump, no new authority — `preview_not_supported` already existed as a failure code, and nothing about what a stored preview session *means* changes.

## What this does not do

It does not give the `no_dev_server` founder a way forward, because there is not one to give: the honest answer is that Vibe does not start that framework yet. And it does not add a Vite row — that remains where Stufe 4 left it, behind a real dogfood of the host gate.

*[Corrected 2026-09-03, the same day it was written.]* The second sentence was **false when written**. `vite_dev_v1` shipped in [Sprint 0134](0134-the-probe-that-could-not-fail.md), last in the table, alongside the host-gate probe and `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS` — the row was not held back, the *dogfood* was, and I collapsed the two. The correct sentence is that no Vite preview has yet started in a real sandbox, which is Sprint 0134's own open item and not something this change touches. The original stands above because it is what the record said.

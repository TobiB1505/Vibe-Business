# `validation`

Independent proof that a prepared change still builds — see [ARCHITECTURE.md §3.8](../../../ARCHITECTURE.md#38-build--validation-layer), [ADR 0015](../../../docs/decisions/0015-untrusted-repository-execution-provider.md) and [ADR 0078](../../../docs/decisions/0078-the-validation-profile-is-a-build-contract.md).

One run clones a pinned commit into a fresh microVM, verifies it is what Vibe prepared, destroys the credential it cloned with, closes the network, and only then runs the repository's own `typecheck`, `test` and `build`. A pass means those commands exited zero under those conditions. It means nothing else — not safe, not correct, not reviewed, not mergeable ([CLAUDE.md](../../../CLAUDE.md) rule 66).

## The two questions, kept apart

The module answers them in this order, and conflating them is the mistake it is built to avoid:

| | Question | Answered by | Depends on |
|---|---|---|---|
| **Admission** | Can Vibe make a promise about *this repository* at all? | `profile.ts` | the repository's shape |
| **Depth** | How much of that promise does *this change* deserve? | `depth.ts` | the change's risk |

Admission comes first and knows nothing about the change. Depth comes second and can only ever select a **subset of the profile's own steps** — no depth introduces a command the profile does not already define. The agent cannot influence either, which is what makes this validation *independent* rather than a second opinion from the same author.

## Layout

| File | Role |
| --- | --- |
| `profile.ts` | Admission. A build contract, not a framework list: one manifest with a `build` script and a lockfile in its own directory. Every refusal names the missing thing. |
| `workspace.ts` | Applies the founder's answer to "which app?" — by exact match against candidates Vibe computed, never by building a path. |
| `workspace-store.ts` | Reads and records that answer, re-deriving the candidates immediately before the write. |
| `depth.ts` / `depth-inputs.ts` | How many of the profile's steps this change earns, from server-minted signals only. Every uncertain case resolves upward. |
| `commands.ts` | The command table. Vibe constructs every command; nothing else may. |
| `identity.ts` | What makes two validations the same work, so a double click does not provision two microVMs. |
| `budgets.ts` | Hard ceilings on time, output and size — enforced by Vibe, never hinted to the repository. |
| `logs.ts` | Build output treated as hostile input before a byte of it is stored. |
| `orchestrator.ts` | The run itself, phase by phase. **The security boundary of this module.** |
| `sandbox-port.ts` | The provider interface the orchestrator talks to — and the reason there can be no local implementation. |
| `sandbox-files.ts` | Writing a Vibe-authored file into a sandbox with nothing on a command line to quote. |
| `vercel/provider.ts` | The only place `@vercel/sandbox` types appear. |
| `service.ts` | The entry point. Two identifiers in; everything else is re-derived from server state. |
| `store.ts` | Persistence, reuse lookup, run lifecycle. Ownership asserted in code, because durable execution bypasses RLS. |
| `view.ts` | What a run looks like while it is happening, as a pure function. |
| `schema.ts` | The versioned contract: profiles, package managers, block reasons, `SANDBOX_POLICY_VERSION`. |

## What a reader cannot get from the filenames

**The order in `orchestrator.ts` is the security design.** Commit verified, file hashes verified, `.git` destroyed, network narrowed, install with `--ignore-scripts`, network closed — and only then does the first repository-controlled command run. By the time someone else's JavaScript executes, the clone credential does not exist, the network is shut, and the environment holds nothing worth stealing. Reordering those steps would not fail a test somewhere else; it would end the guarantee.

**There is no local execution path, and its absence is deliberate.** A `SandboxProvider` that shelled out to the host would satisfy `sandbox-port.ts` perfectly and be a remote code execution vulnerability wearing a developer-experience costume. Tests use fakes that execute nothing; production uses Vercel Sandbox; an unavailable sandbox **fails** the validation rather than degrading to somewhere less isolated ([ADR 0015](../../../docs/decisions/0015-untrusted-repository-execution-provider.md), rule 61).

**Admission is not part of what a pass means.** A stored `passed` is a statement about a transcript — these commands, this network, this commit, exit zero. Widening which repositories are admitted therefore changes nothing about earlier runs, which is why `node_build_v1` could be added without reinterpreting a single one. Two things *are* part of the claim and carry versions for that reason: the install commands (`SANDBOX_POLICY_VERSION`) and **which directory was validated** (`validation_runs.workspace_root`, hashed into the identity). A pass says what passed, and where.

**A retired profile is resolved by nothing.** `nextjs_node_v1` stays legal because sixteen rows carry it, and no code path produces it. There is no alias table: reading an old pass under today's rules is exactly what a version exists to prevent (rule 65).

**Validation deliberately does not refuse on stale evidence, and preparation does.** Preparation asks *should this change exist?* — a question about now. Validation asks *does this commit build?* — a question about an artifact, and an artifact's build result does not expire because newer repository intelligence arrived. Blocking here would mean an untouched prepared change silently becoming unvalidatable while sitting still.

## Rules this module carries

- **Vibe constructs every command** (rule 57). Not a script name from the repository, not a string from a model — the *instruction* is Vibe's, even though the binary it names is the customer's.
- **No credential is ever present when repository code runs** (rules 62, 63). The clone token is destroyed and its absence verified, not assumed.
- **The network policy is part of the claim** (rule 65). Which hosts were reachable in which phase is what `SANDBOX_POLICY_VERSION` versions, so a pass is never reinterpreted under rules it was not checked against.
- **A pass authorizes nothing** (rule 66). `sandbox_validation_passed` is never rendered as safe, correct, reviewed, mergeable or production ready.

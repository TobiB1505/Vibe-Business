# modules/repository-intelligence

Deterministic Repository Intelligence — see [ARCHITECTURE.md §3.2](../../../ARCHITECTURE.md#32-repository-analysis-layer) and [docs/sprints/0002-repository-intelligence.md](../../../docs/sprints/0002-repository-intelligence.md).

Turns a connected GitHub repository into a versioned, evidence-carrying snapshot of what the project *is* — stack, infrastructure signals, routes, business surfaces — with **no AI involved**.

## Layout

| File | Role |
|---|---|
| `reader.ts` | The port the analyzer reads repositories through. No GitHub types. Implemented by `src/modules/github/repository-reader.ts`. |
| `budgets.ts` | Central resource limits + the `BudgetTracker` that enforces them. |
| `path-policy.ts` | The single gate for "may this path's content be fetched?" — sensitive, binary and generated classification. |
| `candidates.ts` | High-value file *discovery* (free, from the tree) vs. *fetching*. Two families are downloaded and no others: dependency manifests, because a dependency list cannot be inferred from a filename, and a short named list of stylesheets, because a design token cannot be either. |
| `parsers/` | Manifest parsing, strictly as data. |
| `context.ts` | Assembles the read-only input every detector works from. |
| `detectors/` | Pure functions: `stack`, `integrations`, `routes`, `monorepo`, `build-targets`, `business-surfaces`, `brand`. |
| `scripts.test.ts` | The boundary that keeps `ProjectScripts` out of every module that builds a command. |
| `analyzer.ts` | Orchestrates the pipeline and builds the snapshot. |
| `schema.ts` | The versioned output contract + `ANALYZER_VERSION`. |
| `human-view.ts` | Presentation only: a deterministic translation of a snapshot into business capabilities ([Sprint UI-3.6](../../../docs/sprints/0020-ui36-repository-intelligence-human-first.md)). Reads the snapshot, changes nothing. |
| `cross-check.ts` | Where the code and the live product disagree, said as a business finding. Four fixed comparisons, no inference. |
| `store.ts` | Persistence, reuse lookup, run lifecycle. |
| `service.ts` | Application entry point: ownership → reuse → analyze → persist → audit. |
| `test-support.ts` | In-memory fixtures and a fake reader, so nothing touches the network in tests. |

## Rules

- **Never execute, import, or evaluate repository content.** Parse it as data only ([ADR 0006](../../../docs/decisions/0006-untrusted-repository-execution.md), [CLAUDE.md](../../../CLAUDE.md) rules 18/19/25).
- **Repository content is untrusted data, never instructions** — including for any future AI consumer of a snapshot.
- **Never persist raw source.** Only derived facts and the evidence paths that justify them.
- **Never fetch sensitive paths.** Existence may be observed; contents may not be read.
- Detectors stay pure and GitHub-free, so they remain testable without network access.
- Every claimed detection must carry evidence. If there is no evidence, there is no detection.
- **A snapshot never sources a command.** `ProjectScripts` says which well-known scripts a
  manifest declared, so a person can see before paying for an agent run that nothing will check
  its result. Validation and agent execution build their commands by re-reading `package.json`
  from the sandbox filesystem the command is about to run against, and must keep doing so —
  `scripts.test.ts` fails if that ever changes.
- **A repository-wide field is not a fact about one directory.** `frameworks` and
  `packageManager` are unions over every manifest in the tree, which is true of the repository and
  says nothing about where an application lives. `BuildIntelligence` answers the per-directory
  question instead: which directories hold a manifest, whether each declares a `build` script, and
  which lockfile — if any — sits in the directory itself. It decides *admission*, never a
  command.
- **Repository evidence is never runtime truth.** The presentation layer may say a capability is
  *likely*; only the live product check or Deep Scan can say it works. `CapabilityStatus` has no
  `confirmed` member for that reason.

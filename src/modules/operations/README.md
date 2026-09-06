# modules/operations

Durable execution — see [ARCHITECTURE.md §3 "Layers with no section above"](../../../ARCHITECTURE.md#layers-with-no-section-above), [ADR 0013](../../../docs/decisions/0013-durable-operation-execution.md), [ADR 0030](../../../docs/decisions/0030-agent-execution-observability.md) and [ADR 0037](../../../docs/decisions/0037-automatic-validation-and-review-classification.md).

Everything in this product that takes tens of seconds runs here, and the reason is one sentence: **the initiating HTTP request must not own the lifecycle** (rule 49). A browser tab that closes, a serverless function that times out, a user who navigates away — none of them may decide whether an audit finishes, whether a sandbox is torn down, or whether a charge is settled.

This is also the largest module in the repository, and almost all of that size is fifteen operation families rather than one complicated mechanism. The shared machinery is the thirteen files at the root; everything else is one family's step graph.

## The two axes, which are not the same thing

`schema.ts` keeps these apart deliberately, and conflating them is the usual mistake:

```
status    lifecycle — what may still happen to this operation    6 values
stage     progress  — where the work has got to                 47 values
```

"Running" meaning both "queued somewhere" and "currently calling a provider" is precisely the distinction that decides whether a retry is safe. Both are closed sets, because a free-form status string puts UI copy, retry policy and cost safety at the mercy of a typo.

There are no percentages anywhere in this module, on purpose. A four-step pipeline whose third step takes fifty seconds has no honest percentage, and inventing one teaches users to distrust the number.

## One directory per operation family

Each family is a pair: `workflow.ts` is the step graph, `execution.ts` holds the step bodies. Nothing else in the repository names the workflow platform.

| Operation type                | Directory                                                              |
| ----------------------------- | ---------------------------------------------------------------------- |
| `business_audit`              | `business-audit/`                                                      |
| `opportunity_generation`      | `opportunities/`                                                       |
| `product_understanding`       | `product-understanding/`                                               |
| `product_scan`                | `product-scan/`                                                        |
| `action_planning`             | `action-plans/`                                                        |
| `change_preparation`          | `change-preparation/`                                                  |
| `change_validation`           | `change-validation/`                                                   |
| `change_preview`              | `change-preview/`                                                      |
| `preview_teardown`            | `change-preview/teardown-workflow.ts`                                  |
| `change_merge`                | `change-merge/`                                                        |
| `change_outcome_verification` | `change-outcome-verification/`                                         |
| `business_measurement`        | `business-measurement/`                                                |
| `agent_execution`             | `agent-execution/` — the only family split across a `steps/` directory |
| `account_erasure`             | `account-erasure/`                                                     |
| `change_review`               | **retired.** `vercel/executor.ts` maps it to a workflow that throws.   |

`change_review` is still in `OPERATION_TYPES` because historical rows, audit events and cost records name it. [ADR 0065](../../../docs/decisions/0065-the-preview-is-the-review.md) decided the preview _is_ the review, and [ADR 0075](../../../docs/decisions/0075-the-photograph-nobody-took.md) deleted the capture path. A retired type that throws on start is honest; deleting the value would make old rows unreadable.

Five directories hold no workflow of their own:

| Directory            | Purpose                                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `vercel/`            | The Vercel Workflows adapter. The one file allowed to name the platform.                                                                    |
| `project-lifecycle/` | Detaching a repository, deleting a project, and finding the work that blocks either.                                                        |
| `founder-input/`     | Resolving a founder's answer to a bounded question, which is what un-pauses a `needs_user` operation.                                       |
| `founder-action/`    | Recording a founder's attestation that they did a step themselves.                                                                          |
| `change-review/`     | Only `retention.ts` — the sweep that deletes expired review screenshots. It now runs from the preview teardown workflow, not from a review. |

## What lives at the root

| File                        | Purpose                                                                                                    |
| --------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `schema.ts`                 | The domain model: the fifteen types, six statuses and forty-seven stages, all closed sets.                 |
| `executor.ts`               | The execution boundary. Two members, one argument.                                                         |
| `store.ts`                  | Persistence for `operation_runs`, including the identity index that blocks double submission.              |
| `service.ts`                | The start-and-read API, one pair per operation family. Ownership is derived, never accepted.               |
| `billing.ts`                | The seam where a durable operation meets Credits: affordability, hold, settle, release.                    |
| `staleness.ts`              | The backstop for an operation nothing is carrying any more.                                                |
| `start-limits.ts`           | How often an operation may be _started_. Two windows: per project per hour, per account per day.           |
| `kill-switch.ts`            | `PAID_OPERATIONS_DISABLED=1` — refusing new paid starts without shipping a deploy.                         |
| `failures.ts`               | Typed failure codes, and which of them are retryable.                                                      |
| `messages.ts`               | The user-facing sentence for each failure. Copy lives here, not at the throw site.                         |
| `view.ts`                   | Deriving what a screen shows from an operation row: labels, progress steps, poll cadence, stall threshold. |
| `test-support.ts`           | `FakeDatabase` and the query recorders.                                                                    |
| `migration-test-support.ts` | Reading migration SQL, for tests that assert against the schema files.                                     |

## Four things this module is careful about

**The boundary carries an operation id and nothing else.** `executor.ts` has one method and one argument. Everything a durable run needs is already in the database, so nothing else has to cross — which is also what keeps customer evidence, prompts and secrets out of a third-party durable log (rule 52). There is no provider selection here and no second adapter; the interface exists so the domain stays callable from a test without a workflow platform, not as portability theatre.

**This is where the service-role client may be used freely.** Everywhere else in the repository it is an exception that has to be argued and recorded in `REVIEWED_SITES` in `src/lib/supabase/service-boundary.test.ts` (rule 53). It bypasses RLS, so every query made with it still filters on ownership taken from a persisted row — never from a caller's arguments.

**A paid attempt is marked before it is made.** Billing knows nothing about what an audit is, and operations know nothing about lots or expiry; three questions cross between them — can this be afforded, hold it, settle or release it. An ambiguous outcome resolves to a failed operation rather than a second charge (rule 50), and a durable retry never re-enters a billable call by default.

**Staleness is declared at a read that already exists — never by a sweeper.** `staleness.ts` generalizes the pattern `expireStaleAgentExecution` proved first: when something reads an operation's status, that read decides whether the deadline has passed. A lease, a heartbeat or a scheduler would be a second liveness mechanism competing with Vercel Workflows, which rule 24 forbids without its own ADR.

## Testing

`test-support.ts` is the largest single file here, and it is a hand-written re-implementation of the database rather than the database. It models statement atomicity honestly and does **not** serialize sequences, so it reproduces lost updates faithfully and cannot reach MVCC, `40001`, deadlocks or the livelock class. Anything that depends on a real constraint belongs in the PostgreSQL concurrency suite instead — see [ADR 0040](../../../docs/decisions/0040-ci-hosted-database-concurrency-gate.md) and the open entries in [docs/ROADMAP.md](../../../docs/ROADMAP.md).

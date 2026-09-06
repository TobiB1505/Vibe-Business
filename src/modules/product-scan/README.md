# modules/product-scan

The discovery feed a founder watches while Vibe reads their product — see [ARCHITECTURE.md §3 "Layers with no section above"](../../../ARCHITECTURE.md#layers-with-no-section-above) and [ADR 0052](../../../docs/decisions/0052-durable-product-scan-discovery-feed.md).

A product scan refreshes three sources in one durable operation: the repository, the public product, and the Product Understanding derived from both. It takes long enough that a spinner is the wrong answer, so this module turns the run into an append-only feed of things Vibe actually found.

## Every event is Vibe's own sentence

The feed is **not** a log, and it is not repository or website content passed through. `findings.ts` maps a finished snapshot onto Vibe-authored labels — "Pricing", "Sign-in", "Product logo" — chosen from closed sets in `live-product-intelligence` and `repository-intelligence`. What reaches the feed is the label and a reference id, never a README line, a page heading, a file path's contents or a model's prose (rules 25, 26, 36 and 37).

That is what makes the feed safe to render as-is: there is no field an instruction could arrive in.

## Bounded to 24 events

`PRODUCT_SCAN_EVENT_LIMIT` is 24. A scan that finds more does not write more, because the feed exists to show a founder that work is happening and what kind — not to enumerate a repository. The bound is in the schema rather than at a call site, so no writer can quietly exceed it (rule 27).

## Append-only, and keyed

Each event carries a `sequence` and an `eventKey`. The key is what makes a durable step's retry idempotent: a workflow step that runs twice appends nothing the second time. A feed that double-reported findings after an ordinary retry would be worse than no feed.

## Four phases, and "unavailable" is a real answer

```
code → public_product → understanding → finished
```

A source can end `source_ready` or `source_unavailable`, and the second is a first-class outcome rather than an error: a project with no live site, or a repository Vibe could not read within budget, still produces a complete scan. Missing evidence is never rendered as a bad result (rule 44).

## What lives here

| File              | Purpose                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------ |
| `schema.ts`       | The closed event vocabulary, the four phases, the four sources, and the 24-event bound.    |
| `findings.ts`     | Turning repository and live-product snapshots into Vibe-authored finding events.           |
| `identity.ts`     | The workflow version and the identity one scan is bound to.                                |
| `presentation.ts` | Grouping the feed for the screen that renders it.                                          |
| `store.ts`        | Append-only persistence for `product_scan_events`, and reading a scan's source references. |

The durable step graph is in [`src/modules/operations/product-scan/`](../operations/product-scan/workflow.ts).

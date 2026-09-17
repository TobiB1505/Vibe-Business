import type { CreditUnits } from "./units";

/**
 * What one change cost a founder, in the four states the ledger can be in.
 *
 * Declared here rather than beside `CostLine`, the component that renders it,
 * because `agent-workspace.ts` returns it and a domain read model may not
 * depend on where a component keeps its props (ADR 0109, rule 86). The
 * component imports it from here now, which is the direction that was always
 * correct: what a change cost is a fact about the ledger, and drawing it is a
 * separate job.
 *
 * `released` and `pending` are different from `unknown` on purpose. A released
 * hold is a fact — nothing was charged — and a pending settlement is a fact
 * about timing; `unknown` is the absence of both, and it renders nothing
 * rather than a figure nobody measured.
 */
export type ChangeCost =
  | { kind: "settled"; credits: CreditUnits }
  | { kind: "released" }
  | { kind: "pending" }
  | { kind: "unknown" };

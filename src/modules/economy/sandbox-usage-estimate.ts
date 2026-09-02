import { VERCEL_SANDBOX_RATES } from "./infrastructure-rates";
import { deriveSandboxCost, type SandboxPurpose } from "./sandbox-cost";

/**
 * The one place a sandbox row's cost estimate is computed (ADR 0073).
 *
 * ## Why this file exists rather than the arithmetic living at each writer
 *
 * Because there are two writers — validation and preview — and "what did this
 * sandbox cost" answered twice is "what did this sandbox cost" answered
 * differently the first time somebody edits one of them. Sprint 0053 already
 * paid that price once, recomputing a run's figures from a second source.
 *
 * ## Why it is an estimate and says so in its own name
 *
 * `sandbox_usage_events.provider_cost_usd` holds what the *provider* reported,
 * and Vercel reports nothing per sandbox — so the column has been null for
 * every one of Vibe's rows, correctly. What changed is not that the provider
 * started answering; it is that `VERCEL_SANDBOX_RATES` has been founder-attested
 * and `verified: true` since 2026-08-20, so a figure can be derived from
 * quantities the provider *did* report.
 *
 * That figure is a different kind of thing from a model call's cost, and it is
 * kept in different columns and under a different `cost_status` for exactly
 * that reason. Overloading `provider_cost_usd` would let an assumption be
 * summed as a measurement — the one thing `economy/cost.ts` exists to prevent.
 *
 * ## Why the vCPU count is carried out with the number
 *
 * CPU and memory both scale with it, and it is a property of the sandbox
 * *profile* rather than of the row. A profile that moves from four vCPUs to two
 * would otherwise silently restate every historical estimate — the same failure
 * `rateCardByVersion` prevents for prices, applied to the allocation.
 */

export type SandboxCostEstimate = {
  /** Null when nothing measurable was recorded. Never zero as a stand-in. */
  estimatedCostNanoUsd: number | null;
  pricingVersion: string;
  vcpus: number;
};

export type SandboxCostEstimateInput = {
  purpose: SandboxPurpose;
  /** Wall-clock lifetime of the sandbox. */
  sandboxDurationMs: number | null;
  activeCpuMs: number | null;
  outboundBytes: number | null;
  /** The allocation this sandbox actually ran under. */
  vcpus: number;
};

/**
 * Anything that is not a finite number is an absence.
 *
 * `deriveSandboxCost` tests its inputs against `null` specifically, so an
 * `undefined` arriving from a caller whose type said `number | null` slips past
 * the guard and multiplies into `NaN` — which then satisfies `known` and lands
 * in the total. A NaN in a cost column is the worst value this file could
 * produce: it is not a number, it is not a refusal, and it sums to NaN.
 *
 * Caught here rather than at each caller, because the callers are the three
 * writers and the whole point of this file is that they do not each get this
 * right separately.
 */
function measured(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function estimateSandboxCost(input: SandboxCostEstimateInput): SandboxCostEstimate {
  const breakdown = deriveSandboxCost(
    {
      purpose: input.purpose,
      wallMs: measured(input.sandboxDurationMs),
      activeCpuMs: measured(input.activeCpuMs),
      vcpus: input.vcpus,
      // Configured rather than reported: the provider does not tell Vibe how
      // many vCPUs it gave, so this is the profile's own request, which is
      // exactly what the basis vocabulary exists to distinguish.
      vcpusBasis: "derived_from_configuration",
      // One microVM per row. The creation charge is per sandbox, and this table
      // has one row per sandbox by construction.
      creations: 1,
      outboundBytes: measured(input.outboundBytes),
      // Validation and preview retain no snapshot; the teardown is what the
      // preview module's whole cleanup path exists for.
      snapshot: null,
    },
    VERCEL_SANDBOX_RATES,
  );

  return {
    // `CostTotal.complete` is carried through rather than flattened: a
    // partially measured sandbox stores no estimate at all, because a floor
    // missing its CPU term understates the bill and would read as a whole one.
    estimatedCostNanoUsd: breakdown.total.complete
      ? measured(breakdown.total.knownFloorNanoUsd)
      : null,
    pricingVersion: breakdown.pricingVersion,
    vcpus: input.vcpus,
  };
}

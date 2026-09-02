import { estimated, sumCosts, unknown, type CostAmount, type CostTotal } from "./cost";
import type { InfrastructureRateCard } from "./infrastructure-rates";

/**
 * What one sandbox cost, from its usage dimensions (Sprint 0050).
 *
 * ## The rule this file exists to enforce
 *
 * **Wall duration is not active CPU duration.** Vercel bills active CPU only
 * while the VM is doing work; an agent waiting on a provider response burns
 * wall clock and no CPU. Substituting one for the other would not be an
 * approximation — it would be the largest single line of the bill, invented.
 *
 * So `activeCpuMs` is its own input, and when it is absent the active-CPU
 * component is `unknown`. The other components — memory, creation, egress —
 * are still derived, because memory is billed on *provisioned* GB-hours over
 * wall duration and that is genuinely knowable.
 *
 * A caller that wants a number anyway asks for `fullActiveCpuUpperBound`, which
 * assumes 100% CPU utilisation and says so in its name.
 *
 * ## Where the resource shape comes from
 *
 * `vcpus` is not measured. Vibe's own sandbox provider passes
 * `SANDBOX_RESOURCES.vcpus` (4) for validation and, because agent provisioning
 * supplies no override, for the agent VM too. That is reconstructed from pinned
 * configuration rather than observed, which is why `ResourceShapeBasis` exists
 * and why nothing here calls it measured.
 */

export const RESOURCE_SHAPE_BASES = [
  /** The provider reported the shape for this specific sandbox. */
  "measured",
  /** Reconstructed from the configuration that was pinned when the run happened. */
  "derived_from_configuration",
] as const;
export type ResourceShapeBasis = (typeof RESOURCE_SHAPE_BASES)[number];

export const SANDBOX_PURPOSES = [
  "agent_execution",
  "change_validation",
  "change_preview",
  "change_review",
  /**
   * The Deep Scan's browser (ADR 0076).
   *
   * A separate purpose rather than folded into `other`, because it is the one
   * sandbox whose wall clock is mostly a person reading a login form. Its
   * shape — long, almost idle, two vCPUs — is nothing like a validation's, and
   * a cost figure grouped with those would describe neither.
   */
  "deep_scan_browser",
  "other",
] as const;
export type SandboxPurpose = (typeof SANDBOX_PURPOSES)[number];

export type SandboxUsage = {
  purpose: SandboxPurpose;
  /** Wall-clock lifetime. Billed for memory, never for CPU. */
  wallMs: number | null;
  /**
   * Provider-reported active CPU. Null when the row predates its recording —
   * which is not the same as zero, and must never be filled in from `wallMs`.
   */
  activeCpuMs: number | null;
  vcpus: number | null;
  vcpusBasis: ResourceShapeBasis;
  /** Number of sandboxes created. Almost always 1; never guessed. */
  creations: number | null;
  outboundBytes: number | null;
  /** Snapshot bytes retained, and for how long. Both or neither. */
  snapshot: { bytes: number; retainedMs: number } | null;
};

export type SandboxCostBreakdown = {
  activeCpu: CostAmount;
  memory: CostAmount;
  creation: CostAmount;
  outboundNetwork: CostAmount;
  snapshotStorage: CostAmount;
  total: CostTotal;
  /**
   * What the run would have cost if every wall-clock millisecond had been
   * 100% CPU-busy. An upper bound, never a bill.
   *
   * Null when wall duration or the vCPU count is unknown, because then even the
   * bound cannot be stated.
   */
  fullActiveCpuUpperBoundNanoUsd: number | null;
  pricingVersion: string;
  /** Carried so a reader can tell a verified rate from an unverified one. */
  pricingVerified: boolean;
};

const MS_PER_HOUR = 3_600_000;
const BYTES_PER_GB = 1_073_741_824;
const MS_PER_MONTH = 30 * 24 * MS_PER_HOUR;

function cpuHours(cpuMs: number, vcpus: number): number {
  return (cpuMs * vcpus) / MS_PER_HOUR;
}

export function deriveSandboxCost(
  usage: SandboxUsage,
  rates: InfrastructureRateCard,
): SandboxCostBreakdown {
  const gbRam = usage.vcpus === null ? null : usage.vcpus * rates.gbRamPerVcpu;

  /*
   * Active CPU. The one component that must refuse rather than approximate.
   *
   * `activeCpuMs === null` means the provider's value was never recorded for
   * this sandbox, which is true of most of Vibe's history. Zero is a legitimate
   * measured value and is priced as zero; null is not.
   */
  const activeCpu: CostAmount =
    usage.activeCpuMs === null || usage.vcpus === null
      ? unknown("not_measured")
      : estimated(
          Math.round(cpuHours(usage.activeCpuMs, usage.vcpus) * rates.activeCpuNanoUsdPerCpuHour),
        );

  /*
   * Memory is billed on provisioned GB over wall duration, so unlike CPU it
   * *is* derivable from what Vibe already stores — provided the vCPU count is
   * known, since RAM follows from it at the provider's fixed ratio.
   */
  const memory: CostAmount =
    usage.wallMs === null || gbRam === null
      ? unknown("not_measured")
      : estimated(Math.round(((usage.wallMs * gbRam) / MS_PER_HOUR) * rates.memoryNanoUsdPerGbHour));

  const creation: CostAmount =
    usage.creations === null
      ? unknown("not_measured")
      : estimated(usage.creations * rates.creationNanoUsd);

  const outboundNetwork: CostAmount =
    usage.outboundBytes === null
      ? unknown("not_measured")
      : estimated(
          Math.round((usage.outboundBytes / BYTES_PER_GB) * rates.outboundNetworkNanoUsdPerGb),
        );

  /*
   * A sandbox that took no snapshot has no snapshot cost — genuinely nothing to
   * price rather than something unknown, so it does not count against
   * completeness.
   */
  const snapshotStorage: CostAmount =
    usage.snapshot === null
      ? unknown("stage_not_run")
      : estimated(
          Math.round(
            (usage.snapshot.bytes / BYTES_PER_GB) *
              (usage.snapshot.retainedMs / MS_PER_MONTH) *
              rates.snapshotStorageNanoUsdPerGbMonth,
          ),
        );

  const fullActiveCpuUpperBoundNanoUsd =
    usage.wallMs === null || usage.vcpus === null || gbRam === null
      ? null
      : Math.round(cpuHours(usage.wallMs, usage.vcpus) * rates.activeCpuNanoUsdPerCpuHour) +
        Math.round(((usage.wallMs * gbRam) / MS_PER_HOUR) * rates.memoryNanoUsdPerGbHour) +
        (usage.creations ?? 0) * rates.creationNanoUsd;

  return {
    activeCpu,
    memory,
    creation,
    outboundNetwork,
    snapshotStorage,
    total: sumCosts([
      ["activeCpu", activeCpu],
      ["memory", memory],
      ["creation", creation],
      ["outboundNetwork", outboundNetwork],
      ["snapshotStorage", snapshotStorage],
    ]),
    fullActiveCpuUpperBoundNanoUsd,
    pricingVersion: rates.pricingVersion,
    pricingVerified: rates.verified,
  };
}

/**
 * The provenance that must travel with any stored derivation.
 *
 * A future price change must not silently restate a historical result, so an
 * analysis records which card it used and under what assumptions rather than
 * being recomputed against whatever is current.
 */
export type EconomyProvenance = {
  pricingProvider: string;
  pricingVersion: string;
  pricingObservedAt: string;
  pricingVerified: boolean;
  usageSource: string;
  vcpusBasis: ResourceShapeBasis;
  assumptions: readonly string[];
};

export function provenanceFor(
  usage: SandboxUsage,
  rates: InfrastructureRateCard,
  usageSource: string,
): EconomyProvenance {
  const assumptions: string[] = [];

  if (usage.vcpusBasis === "derived_from_configuration") {
    assumptions.push(
      `vCPU count reconstructed from pinned configuration, not reported by the provider`,
    );
  }
  if (usage.activeCpuMs === null) {
    assumptions.push("active CPU duration not recorded; the CPU component is unknown, not zero");
  }
  if (usage.creations === null) {
    assumptions.push("sandbox creation count not recorded");
  }
  assumptions.push(
    `RAM derived at ${rates.gbRamPerVcpu} GB per vCPU, the provider's documented allocation`,
  );
  if (!rates.verified) {
    assumptions.push(`rate card ${rates.pricingVersion} is ${rates.sourceKind} and unverified`);
  }

  return {
    pricingProvider: rates.provider,
    pricingVersion: rates.pricingVersion,
    pricingObservedAt: rates.observedAt,
    pricingVerified: rates.verified,
    usageSource,
    vcpusBasis: usage.vcpusBasis,
    assumptions,
  };
}

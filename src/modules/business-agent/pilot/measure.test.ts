import { describe, expect, it } from "vitest";
import { formatShapeMeasurement, measurePilotShapes } from "./measure";

/**
 * The offline half of the seam comparison — request shape, measured from the
 * real prompt, descriptors, schema and fixture. Part of `pnpm test`, so the
 * numbers ADR 0109 quotes are re-derived on every run rather than trusted.
 */
describe("request shape, measured", () => {
  const measurement = measurePilotShapes();

  it("prints the measurement so the numbers in the ADR can be checked against a run", () => {
    console.log(`\n${formatShapeMeasurement(measurement)}\n`);
    expect(measurement.seamA.toolDescriptorBytes).toBeGreaterThan(0);
  });

  it("keeps Seam B's action schema inside the strict subset", () => {
    expect(measurement.seamB.actionSchema.objectsMissingAdditionalPropertiesFalse).toBe(0);
    expect(measurement.seamB.actionSchema.optionalPropertyCount).toBe(0);
    expect(measurement.seamB.actionSchema.unionCount).toBe(0);
  });

  it("re-sends strictly more uncached bytes on Seam B than on Seam A for the same three-tool turn", () => {
    const { seamA, seamB } = measurement.representativeTurn;
    expect(seamB.uncachedBytesIfPrefixCached).toBeGreaterThan(seamA.uncachedBytesIfPrefixCached);
    // Without a cache both grow with the transcript; A's per-call payload is
    // larger only by the tool descriptors, which are the cacheable prefix.
    expect(seamA.perCallBytes.length).toBe(seamB.perCallBytes.length);
  });
});

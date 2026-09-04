import { describe, expect, it } from "vitest";
import { HISTORICAL_RUNS, type HistoricalRun } from "./historical-runs";
import { measuredRunDataset, type MeasuredRunObservation } from "./measured-runs";

/**
 * The estimator's sample stops being a constant.
 *
 * `historical-runs.ts` was read out of Supabase by a person on 2026-08-20 and
 * typed into the repository. Everything the estimator says about "comparable
 * runs" has been frozen at that morning since — while the runs themselves kept
 * being written, with around ninety observation columns each, into a table
 * nothing read back.
 */

function observation(overrides: Partial<MeasuredRunObservation> = {}): MeasuredRunObservation {
  return {
    id: "run_1",
    createdAt: "2026-09-01T10:00:00.000Z",
    title: "Add a sitemap route",
    riskClass: "moderate",
    changeKind: "product_change",
    evidenceIds: ["live.seo.sitemap_missing"],
    providerCostNanoUsd: 120_000_000,
    agentSandbox: {
      purpose: "agent_execution",
      wallMs: 240_000,
      activeCpuMs: null,
      vcpus: 4,
      vcpusBasis: "derived_from_configuration",
      creations: 1,
      outboundBytes: null,
      snapshot: null,
    },
    validationSandbox: null,
    validationAttempted: false,
    durationMs: 300_000,
    ...overrides,
  };
}

describe("the dataset behind the estimator", () => {
  it("adds a completed run to the transcribed seed", () => {
    const dataset = measuredRunDataset([observation()]);

    expect(dataset).toHaveLength(HISTORICAL_RUNS.length + 1);
    expect(dataset.at(-1)).toMatchObject({
      createdAt: "2026-09-01T10:00:00.000Z",
      changeKind: "product_change",
      riskClass: "moderate",
    });
  });

  it("keeps the seed, because the rate card is built on it", () => {
    /*
     * The transcribed runs are measured reference data, published in
     * `ECONOMY_MODEL.md` and pinned by `run-economics.test.ts`. A customer
     * running an agent must not move them, so this adds rather than replaces.
     */
    const dataset = measuredRunDataset([observation()]);

    for (const seeded of HISTORICAL_RUNS) {
      expect(dataset).toContainEqual(seeded);
    }
  });

  it("does not count a seeded run twice", () => {
    /*
     * The first thing to get right. The seed rows *are* this account's runs
     * #3–#9, so reading the database naively reports a sample twice its real
     * size — and the sentence under the Run button is a count.
     */
    const alreadySeeded = HISTORICAL_RUNS[0];
    const dataset = measuredRunDataset([observation({ createdAt: alreadySeeded.createdAt })]);

    expect(dataset).toHaveLength(HISTORICAL_RUNS.length);
  });

  it("still matches a seeded run whose timestamp was transcribed a millisecond off", () => {
    /*
     * Found by running the query against production rather than by reasoning.
     * Two of the seven transcribed timestamps are one millisecond off the rows
     * they describe — `…17:16:38.566Z` against `…565Z` — because a person
     * copied them. Exact matching double-counts exactly those two and reports
     * a larger sample than exists.
     */
    const alreadySeeded = HISTORICAL_RUNS[0];
    const oneMillisecondOff = new Date(Date.parse(alreadySeeded.createdAt) - 1).toISOString();

    expect(measuredRunDataset([observation({ createdAt: oneMillisecondOff })])).toHaveLength(
      HISTORICAL_RUNS.length,
    );
  });

  it("does not fold two genuinely different runs together", () => {
    // A second is the key, so a minute apart must stay two runs. An agent run
    // takes minutes and an account starts them serially, which is what makes
    // the second safe rather than merely convenient.
    const alreadySeeded = HISTORICAL_RUNS[0];
    const aMinuteLater = new Date(Date.parse(alreadySeeded.createdAt) + 60_000).toISOString();

    expect(measuredRunDataset([observation({ createdAt: aMinuteLater })])).toHaveLength(
      HISTORICAL_RUNS.length + 1,
    );
  });

  it("drops a run whose model spend was never recorded", () => {
    /*
     * Not a cheap run — a run whose cost is unknown. Model spend is the
     * dominant component and the only measured one, so averaging a null in as
     * zero would drag the expectation down and call it evidence (rule 44).
     */
    const dataset = measuredRunDataset([observation({ providerCostNanoUsd: null })]);

    expect(dataset).toHaveLength(HISTORICAL_RUNS.length);
  });

  it("keeps a run that was never validated, as a floor", () => {
    /*
     * An absent validation is an absence, not a zero. The run cost what it
     * cost; what is unknown is what a validation would have added, and
     * `deriveActualExecutionEconomics` already records that by dropping the
     * confidence rather than inventing a component.
     */
    const [projected] = measuredRunDataset([observation({ validationAttempted: false })]).slice(-1);

    expect(projected.economicCostFloorNanoUsd).toBeGreaterThan(0);
    expect(projected.economicCostUpperNanoUsd).toBeGreaterThanOrEqual(
      projected.economicCostFloorNanoUsd,
    );
    expect(projected.costIsPointEstimate).toBe(true);
  });

  it("numbers projected runs above the seed rather than renumbering it", () => {
    // The seed's numbers are cited in `ECONOMY_MODEL.md` and in sprint
    // records. A projection that renumbered them would make those citations
    // point at different runs on a different day.
    const highestSeeded = Math.max(...HISTORICAL_RUNS.map((run) => run.run));
    const dataset = measuredRunDataset([
      observation(),
      observation({ createdAt: "2026-09-02T10:00:00.000Z" }),
    ]);

    expect(dataset.at(-2)?.run).toBe(highestSeeded + 1);
    expect(dataset.at(-1)?.run).toBe(highestSeeded + 2);
  });

  it("says the classification was read, not reconstructed", () => {
    /*
     * The seed distinguishes `confirmed` from `limited` because some of its
     * rows were rebuilt from documents afterwards. A projected run is read
     * from the immutable execution spec it actually ran against, so it earns
     * the stronger label — and the note says why rather than asserting it.
     */
    const [projected] = measuredRunDataset([observation()]).slice(-1);

    expect(projected.classificationConfidence).toBe("confirmed");
    expect(projected.confidenceNote).toContain("execution spec");
  });

  it("is the seed alone when nothing has been completed", () => {
    const dataset: readonly HistoricalRun[] = measuredRunDataset([]);

    expect(dataset).toEqual(HISTORICAL_RUNS);
  });
});

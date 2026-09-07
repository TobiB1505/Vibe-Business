import { describe, expect, it } from "vitest";
import type { OperationRunRow } from "../shape";
import { QUEUED_TOO_LONG_MS } from "./schema";
import {
  buildConsistencyReport,
  buildStalledOperations,
  buildUnknownRateCards,
  NO_RATE_CARD,
} from "./shape";

const NOW = Date.parse("2026-09-07T20:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const KNOWN = ["retail-v1", "launch-v1"];

function run(overrides: Partial<OperationRunRow> = {}): OperationRunRow {
  return {
    id: "run-1",
    project_id: "11112222-3333-4444-5555-666677778888",
    operation_type: "business_audit",
    status: "running",
    stage: "analyzing",
    failure_code: null,
    created_at: ago(60_000),
    started_at: ago(50_000),
    completed_at: null,
    ...overrides,
  };
}

/** A stand-in for `isPastStaleDeadline`, so this file stays free of a database. */
const never = () => false;
const always = () => true;

describe("charges whose rate card no registry defines", () => {
  it("says nothing when every stamp is known", () => {
    expect(
      buildUnknownRateCards(
        [
          { rate_card_version: "launch-v1", created_at: ago(1) },
          { rate_card_version: "retail-v1", created_at: ago(2) },
        ],
        KNOWN,
      ),
    ).toEqual([]);
  });

  it("counts a stamp that names no policy", () => {
    // The real one: thirteen agent charges carrying a *budget* policy version
    // in a rate card column.
    const [finding] = buildUnknownRateCards(
      [
        { rate_card_version: "core4-dogfood-budget-v1", created_at: ago(1) },
        { rate_card_version: "core4-dogfood-budget-v1", created_at: ago(2) },
        { rate_card_version: "launch-v1", created_at: ago(3) },
      ],
      KNOWN,
    );

    expect(finding).toMatchObject({
      check: "unknown_rate_card",
      subject: "core4-dogfood-budget-v1",
      count: 2,
      detail: "not in any price policy",
    });
    // Acknowledged, because ADR 0092 deleted the book this names and the rows
    // are what that decision means.
    expect(finding.acknowledged).toBe(true);
  });

  it("counts a missing stamp as its own subject rather than dropping it", () => {
    // A charge with no version is exactly as unexplainable as one with a wrong
    // version, and silently skipping nulls is how a check learns to say
    // nothing.
    const [finding] = buildUnknownRateCards([{ rate_card_version: null, created_at: ago(1) }], KNOWN);

    expect(finding.subject).toBe(NO_RATE_CARD);
    expect(finding.detail).toBe("no version recorded");
  });

  it("treats a version the registry has never heard of as news", () => {
    const [finding] = buildUnknownRateCards(
      [{ rate_card_version: "launch-v9", created_at: ago(1) }],
      KNOWN,
    );

    expect(finding.acknowledged).toBe(false);
  });
});

describe("operations nothing is carrying", () => {
  it("reports a running operation the product's own predicate calls stale", () => {
    const [finding] = buildStalledOperations([run()], NOW, always);

    expect(finding).toMatchObject({
      check: "stalled_operation",
      subject: "business_audit",
      count: 1,
      acknowledged: false,
    });
  });

  it("reports a queued operation nothing ever started", () => {
    // The eight-day account erasure. The sweep deliberately leaves `queued`
    // alone — failing one would race a run about to start — so nothing at all
    // was watching this.
    const [finding] = buildStalledOperations(
      [
        run({
          operation_type: "account_erasure",
          status: "queued",
          started_at: null,
          created_at: ago(QUEUED_TOO_LONG_MS + 1),
        }),
      ],
      NOW,
      never,
    );

    expect(finding).toMatchObject({ check: "queued_too_long", subject: "account_erasure" });
  });

  it("leaves a freshly queued operation alone", () => {
    expect(
      buildStalledOperations(
        [run({ status: "queued", started_at: null, created_at: ago(QUEUED_TOO_LONG_MS - 1) })],
        NOW,
        never,
      ),
    ).toEqual([]);
  });

  it("never reports an operation waiting on a person", () => {
    // Waiting on a founder is not being stuck, whatever a predicate says. A
    // lunch break must not render as an incident — the same rule the in-flight
    // panel already obeys.
    expect(
      buildStalledOperations(
        [run({ status: "needs_user", started_at: ago(30 * 24 * 60 * 60 * 1000) })],
        NOW,
        always,
      ),
    ).toEqual([]);
  });

  it("groups by operation type rather than listing ids", () => {
    const findings = buildStalledOperations(
      [run({ id: "a" }), run({ id: "b" }), run({ id: "c", operation_type: "deep_scan" })],
      NOW,
      always,
    );

    expect(findings.map((entry) => [entry.subject, entry.count])).toEqual([
      ["business_audit", 2],
      ["deep_scan", 1],
    ]);
  });
});

describe("the report keeps news apart from history", () => {
  it("splits acknowledged findings out of the list that matters", () => {
    const report = buildConsistencyReport(
      [
        ...buildUnknownRateCards(
          [
            { rate_card_version: "core4-dogfood-budget-v1", created_at: ago(1) },
            { rate_card_version: "launch-v9", created_at: ago(2) },
          ],
          KNOWN,
        ),
      ],
      false,
    );

    expect(report.findings.map((entry) => entry.subject)).toEqual(["launch-v9"]);
    expect(report.acknowledged.map((entry) => entry.subject)).toEqual(["core4-dogfood-budget-v1"]);
  });

  it("carries a reached bound, so a count is read as a floor", () => {
    expect(buildConsistencyReport([], true).truncated).toBe(true);
  });
});

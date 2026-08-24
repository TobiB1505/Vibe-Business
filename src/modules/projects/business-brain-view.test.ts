import { describe, expect, it } from "vitest";
import { E2E_AUDIT_SCENARIOS } from "@/app/e2e/audit-scenarios";
import { buildBusinessBrainView } from "./business-brain-view";
import type { AuditReading } from "./score-series";

const contract = {
  schemaVersion: "schema-v1",
  auditVersion: "audit-v1",
  evidencePackVersion: "evidence-v1",
  promptVersion: "prompt-v1",
  rubricVersion: "rubric-v1",
  provider: "provider",
  model: "model",
};

function reading(score: number | null, recordedAt: string, version = "rubric-v1"): AuditReading {
  return { score, recordedAt, contract: { ...contract, rubricVersion: version } };
}

describe("buildBusinessBrainView", () => {
  it("keeps absent lens scores absent while carrying the real nine-lens graph", () => {
    const view = buildBusinessBrainView({
      audit: E2E_AUDIT_SCENARIOS["audit-synthesis"](),
      lastScanAt: "2026-08-16T09:00:00.000Z",
      auditReadings: [],
      movesByConclusion: { "blocker-1": 2 },
      moveByConclusion: {
        "blocker-1": { title: "Make pricing visible", impact: "high", effort: "medium" },
      },
    });

    expect(view?.nodes).toHaveLength(9);
    expect(view?.nodes.every((node) => node.score === null)).toBe(true);
    expect(view?.relationships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: "conversion", to: "revenue_economics" }),
      ]),
    );
    expect(view?.primaryPriority?.headline).toBe(
      "People still don't have a clear way to pay you.",
    );
    expect(view?.primaryPriority?.moveCount).toBe(2);
    expect(view?.primaryPriority?.move).toEqual({
      title: "Make pricing visible",
      impact: "high",
      effort: "medium",
    });
  });

  it("shows only a change produced by two comparable scored readings", () => {
    const audit = E2E_AUDIT_SCENARIOS["audit-synthesis"]();
    const comparable = buildBusinessBrainView({
      audit,
      lastScanAt: audit.generatedAt,
      auditReadings: [
        reading(43, "2026-08-15T09:00:00.000Z"),
        reading(48, "2026-08-16T09:00:00.000Z"),
      ],
      movesByConclusion: {},
    });
    const changedContract = buildBusinessBrainView({
      audit,
      lastScanAt: audit.generatedAt,
      auditReadings: [
        reading(43, "2026-08-15T09:00:00.000Z", "rubric-v0"),
        reading(48, "2026-08-16T09:00:00.000Z", "rubric-v1"),
      ],
      movesByConclusion: {},
    });

    expect(comparable?.recentChanges[0]).toMatchObject({ direction: "up", delta: 5 });
    expect(changedContract?.recentChanges).toEqual([]);
    expect(changedContract?.recentChangesUnavailableReason).toBe("not_comparable");
  });
});

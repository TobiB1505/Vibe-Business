import { describe, expect, it } from "vitest";
import { computeAuditInputHash } from "./store";

/**
 * Audit input identity (Sprint 4 §23, §36).
 *
 * This hash decides whether a user gets a free reused audit or pays for a
 * new inference call, so every input that can change the answer must change
 * the hash — and nothing else may.
 */

const base = {
  repositorySnapshotId: "11111111-1111-1111-1111-111111111111",
  liveSnapshotId: "22222222-2222-2222-2222-222222222222",
  businessContextHash: "a".repeat(64),
  authenticatedSnapshotId: null as string | null,
  schemaVersion: "business-readiness-audit.v1",
  auditVersion: "business-audit-v1",
  evidencePackVersion: "business-evidence.v1",
  promptVersion: "business-audit-prompt-v1",
  rubricVersion: "business-readiness-rubric-v1",
  provider: "anthropic",
  model: "claude-sonnet-5",
};

describe("computeAuditInputHash", () => {
  it("is stable for identical inputs, so an unchanged audit is reused for free", () => {
    expect(computeAuditInputHash(base)).toBe(computeAuditInputHash({ ...base }));
  });

  it("produces a sha256 hex digest", () => {
    expect(computeAuditInputHash(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([
    ["a new repository snapshot", { repositorySnapshotId: "33333333-3333-3333-3333-333333333333" }],
    ["a new live product snapshot", { liveSnapshotId: "44444444-4444-4444-4444-444444444444" }],
    ["edited business context", { businessContextHash: "b".repeat(64) }],
    ["a new prompt version", { promptVersion: "business-audit-prompt-v2" }],
    ["a new rubric version", { rubricVersion: "business-readiness-rubric-v2" }],
    ["a new evidence pack version", { evidencePackVersion: "business-evidence.v2" }],
    ["a new audit version", { auditVersion: "business-audit-v2" }],
    ["a new schema version", { schemaVersion: "business-readiness-audit.v2" }],
    ["a different model", { model: "claude-opus-5" }],
    ["a different provider", { provider: "someone-else" }],
    // Sprint 6 §7: an audit run before a Deep Scan and one run after it saw
    // different evidence, so they must never share an identity.
    ["a first Deep Scan", { authenticatedSnapshotId: "55555555-5555-5555-5555-555555555555" }],
  ])("changes when %s invalidates the result", (_label, override) => {
    expect(computeAuditInputHash({ ...base, ...override })).not.toBe(computeAuditInputHash(base));
  });

  it("does not depend on the order the fields are supplied in", () => {
    const reordered = {
      model: base.model,
      provider: base.provider,
      rubricVersion: base.rubricVersion,
      promptVersion: base.promptVersion,
      evidencePackVersion: base.evidencePackVersion,
      auditVersion: base.auditVersion,
      schemaVersion: base.schemaVersion,
      businessContextHash: base.businessContextHash,
      authenticatedSnapshotId: base.authenticatedSnapshotId,
      liveSnapshotId: base.liveSnapshotId,
      repositorySnapshotId: base.repositorySnapshotId,
    };
    expect(computeAuditInputHash(reordered)).toBe(computeAuditInputHash(base));
  });

  it("distinguishes a re-scanned Deep Scan from the original one", () => {
    // A second Deep Scan is new evidence even though "a Deep Scan exists" is
    // unchanged — a boolean here would have wrongly reused the old audit.
    const first = { ...base, authenticatedSnapshotId: "55555555-5555-5555-5555-555555555555" };
    const second = { ...base, authenticatedSnapshotId: "66666666-6666-6666-6666-666666666666" };
    expect(computeAuditInputHash(first)).not.toBe(computeAuditInputHash(second));
  });

  it("keeps 'no Deep Scan' distinct from any string an id could take", () => {
    const literal = { ...base, authenticatedSnapshotId: "authenticated:none" };
    expect(computeAuditInputHash(literal)).not.toBe(computeAuditInputHash(base));
  });

  it("does not collide when two fields swap values", () => {
    // A naive concatenation would hash these identically.
    const swapped = {
      ...base,
      repositorySnapshotId: base.liveSnapshotId,
      liveSnapshotId: base.repositorySnapshotId,
    };
    expect(computeAuditInputHash(swapped)).not.toBe(computeAuditInputHash(base));
  });
});

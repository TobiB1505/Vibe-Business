import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  CURRENT_EVIDENCE_PACK_VERSION,
  EVIDENCE_PACK_V3_VERSION,
  EVIDENCE_PACK_V4_VERSION,
  EVIDENCE_PACK_V5_VERSION,
  buildCurrentEvidencePack,
  buildEvidencePackForVersion,
} from "./evidence-v3";
import { fakeFounderIntent, fakeLiveSnapshot, fakeRepositorySnapshot } from "./test-support";
import { fakeProductProfile } from "@/modules/product-understanding/test-support";
import type { BuildEvidencePackV3Input } from "./evidence-v3";

/**
 * What production builds, what it stamps, and what it hashes — held together.
 *
 * ## The eleven days this exists for
 *
 * From 2026-08-24 the audit built a **v4** evidence pack and recorded
 * `business-evidence.v3` on the row and inside `computeAuditInputHash`. Four
 * audits, the newest a day old. Nothing failed: `runner.test.ts` asserted the
 * runner's half against the literal `"business-evidence.v4"` and passed, and
 * nothing anywhere compared the two halves.
 *
 * Two things followed, both read out of production rather than reasoned about:
 *
 *  1. ADR 0044's central promise did not happen. "The pack version is part of
 *     `computeAuditInputHash`, so changing what the model sees invalidates
 *     audit reuse by construction" — it does not, if the constant in the hash
 *     never moves. A v3-pack audit and a v4-pack audit shared one identity
 *     space for eleven days.
 *  2. The Action Planner rebuilt at the **row's** version while stamping the
 *     **document's**, on adjacent lines of one function. It fed the model a v3
 *     pack — no contradictions, polarity-free ids — for an audit citing one
 *     contradiction id and seven absence ids, then recorded the plan as v4.
 *     Both stored plans cite zero ids from either v4-only namespace, across
 *     twenty-six citations.
 *
 * ## What is asserted
 *
 * That the pack production builds carries the version production stamps, and
 * that no paid path names a pack version of its own. The second half is a
 * source assertion because that is the shape the defect had: every individual
 * line was defensible, and only the disagreement between them was wrong.
 */

const ROOT = process.cwd();

function auditEvidenceInput(): BuildEvidencePackV3Input {
  return {
    productProfile: fakeProductProfile(),
    founderIntent: fakeFounderIntent(),
    repository: fakeRepositorySnapshot(),
    liveProduct: fakeLiveSnapshot(),
    authenticatedProduct: null,
  };
}

function source(path: string): string {
  return readFileSync(join(ROOT, path), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
}

describe("the pack production builds carries the version production stamps", () => {
  it("agrees with itself", () => {
    expect(buildCurrentEvidencePack(auditEvidenceInput()).version).toBe(
      CURRENT_EVIDENCE_PACK_VERSION,
    );
  });

  /** The version-aware rebuild has to know today's version, or a fresh audit's
   *  own citations stop resolving the moment it is used. */
  it("rebuilds the current version as the current version", () => {
    const rebuilt = buildEvidencePackForVersion(
      auditEvidenceInput(),
      CURRENT_EVIDENCE_PACK_VERSION,
    );

    expect(rebuilt.version).toBe(CURRENT_EVIDENCE_PACK_VERSION);
  });

  it("is the newest version this module can build", () => {
    expect(CURRENT_EVIDENCE_PACK_VERSION).toBe(EVIDENCE_PACK_V5_VERSION);
  });
});

/**
 * The three sites the constant drifted between, asserted where they live.
 *
 * A value test cannot see this: each site compiles, each is a correct call, and
 * what was wrong was that one of them named a different version than the other
 * two.
 */
describe("no paid path names a pack version of its own", () => {
  const PAID = [
    "src/modules/business-audit/runner.ts",
    "src/modules/business-audit/service.ts",
    "src/modules/operations/business-audit/execution.ts",
    "src/modules/operations/service.ts",
  ];

  it.each(PAID)("%s names no pack version literal", (path) => {
    expect(source(path)).not.toMatch(/business-evidence\.v\d/);
  });

  it.each(PAID)("%s reaches no version-specific builder or constant", (path) => {
    const body = source(path);

    for (const named of [
      "EVIDENCE_PACK_V3_VERSION",
      "EVIDENCE_PACK_V4_VERSION",
      "EVIDENCE_PACK_V5_VERSION",
      "buildEvidencePackV3",
      "buildEvidencePackV4",
    ]) {
      expect(body, `${path} → ${named}`).not.toContain(named);
    }
  });

  /* Either the constant or the builder derived from it — both name one thing. */
  it.each(PAID)("%s names the current pack instead", (path) => {
    const body = source(path);

    expect(
      body.includes("CURRENT_EVIDENCE_PACK_VERSION") || body.includes("buildCurrentEvidencePack"),
      path,
    ).toBe(true);
  });
});

/**
 * A rebuild reads one field, and every consumer reads the same one.
 *
 * The document, not the row: the row was the half that lied, and the document
 * is what `computeOpportunityInputHash` and `computeActionPlanInputHash`
 * already hash. Two consumers reading two fields for one fact is what let the
 * Action Planner disagree with the Opportunity engine about the same audit.
 */
describe("every rebuild asks the same question", () => {
  const REBUILDERS = [
    "src/modules/operations/opportunities/execution.ts",
    "src/modules/operations/action-plans/execution.ts",
  ];

  it.each(REBUILDERS)("%s takes its pack version from the audit document", (path) => {
    expect(source(path)).toContain("audit.result.evidencePackVersion");
  });

  /**
   * The bug, as a shape. `audit` at these call sites is a `StoredAudit`, so
   * `audit.evidencePackVersion` is the row column — the half that lied. A
   * leading `[^.]` keeps `resolved.audit.evidencePackVersion` out of it, which
   * is a *local* object the Opportunity engine already fills from the document.
   */
  it.each(REBUILDERS)("%s never reads the row column for one", (path) => {
    expect(source(path)).not.toMatch(/[^.]audit\.evidencePackVersion/);
  });
});

/**
 * The bump itself: what v5 means, and what it deliberately does not restore.
 */
describe("v5 carries contradictions, and v3 still does not", () => {
  function contradictionsIn(version: string): number {
    return buildEvidencePackForVersion(auditEvidenceInput(), version).items.filter((item) =>
      item.id.startsWith("contradiction."),
    ).length;
  }

  it("builds v5 the way it builds v4", () => {
    const five = buildEvidencePackForVersion(auditEvidenceInput(), EVIDENCE_PACK_V5_VERSION);
    const four = buildEvidencePackForVersion(auditEvidenceInput(), EVIDENCE_PACK_V4_VERSION);

    expect(five.items.map((item) => item.id)).toEqual(four.items.map((item) => item.id));
  });

  it("still mints nothing polarity-bearing for a stored v3 audit", () => {
    expect(contradictionsIn(EVIDENCE_PACK_V3_VERSION)).toBe(0);

    const v3 = buildEvidencePackForVersion(auditEvidenceInput(), EVIDENCE_PACK_V3_VERSION);
    expect(v3.items.some((item) => item.id.startsWith("repo.surface_absent."))).toBe(false);
  });

  /**
   * Stated rather than quietly true. `buildContradictionEvidence` calls today's
   * cross-checker whatever version it is asked for, so a stored v4 audit
   * rebuilt today gets today's answers, not August's. Restoring those would
   * mean versioning `buildIntelligenceCrossChecks` itself, which is not built —
   * the four affected audits all predate an analyzer correction and are already
   * refused as stale, so no new paid work can rest on them.
   */
  it("does not claim a v4 rebuild is faithful to when it was written", () => {
    const four = buildEvidencePackForVersion(auditEvidenceInput(), EVIDENCE_PACK_V4_VERSION);
    const five = buildEvidencePackForVersion(auditEvidenceInput(), EVIDENCE_PACK_V5_VERSION);

    /* Identical output is the honest statement of the limitation, not a bug. */
    expect(four.items).toEqual(five.items);
  });
});

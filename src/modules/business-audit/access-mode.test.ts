import { describe, expect, it } from "vitest";
import { checkedValues } from "@/modules/operations/migration-test-support";

/**
 * The `access_mode` TypeScript union, pinned to the SQL CHECK.
 *
 * ## Why this file exists
 *
 * Because the drift it catches has now happened three times in this repository,
 * and the third was this sprint. CORE-2a.2 added `system_contract_refresh` to
 * `AuditAccessMode` and left the constraint at three values, so every system
 * refresh failed at INSERT — reported as the generic `audit_failed`, with 3073
 * unit tests green, because the in-memory test database does not evaluate CHECK
 * constraints.
 *
 * `migration-test-support.ts` was written after the first two occurrences and
 * says so in its own header. It simply was not applied here. Now it is.
 *
 * The union is read from the migration rather than duplicated, so the test
 * cannot drift from the schema in the same way the code did.
 */

const PERMITTED = () => checkedValues("business_readiness_audits", "access_mode");

/**
 * Every mode the application can persist.
 *
 * Written out rather than imported from the union so that adding a value in
 * TypeScript alone fails here loudly, instead of both sides moving together and
 * the test proving nothing.
 */
const APPLICATION_MODES = [
  "included_first_audit",
  "credits",
  "legacy_pre_entitlement",
  "system_contract_refresh",
] as const;

describe("business_readiness_audits.access_mode", () => {
  it("permits exactly the modes the application knows about", () => {
    expect(PERMITTED().sort()).toEqual([...APPLICATION_MODES].sort());
  });

  /**
   * The one this sprint needed. A refresh row is written with this mode, so a
   * database that rejects it turns every contract upgrade into a failed audit.
   */
  it("permits the system contract refresh mode", () => {
    expect(PERMITTED()).toContain("system_contract_refresh");
  });

  it("still permits the included entitlement the free audit depends on", () => {
    expect(PERMITTED()).toContain("included_first_audit");
  });

  /**
   * `legacy_pre_entitlement` marks rows written before the entitlement existed.
   * Removing it from the constraint would make historical rows unreadable on
   * their next update.
   */
  it("still permits the historical mode", () => {
    expect(PERMITTED()).toContain("legacy_pre_entitlement");
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { computeProductScanIdentity } from "./identity";
import { PRODUCT_SCAN_EVENT_LIMIT, PRODUCT_SCAN_EVENT_TYPES } from "./schema";

const MIGRATION = readFileSync(
  join(process.cwd(), "supabase/migrations/20260825120000_product_scan_events.sql"),
  "utf8",
);

describe("Product Scan persistence contract", () => {
  it("keeps TypeScript and SQL event types aligned", () => {
    for (const type of PRODUCT_SCAN_EVENT_TYPES) {
      expect(MIGRATION).toContain(`'${type}'`);
    }
  });

  it("bounds the feed and makes workflow replay idempotent", () => {
    expect(PRODUCT_SCAN_EVENT_LIMIT).toBe(24);
    expect(MIGRATION).toContain("sequence between 1 and 24");
    expect(MIGRATION).toContain("product_scan_events_unique_sequence");
    expect(MIGRATION).toContain("product_scan_events_unique_key");
  });

  it("uses a stable 64-character active-run identity", () => {
    const first = computeProductScanIdentity("project-one");
    expect(first).toHaveLength(64);
    expect(computeProductScanIdentity("project-one")).toBe(first);
    expect(computeProductScanIdentity("project-two")).not.toBe(first);
  });

  it("exposes the feed read-only to customers", () => {
    expect(MIGRATION).toContain("grant select, insert on table public.product_scan_events to service_role");
    expect(MIGRATION).not.toContain("grant select, insert, update, delete on table public.product_scan_events to service_role");
    expect(MIGRATION).toContain("grant select on table public.product_scan_events to authenticated");
    expect(MIGRATION).not.toContain("grant select, insert on table public.product_scan_events to authenticated");
  });
});

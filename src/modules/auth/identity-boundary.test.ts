import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("the client-safe initials boundary", () => {
  it("contains no server-only GitHub dependency", () => {
    const initials = source("src/modules/auth/initials.ts");

    expect(initials).not.toMatch(/import\s+["']server-only["']/);
    expect(initials).not.toMatch(/from\s+["'][^"']*modules\/github/);
  });

  it("keeps the interactive product list off the account identity module", () => {
    // The card became a row in UI-33. The boundary is the same one: a list of
    // the customer's products draws initials, and pulling
    // `identity-view` in for them would drag server-only GitHub access into a
    // client bundle to spell two letters.
    const row = source("src/app/app/(account)/settings/products/product-list-row.tsx");

    expect(row).toContain('from "@/modules/auth/initials"');
    expect(row).not.toContain('from "@/modules/auth/identity-view"');
  });
});

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
    const card = source("src/app/app/(account)/products/product-list-card.tsx");

    expect(card).toContain('from "@/modules/auth/initials"');
    expect(card).not.toContain('from "@/modules/auth/identity-view"');
  });
});

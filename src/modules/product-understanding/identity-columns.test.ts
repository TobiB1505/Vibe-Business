import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { derivedProductName, displayableLogoUrl } from "./identity-columns";
import type { BrandAsset, BrandAssetRole } from "./schema";
import { fakeProductProfile } from "./test-support";

function asset(role: BrandAssetRole, displayUrl: string | null): BrandAsset {
  return {
    role,
    reference: `/${role}.svg`,
    displayUrl,
    confidence: "likely",
    sources: ["live_product"],
    evidence: [],
  };
}

function withAssets(...assets: BrandAsset[]) {
  const base = fakeProductProfile();
  return fakeProductProfile({ brand: { ...base.brand, assets } });
}

describe("the name written beside the document", () => {
  it("is what the product calls itself", () => {
    expect(derivedProductName(fakeProductProfile())).toBe("Acme");
  });

  it("is absent rather than blank when the profile states no name", () => {
    const base = fakeProductProfile();
    const blank = fakeProductProfile({
      identity: { ...base.identity, name: { ...base.identity.name, value: "   " } },
    });

    // The column's own CHECK rejects a blank string, so this is not a
    // cosmetic preference: writing one would fail the completion.
    expect(derivedProductName(blank)).toBeNull();
  });
});

describe("the logo written beside the document", () => {
  it("takes the primary logo when it can be displayed", () => {
    expect(displayableLogoUrl(withAssets(asset("logo", "https://acme.test/logo.svg")))).toBe(
      "https://acme.test/logo.svg",
    );
  });

  it("falls through to the alternate when the primary cannot be shown", () => {
    // A located asset with no displayUrl is one Vibe found a reference for and
    // cannot render. Preferring it would put a broken image on a card.
    expect(
      displayableLogoUrl(
        withAssets(asset("logo", null), asset("logo_alternate", "https://acme.test/mark.svg")),
      ),
    ).toBe("https://acme.test/mark.svg");
  });

  it("prefers the primary over the alternate regardless of stored order", () => {
    expect(
      displayableLogoUrl(
        withAssets(
          asset("logo_alternate", "https://acme.test/mark.svg"),
          asset("logo", "https://acme.test/logo.svg"),
        ),
      ),
    ).toBe("https://acme.test/logo.svg");
  });

  it("never substitutes an icon for a logo", () => {
    expect(
      displayableLogoUrl(
        withAssets(
          asset("favicon", "https://acme.test/favicon.ico"),
          asset("app_icon", "https://acme.test/icon.png"),
          asset("open_graph_image", "https://acme.test/og.png"),
        ),
      ),
    ).toBeNull();
  });

  it("has nothing to write when the profile carries no asset at all", () => {
    expect(displayableLogoUrl(withAssets())).toBeNull();
  });
});

/**
 * Two writers, one column.
 *
 * A row completed after this shipped goes through the functions above; a row
 * that already existed went through the migration's backfill. If the two ever
 * disagree, a card shows a different name depending on when its profile
 * happened to be derived — and nothing would say so.
 *
 * Text comparison rather than execution: `supabase/tests/` runs the backfill
 * against real PostgreSQL, and what this catches is the cheaper mistake of
 * changing one side and forgetting the other.
 */
describe("the backfill agrees with the write path", () => {
  const MIGRATION = readFileSync(
    "supabase/migrations/20260902205500_product_identity_columns.sql",
    "utf8",
  );

  it("reads the name from the same place", () => {
    expect(MIGRATION).toContain("p.result -> 'identity' -> 'name' ->> 'value'");
  });

  it("treats a blank name as absent, as the write path does", () => {
    expect(MIGRATION).toContain("nullif(btrim(");
  });

  it("considers exactly the roles the write path considers", () => {
    expect(MIGRATION).toContain("asset ->> 'role' in ('logo', 'logo_alternate')");
    for (const excluded of ["favicon", "app_icon", "open_graph_image"]) {
      expect(MIGRATION).not.toContain(`'${excluded}'`);
    }
  });

  it("prefers the primary logo rather than taking whichever is stored first", () => {
    expect(MIGRATION).toContain("order by case asset ->> 'role' when 'logo' then 0 else 1 end");
  });

  it("only ever backfills a completed profile, which is the only one with a result", () => {
    expect(MIGRATION).toContain("where p.status = 'completed'");
  });
});

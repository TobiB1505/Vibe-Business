import type { BrandAssetRole, ProductProfile } from "./schema";

/**
 * What gets denormalised out of a profile document, and nothing else.
 *
 * `product_profiles.result` is the authority. These two values are copied
 * beside it so a list of every project can read columns instead of shipping
 * one full product-profile.v1 per row — the same trade
 * `business_readiness_audits.overall_score` already makes against the audit
 * document.
 *
 * It is a module of its own because two things must produce identical values:
 * this, at completion, and the backfill in
 * `20260902220007_product_identity_columns.sql`, over rows written before the
 * columns existed. A row that disagrees with the row beside it depending on
 * when it was written is the failure mode worth a named boundary and a test
 * that compares the two.
 *
 * Corrections are deliberately absent. They live in
 * `product_profile_corrections`, survive every re-derivation, and are applied
 * on read — baking one in here would let the next scan erase a name a founder
 * corrected.
 */

/**
 * The roles a list will show, in the order it prefers them.
 *
 * A favicon is deliberately absent: it is an icon rather than a logo, and
 * falling through to one would silently substitute a different class of asset
 * at a size where the difference is visible.
 */
export const DISPLAYABLE_LOGO_ROLES: readonly BrandAssetRole[] = ["logo", "logo_alternate"];

export function derivedProductName(profile: ProductProfile): string | null {
  const name = profile.identity.name.value?.trim();
  return name ? name : null;
}

/**
 * `displayUrl` is the schema's "this can actually be shown" field, and
 * `resolveDisplayUrl` has already guaranteed it is https on the product's own
 * origin before it was stored. An asset without one is a logo Vibe located and
 * cannot render; it stays absent rather than becoming a broken image.
 */
export function displayableLogoUrl(profile: ProductProfile): string | null {
  for (const role of DISPLAYABLE_LOGO_ROLES) {
    const asset = profile.brand.assets.find(
      (candidate) => candidate.role === role && candidate.displayUrl !== null,
    );
    if (asset?.displayUrl) return asset.displayUrl;
  }
  return null;
}

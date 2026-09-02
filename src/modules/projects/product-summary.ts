import { applyCorrections } from "@/modules/product-understanding/assemble";
import type {
  BrandAssetRole,
  ProductCategory,
  ProductProfile,
  ProfileCorrections,
} from "@/modules/product-understanding/schema";
import { GOAL_LABELS, type PrimaryGoal } from "./founder-intent";
import type { DashboardProject } from "./dashboard";

const CATEGORY_LABELS: Record<ProductCategory, string> = {
  saas_application: "SaaS application",
  web_app: "Web app",
  ecommerce_store: "E-commerce store",
  marketplace: "Marketplace",
  content_site: "Content site",
  documentation_site: "Documentation",
  booking_tool: "Booking tool",
  internal_tool: "Internal tool",
  portfolio_or_personal_site: "Portfolio",
  landing_page: "Landing page",
  developer_tool: "Developer tool",
  mobile_app_companion: "Mobile companion",
  other: "Other",
};

export type ProductSummary = {
  /**
   * What the product calls itself, when Vibe read a name for it.
   *
   * Separate from the project name on purpose. The project name is a label the
   * founder typed at connection time — often a repository slug — and it stays
   * how they recognise their own row. This is the name the product goes by in
   * front of its customers, and until now it was derived, stored, and shown
   * nowhere.
   */
  productName: string | null;
  /**
   * A logo Vibe can actually display, or `null`.
   *
   * `displayUrl` is already the schema's "this can be shown" field: an
   * absolute URL on the live origin, or a repository path the live site also
   * serves. A reference without one is a logo Vibe located but cannot render,
   * and it stays `null` here rather than becoming a broken image.
   */
  logoUrl: string | null;
  shortDescription: string | null;
  mainPurpose: string | null;
  primaryAudience: string | null;
  founderGoal: string | null;
  category: string | null;
};

export type ProductOverviewItem = DashboardProject & ProductSummary;

/**
 * The one name a list row is about.
 *
 * Every surface that shows, searches or orders a product row must agree on
 * this, or the screen and its controls describe different things: a founder
 * reading "Payflow" would search for "Payflow" and get nothing back, and a
 * name sort would order rows by a label that is not on screen. Both were true
 * the moment the card started leading with the derived name, so the answer
 * lives here rather than in each caller.
 */
export function productDisplayName(product: ProductOverviewItem): string {
  return product.productName ?? product.name;
}

function present(value: string | null): string | null {
  const clean = value?.trim();
  return clean ? clean : null;
}

/**
 * The roles a list row will show, in the order it prefers them.
 *
 * A favicon is deliberately absent. It is an icon rather than a logo, and
 * falling through to one would silently substitute a different class of asset
 * for the thing the row says it is showing — at a size where the difference is
 * visible.
 */
const DISPLAYABLE_LOGO_ROLES: readonly BrandAssetRole[] = ["logo", "logo_alternate"];

function displayableLogo(profile: ProductProfile | null): string | null {
  if (!profile) return null;

  for (const role of DISPLAYABLE_LOGO_ROLES) {
    const asset = profile.brand.assets.find(
      (candidate) => candidate.role === role && candidate.displayUrl !== null,
    );
    if (asset?.displayUrl) return asset.displayUrl;
  }

  return null;
}

/**
 * Reduces the canonical Product Profile to the four sentences a list row can
 * justify. Corrections are applied first so a founder's own words remain more
 * authoritative than an older derived description.
 */
export function buildProductSummary(params: {
  profile: ProductProfile | null;
  corrections?: ProfileCorrections;
  primaryGoal: PrimaryGoal | null;
}): ProductSummary {
  const profile = params.profile
    ? applyCorrections(params.profile, params.corrections ?? {})
    : null;
  const category = profile?.identity.category.value ?? null;

  return {
    productName: present(profile?.identity.name.value ?? null),
    logoUrl: displayableLogo(profile),
    shortDescription: present(profile?.identity.shortDescription.value ?? null),
    mainPurpose: present(profile?.identity.mainPurpose.value ?? null),
    primaryAudience: present(profile?.audience.primaryAudience.value ?? null),
    founderGoal: params.primaryGoal ? GOAL_LABELS[params.primaryGoal] : null,
    category: category ? CATEGORY_LABELS[category] : null,
  };
}

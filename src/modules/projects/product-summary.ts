import { applyCorrections } from "@/modules/product-understanding/assemble";
import type {
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
  shortDescription: string | null;
  mainPurpose: string | null;
  primaryAudience: string | null;
  founderGoal: string | null;
  category: string | null;
};

export type ProductOverviewItem = DashboardProject & ProductSummary;

function present(value: string | null): string | null {
  const clean = value?.trim();
  return clean ? clean : null;
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
    shortDescription: present(profile?.identity.shortDescription.value ?? null),
    mainPurpose: present(profile?.identity.mainPurpose.value ?? null),
    primaryAudience: present(profile?.audience.primaryAudience.value ?? null),
    founderGoal: params.primaryGoal ? GOAL_LABELS[params.primaryGoal] : null,
    category: category ? CATEGORY_LABELS[category] : null,
  };
}

import { buildUnderstandingView } from "@/modules/product-understanding/view";
import type { ProductProfile } from "@/modules/product-understanding/schema";

export type ProductScanPresentation = {
  name: string;
  description: string | null;
  productType: string | null;
  audience: string | null;
  businessModel: string | null;
  profileStatus: string;
  techStack: string | null;
  logo: { url: string; alt: string } | null;
  typeface: string | null;
  colors: string[];
  capabilities: string[];
};

/**
 * Small, founder-readable projection for the scanner UI. The projection is
 * built from the validated Product Profile and never exposes raw evidence,
 * source paths, model output or provider detail.
 */
export function buildProductScanPresentation(
  profile: ProductProfile,
  synthesized: boolean,
  fallbackName: string,
): ProductScanPresentation {
  const view = buildUnderstandingView(profile, synthesized);
  const framework = view.technical.find((row) => row.label === "Framework")?.value ?? null;
  const audience = view.dna.find((row) => row.id === "audience")?.value ?? null;
  const businessModel = profile.businessSignals.some((signal) => signal.id === "subscription_capability")
    ? "Subscription signals"
    : profile.businessSignals.some((signal) => signal.id === "payment_capability")
      ? "Payment signals"
      : profile.businessSignals.some((signal) => signal.id === "pricing_surface")
        ? "Pricing observed"
        : null;

  return {
    name: view.headline.productName ?? fallbackName,
    description: view.headline.understanding,
    productType: view.headline.category,
    audience,
    businessModel,
    profileStatus: "Ready to review",
    techStack: framework,
    logo: view.brand.logo,
    typeface: view.brand.typefaces[0]?.family ?? null,
    colors: view.brand.colors.slice(0, 3).map((color) => color.value),
    capabilities: view.capabilities.slice(0, 3).map((capability) => capability.label),
  };
}

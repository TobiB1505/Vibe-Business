import { buildUnderstandingView } from "@/modules/product-understanding/view";
import type {
  BusinessSignalId,
  ProductProfile,
} from "@/modules/product-understanding/schema";

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
  /*
   * A signal that was *found*, not merely one that was asked about.
   *
   * This read `.some((signal) => signal.id === …)`, and every signal is emitted
   * for every profile — so the `null` branch was unreachable and every product
   * ever scanned reported at least "Pricing observed", including one whose
   * pricing signal said Vibe had found none. Presence in the list means the
   * dimension was assessed; `confidence` is what says how it came out.
   */
  const found = (id: BusinessSignalId) =>
    profile.businessSignals.some(
      (signal) => signal.id === id && signal.confidence !== "not_found",
    );

  const businessModel = found("subscription_capability")
    ? "Subscription signals"
    : found("payment_capability")
      ? "Payment signals"
      : found("pricing_surface")
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

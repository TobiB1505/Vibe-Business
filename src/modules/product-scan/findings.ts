import type { LiveProductIntelligenceSnapshot, ProductSurfaceId } from "@/modules/live-product-intelligence/schema";
import { BUSINESS_SURFACE_LABELS, SIGNAL_CATEGORY_LABELS, type RepositoryIntelligenceSnapshot } from "@/modules/repository-intelligence/schema";
import type { AppendProductScanEvent } from "./store";

const LIVE_SURFACE_LABELS: Record<ProductSurfaceId, string> = {
  homepage: "Homepage",
  pricing: "Pricing",
  login: "Sign-in",
  signup: "Sign-up",
  dashboard_app: "Product workspace",
  checkout_billing: "Checkout and billing",
  onboarding: "Customer onboarding",
  contact: "Contact",
  docs_help: "Docs and help",
  blog_content: "Content",
  privacy: "Privacy",
  terms: "Terms",
};

const BRAND_ASSET_LABELS = {
  logo: "Product logo",
  logo_alternate: "Alternate logo",
  favicon: "Browser icon",
  app_icon: "App icon",
  open_graph_image: "Share image",
  web_manifest: "App manifest",
} as const;

function safeTypefaceLabel(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 56);
}

/**
 * Compiles only deterministic, derived facts into Vibe-authored copy. These
 * functions never copy repository contents, page bodies or model text.
 */
export function repositoryFindingEvents(
  snapshot: RepositoryIntelligenceSnapshot,
  referenceId: string,
): AppendProductScanEvent[] {
  const events: AppendProductScanEvent[] = [];
  const framework = snapshot.frameworks[0];
  if (framework) {
    events.push({
      eventKey: `repo.framework.${framework.id}`,
      type: "finding",
      phase: "code",
      source: "repository",
      findingKey: `framework.${framework.id}`,
      title: `${framework.name} application detected`,
      detail: "The application framework was identified from repository structure and declarations.",
      referenceId,
    });
  }

  const asset = snapshot.brand.assets.find((item) => item.role === "logo") ?? snapshot.brand.assets[0];
  if (asset) {
    events.push({
      eventKey: `repo.brand.asset.${asset.role}`,
      type: "finding",
      phase: "code",
      source: "repository",
      findingKey: `brand.asset.${asset.role}`,
      title: `${BRAND_ASSET_LABELS[asset.role]} detected`,
      detail: "Vibe found a declared brand asset without copying or storing the image itself.",
      referenceId,
    });
  }

  const typeface = snapshot.brand.typefaces[0];
  const typefaceLabel = typeface ? safeTypefaceLabel(typeface.family) : "";
  if (typeface && typefaceLabel) {
    events.push({
      eventKey: `repo.brand.typeface.${typeface.role}`,
      type: "finding",
      phase: "code",
      source: "repository",
      findingKey: `brand.typeface.${typeface.role}`,
      title: `${typefaceLabel} typography detected`,
      detail: `A ${typeface.role} type family is declared in the product's design system.`,
      referenceId,
    });
  }

  const color = snapshot.brand.colors[0];
  if (color) {
    events.push({
      eventKey: `repo.brand.color.${color.role}`,
      type: "finding",
      phase: "code",
      source: "repository",
      findingKey: `brand.color.${color.role}`,
      title: `${color.role[0].toUpperCase()}${color.role.slice(1)} color detected`,
      detail: `${color.value.toUpperCase()} is declared as a product color token.`,
      referenceId,
    });
  }

  for (const signal of snapshot.integrationSignals.slice(0, 2)) {
    events.push({
      eventKey: `repo.integration.${signal.category}`,
      type: "finding",
      phase: "code",
      source: "repository",
      findingKey: `integration.${signal.category}`,
      title: `${SIGNAL_CATEGORY_LABELS[signal.category]} signal found`,
      detail: "This is an integration signal, not a claim that the service is configured or active.",
      referenceId,
    });
  }

  for (const surface of snapshot.businessSurfaces.filter((item) => item.detected).slice(0, 2)) {
    events.push({
      eventKey: `repo.surface.${surface.id}`,
      type: "finding",
      phase: "code",
      source: "repository",
      findingKey: `surface.${surface.id}`,
      title: `${BUSINESS_SURFACE_LABELS[surface.id]} surface mapped`,
      detail: "Vibe found repository evidence for this product surface.",
      referenceId,
    });
  }

  return events.slice(0, 8);
}

export function liveProductFindingEvents(
  snapshot: LiveProductIntelligenceSnapshot,
  referenceId: string,
): AppendProductScanEvent[] {
  const events: AppendProductScanEvent[] = [];
  const brand = snapshot.brandSignals ?? { siteName: null, assets: [], colors: [], typefaces: [] };
  const asset = brand.assets.find((item) => item.role === "logo") ?? brand.assets[0];
  if (asset) {
    events.push({
      eventKey: `live.brand.asset.${asset.role}`,
      type: "finding",
      phase: "public_product",
      source: "live_product",
      findingKey: `brand.asset.${asset.role}`,
      title: `${BRAND_ASSET_LABELS[asset.role]} observed`,
      detail: "The public product presents this brand asset to visitors.",
      referenceId,
    });
  }

  const liveTypeface = safeTypefaceLabel(brand.typefaces[0] ?? "");
  if (liveTypeface) {
    events.push({
      eventKey: "live.brand.typeface.primary",
      type: "finding",
      phase: "public_product",
      source: "live_product",
      findingKey: "brand.typeface.primary",
      title: `${liveTypeface} typography observed`,
      detail: "The public product declares this type family for visitors.",
      referenceId,
    });
  }

  const liveColor = brand.colors[0];
  if (liveColor) {
    events.push({
      eventKey: "live.brand.color.primary",
      type: "finding",
      phase: "public_product",
      source: "live_product",
      findingKey: "brand.color.primary",
      title: "Brand color observed",
      detail: `${liveColor.value.toUpperCase()} is declared by the public product.`,
      referenceId,
    });
  }

  for (const surface of snapshot.productSurfaces.filter((item) => item.detected).slice(0, 2)) {
    events.push({
      eventKey: `live.surface.${surface.id}`,
      type: "finding",
      phase: "public_product",
      source: "live_product",
      findingKey: `surface.${surface.id}`,
      title: `${LIVE_SURFACE_LABELS[surface.id]} reached`,
      detail: "This surface was observed on the public product.",
      referenceId,
    });
  }

  if (snapshot.pricing?.pricingPageReached) {
    events.push({
      eventKey: "live.pricing.reached",
      type: "finding",
      phase: "public_product",
      source: "live_product",
      findingKey: "pricing.page_reached",
      title: "Public pricing reached",
      detail: "Vibe reached a pricing surface; it does not infer a business model from this alone.",
      referenceId,
    });
  }

  if (snapshot.conversionSignals.primaryCta) {
    events.push({
      eventKey: `live.cta.${snapshot.conversionSignals.primaryCta.category}`,
      type: "finding",
      phase: "public_product",
      source: "live_product",
      findingKey: `cta.${snapshot.conversionSignals.primaryCta.category}`,
      title: "Primary customer action identified",
      detail: "Vibe found the strongest public call-to-action category.",
      referenceId,
    });
  }

  return events.slice(0, 6);
}

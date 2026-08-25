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

  for (const signal of snapshot.integrationSignals.slice(0, 3)) {
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

  for (const surface of snapshot.businessSurfaces.filter((item) => item.detected).slice(0, 3)) {
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

  if (snapshot.brand.assets.length + snapshot.brand.colors.length + snapshot.brand.typefaces.length > 0) {
    events.push({
      eventKey: "repo.brand.signals",
      type: "finding",
      phase: "code",
      source: "repository",
      findingKey: "brand.repository_signals",
      title: "Brand identity signals found",
      detail: "Vibe found declared assets, colors or type choices in the product code.",
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
  for (const surface of snapshot.productSurfaces.filter((item) => item.detected).slice(0, 4)) {
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

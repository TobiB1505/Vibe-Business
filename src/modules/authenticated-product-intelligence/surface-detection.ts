import type { RepositoryIntelligenceSnapshot } from "@/modules/repository-intelligence/schema";
import type { LiveProductIntelligenceSnapshot } from "@/modules/live-product-intelligence/schema";

/**
 * Does this product have an authenticated experience worth scanning?
 * (Sprint 5 §7, §12)
 *
 * Used to decide whether to *recommend* a Deep Scan. It must be evidence-driven,
 * because a false positive nags a user about a login their product does not
 * have, and a false negative leaves Vibe silently blind to most of a product.
 *
 * The explicit non-signal: **a project using Supabase, Auth.js, Clerk or any
 * other auth library is not evidence of an authenticated product surface.** A
 * dependency proves someone installed a package. Plenty of products ship an
 * auth library and have nothing behind it yet. What counts is a *route* or a
 * *server response* that shows a protected area exists.
 */

export type AuthenticatedSurfaceEvidenceKind =
  /** The public crawl saw a path redirect to a login surface. Strongest signal. */
  | "public_login_redirect"
  /** The repository declares a page route under an application prefix. */
  | "repository_app_route"
  /** The public site serves a login or signup surface. */
  | "public_auth_surface"
  /** A login-shaped form was detected on the public site. */
  | "public_login_form";

export type AuthenticatedSurfaceEvidence = {
  kind: AuthenticatedSurfaceEvidenceKind;
  /** Origin-relative path the evidence came from. Never a full URL. */
  path: string;
};

export type AuthenticatedSurfaceDetection = {
  /** True when a Deep Scan should be recommended. */
  likely: boolean;
  confidence: "high" | "medium" | "low";
  evidence: AuthenticatedSurfaceEvidence[];
};

/** Path prefixes that indicate an application area rather than a marketing page. */
const APP_ROUTE_PATTERN = /^\/(app|dashboard|admin|account|console|portal|workspace|home)(\/|$)/i;

const LOGIN_PATH_PATTERN = /(^|\/)(login|signin|sign-in|log-in)(\/|$)/i;

export function detectAuthenticatedSurfaces(input: {
  repository: RepositoryIntelligenceSnapshot | null;
  publicProduct: LiveProductIntelligenceSnapshot | null;
}): AuthenticatedSurfaceDetection {
  const evidence: AuthenticatedSurfaceEvidence[] = [];

  // 1. A path that bounced to a login page. This is proof: the server itself
  //    said "there is something here, and you may not see it".
  for (const page of input.publicProduct?.pages ?? []) {
    if (page.redirectedTo && LOGIN_PATH_PATTERN.test(page.redirectedTo)) {
      evidence.push({ kind: "public_login_redirect", path: page.path });
    }
  }

  // 2. Application page routes declared by the repository.
  for (const route of input.repository?.routes.routes ?? []) {
    if (route.kind !== "page") continue;
    if (!APP_ROUTE_PATTERN.test(route.path)) continue;
    evidence.push({ kind: "repository_app_route", path: route.path });
  }

  // 3. A login or signup surface on the public site. Weaker on its own — a
  //    product can serve a signup page with nothing built behind it — but it
  //    corroborates the others.
  for (const surface of input.publicProduct?.productSurfaces ?? []) {
    if (!surface.detected) continue;
    if (surface.id !== "login" && surface.id !== "signup") continue;
    const path = surface.evidence[0]?.path ?? "/";
    evidence.push({ kind: "public_auth_surface", path });
  }

  for (const form of input.publicProduct?.conversionSignals.forms ?? []) {
    if (form.kind === "login_like") {
      evidence.push({ kind: "public_login_form", path: form.path });
    }
  }

  const kinds = new Set(evidence.map((item) => item.kind));
  const hasProof = kinds.has("public_login_redirect");
  const hasAppRoute = kinds.has("repository_app_route");
  const hasAuthSurface = kinds.has("public_auth_surface") || kinds.has("public_login_form");

  // A redirect is proof on its own. An app route plus an auth surface is a
  // strong pair. An auth surface alone is not enough to nag someone about.
  const likely = hasProof || (hasAppRoute && hasAuthSurface) || hasAppRoute;

  let confidence: AuthenticatedSurfaceDetection["confidence"] = "low";
  if (hasProof) confidence = "high";
  else if (hasAppRoute && hasAuthSurface) confidence = "medium";
  else if (hasAppRoute) confidence = "low";

  return { likely, confidence, evidence: evidence.slice(0, 12) };
}

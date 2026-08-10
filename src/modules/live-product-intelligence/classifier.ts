import type { ParsedHtml } from "./html";
import { classifyForm } from "./forms";
import type { LiveEvidence, ProductSurfaceId } from "./schema";

/**
 * Deterministic product surface classification (Sprint 3 §16).
 *
 * Strictly descriptive. A surface is either detected with evidence, or it
 * is not — "Pricing surface not detected" is a fact; "your pricing
 * strategy is poor" is a judgement this layer must never make. Qualitative
 * interpretation belongs to the later Business Audit, which consumes these
 * signals as input.
 *
 * Signals come from four independent sources — URL path, page title,
 * headings, and form structure — so a page is not misclassified just
 * because its URL is unusual. Path is the strongest signal, form
 * structure the most reliable corroboration (a password field is a very
 * good reason to believe a page is a login).
 */

const SURFACE_NAMES: Record<ProductSurfaceId, string> = {
  homepage: "Homepage",
  pricing: "Pricing",
  login: "Login",
  signup: "Signup",
  dashboard_app: "Dashboard / app",
  checkout_billing: "Checkout / billing",
  onboarding: "Onboarding",
  contact: "Contact",
  docs_help: "Docs / help",
  blog_content: "Blog / content",
  privacy: "Privacy policy",
  terms: "Terms",
};

export function surfaceName(id: ProductSurfaceId): string {
  return SURFACE_NAMES[id];
}

export const ALL_SURFACES: ProductSurfaceId[] = Object.keys(SURFACE_NAMES) as ProductSurfaceId[];

/**
 * Path patterns, anchored at the start of the pathname. German variants
 * are included alongside English for the same reason as in the CTA
 * detector: to keep the model demonstrably extensible rather than
 * English-only (Sprint 3 §17).
 */
const PATH_PATTERNS: Record<Exclude<ProductSurfaceId, "homepage">, RegExp> = {
  pricing: /^\/(?:pricing|plans?|preise|tarife|upgrade)(?:\/|$)/i,
  login: /^\/(?:login|log-in|signin|sign-in|anmelden|einloggen|auth\/login)(?:\/|$)/i,
  signup: /^\/(?:signup|sign-up|register|registration|registrieren|join|auth\/signup|create-account)(?:\/|$)/i,
  dashboard_app: /^\/(?:app|dashboard|console|admin|account|portal|workspace)(?:\/|$)/i,
  checkout_billing: /^\/(?:checkout|billing|subscribe|payment|kasse|zahlung|account\/billing)(?:\/|$)/i,
  onboarding: /^\/(?:onboarding|welcome|get-started|getting-started|setup|willkommen)(?:\/|$)/i,
  contact: /^\/(?:contact|contact-us|support|kontakt|hilfe\/kontakt)(?:\/|$)/i,
  docs_help: /^\/(?:docs?|documentation|help|guides?|faq|manual|dokumentation|hilfe)(?:\/|$)/i,
  blog_content: /^\/(?:blog|posts?|articles?|news|changelog|updates|magazin)(?:\/|$)/i,
  privacy: /^\/(?:privacy|privacy-policy|datenschutz|datenschutzerklaerung)(?:\/|$)/i,
  terms: /^\/(?:terms|terms-of-service|tos|legal|agb|impressum|imprint|nutzungsbedingungen)(?:\/|$)/i,
};

/** Title/heading patterns — weaker than path, used to corroborate or to catch unusual URLs. */
const TEXT_PATTERNS: Partial<Record<ProductSurfaceId, RegExp>> = {
  pricing: /\b(?:pricing|plans|preise|tarife)\b/i,
  login: /\b(?:log ?in|sign ?in|anmelden|einloggen)\b/i,
  signup: /\b(?:sign ?up|create (?:an )?account|registrieren|konto erstellen)\b/i,
  contact: /\b(?:contact|kontakt)\b/i,
  docs_help: /\b(?:documentation|docs|help c?entre?|faq|dokumentation)\b/i,
  blog_content: /\b(?:blog|changelog|news)\b/i,
  privacy: /\b(?:privacy policy|datenschutz)\b/i,
  terms: /\b(?:terms of service|terms & conditions|agb|impressum)\b/i,
  checkout_billing: /\b(?:checkout|billing|payment|zahlung)\b/i,
  onboarding: /\b(?:get started|onboarding|willkommen)\b/i,
};

export type PageClassification = {
  surfaces: ProductSurfaceId[];
  evidence: Map<ProductSurfaceId, LiveEvidence[]>;
};

function push(map: Map<ProductSurfaceId, LiveEvidence[]>, id: ProductSurfaceId, item: LiveEvidence) {
  const existing = map.get(id);
  if (existing) existing.push(item);
  else map.set(id, [item]);
}

/**
 * Classifies one fetched page.
 *
 * `requestedPath` and `finalPath` differ when the request was redirected;
 * both matter, because `/app` redirecting to `/login` is simultaneously
 * evidence of a login surface *and* of a protected application surface
 * (Sprint 3 §19).
 */
export function classifyPage(input: {
  requestedPath: string;
  finalPath: string;
  html: ParsedHtml;
}): PageClassification {
  const { requestedPath, finalPath, html } = input;
  const evidence = new Map<ProductSurfaceId, LiveEvidence[]>();
  const detected = new Set<ProductSurfaceId>();

  const mark = (id: ProductSurfaceId, item: LiveEvidence) => {
    detected.add(id);
    push(evidence, id, item);
  };

  if (finalPath === "/") {
    mark("homepage", { kind: "url_path", path: "/" });
  }

  for (const [surface, pattern] of Object.entries(PATH_PATTERNS) as [
    Exclude<ProductSurfaceId, "homepage">,
    RegExp,
  ][]) {
    if (pattern.test(finalPath)) {
      mark(surface, { kind: "url_path", path: finalPath });
    }
  }

  // A redirect away from the requested path is evidence about the
  // *requested* surface: it exists and is protected.
  if (requestedPath !== finalPath) {
    for (const [surface, pattern] of Object.entries(PATH_PATTERNS) as [
      Exclude<ProductSurfaceId, "homepage">,
      RegExp,
    ][]) {
      if (pattern.test(requestedPath)) {
        mark(surface, {
          kind: "redirect",
          path: requestedPath,
          detail: `redirects to ${finalPath}`,
        });
      }
    }
  }

  const title = html.title ?? "";
  const headingText = html.headings
    .filter((heading) => heading.level <= 2)
    .map((heading) => heading.text)
    .join(" · ");

  for (const [surface, pattern] of Object.entries(TEXT_PATTERNS) as [ProductSurfaceId, RegExp][]) {
    if (title !== "" && pattern.test(title)) {
      mark(surface, { kind: "page_title", path: finalPath, detail: title.slice(0, 120) });
    }
    if (headingText !== "" && pattern.test(headingText)) {
      const heading = html.headings.find((item) => item.level <= 2 && pattern.test(item.text));
      if (heading) {
        mark(surface, { kind: "heading", path: finalPath, detail: heading.text.slice(0, 120) });
      }
    }
  }

  // Form structure is the strongest corroboration available: a password
  // field means an authentication surface regardless of the URL.
  for (const form of html.forms) {
    const { kind } = classifyForm(form);
    if (kind === "login_like") {
      mark("login", { kind: "form_structure", path: finalPath, detail: "password field present" });
    }
    if (kind === "signup_like") {
      mark("signup", { kind: "form_structure", path: finalPath, detail: "registration form" });
    }
    if (kind === "contact_like") {
      mark("contact", { kind: "form_structure", path: finalPath, detail: "message form" });
    }
  }

  return { surfaces: [...detected], evidence };
}

/**
 * Detecting a surface from a *link* the site itself exposes is weaker
 * than having fetched the page, but it is real evidence: a footer link to
 * `/privacy` means the surface exists even when the crawl budget stopped
 * before reaching it.
 */
export function classifyLinkTarget(pathname: string): ProductSurfaceId | null {
  for (const [surface, pattern] of Object.entries(PATH_PATTERNS) as [
    Exclude<ProductSurfaceId, "homepage">,
    RegExp,
  ][]) {
    if (pattern.test(pathname)) return surface;
  }
  return null;
}

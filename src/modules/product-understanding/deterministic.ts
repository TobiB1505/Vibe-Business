import type { AuthenticatedProductIntelligenceSnapshot } from "@/modules/authenticated-product-intelligence/schema";
import type { LiveProductIntelligenceSnapshot } from "@/modules/live-product-intelligence/schema";
import type { RepositoryIntelligenceSnapshot } from "@/modules/repository-intelligence/schema";
import { evidenceId } from "./evidence";
import {
  CAPABILITY_LABELS,
  type BusinessSignal,
  type BusinessSignalId,
  type CapabilityId,
  type EvidenceSource,
  type JourneyStage,
  type JourneyStageId,
  type ProductCapability,
  type ProfileConfidence,
  type TechnicalProfile,
} from "./schema";

/**
 * Everything about a product that can be established **without a model**
 * (CORE-1 §18).
 *
 * The split this file defends: a capability, a journey stage and a business
 * signal are all questions of "does this surface exist?", and rules answer
 * those better than inference does — deterministically, for free, and
 * identically every run. Only the semantic half of the profile (what the
 * product is *for*, who it is *for*, what it *promises*) genuinely needs a
 * model, and that is the only thing the model is asked.
 *
 * Every function here is pure over snapshot data, so the whole layer is
 * testable without a database, a network, or a provider.
 *
 * ## Confidence, and what it is allowed to mean
 *
 * `confirmed` requires a direct observation of the thing itself — a live
 * signup form, a served pricing page. Code that *could* produce a surface is
 * `likely` at best: a Stripe dependency means payment code exists, not that a
 * customer can pay (CORE-1 §42). Nothing here ever reaches `confirmed` from
 * repository evidence alone.
 */

type Support = { confidence: ProfileConfidence; sources: EvidenceSource[]; evidence: string[] };

const NOTHING: Support = { confidence: "not_found", sources: [], evidence: [] };

/**
 * Combines what the code says with what the live site serves.
 *
 * The asymmetry is deliberate and is the core judgement of this module:
 *
 *  - live only          → `confirmed`. A visitor reached it. That is the fact.
 *  - live + code        → `confirmed`. Same, with corroboration.
 *  - code only          → `likely`. The surface is built; whether it is
 *                         reachable is exactly what was not established.
 *  - neither            → `not_found`. Vibe looked and saw nothing.
 */
function combine(input: {
  live?: { detected: boolean; id: string } | null;
  repo?: { detected: boolean; id: string } | null;
  signedIn?: { detected: boolean; id: string } | null;
}): Support {
  const sources: EvidenceSource[] = [];
  const evidence: string[] = [];

  if (input.live?.detected) {
    sources.push("live_product");
    evidence.push(input.live.id);
  }
  if (input.signedIn?.detected) {
    sources.push("deep_scan");
    evidence.push(input.signedIn.id);
  }
  if (input.repo?.detected) {
    sources.push("repository");
    evidence.push(input.repo.id);
  }

  if (evidence.length === 0) return NOTHING;

  const observed = Boolean(input.live?.detected) || Boolean(input.signedIn?.detected);
  return { confidence: observed ? "confirmed" : "likely", sources, evidence };
}

function liveSurface(
  snapshot: LiveProductIntelligenceSnapshot | null,
  id: LiveProductIntelligenceSnapshot["productSurfaces"][number]["id"],
) {
  if (!snapshot) return null;
  const surface = snapshot.productSurfaces.find((candidate) => candidate.id === id);
  return surface?.detected ? { detected: true, id: evidenceId.liveSurface(id) } : null;
}

function repoSurface(
  snapshot: RepositoryIntelligenceSnapshot | null,
  id: RepositoryIntelligenceSnapshot["businessSurfaces"][number]["id"],
) {
  if (!snapshot) return null;
  const surface = snapshot.businessSurfaces.find((candidate) => candidate.id === id);
  return surface?.detected ? { detected: true, id: evidenceId.repoSurface(id) } : null;
}

function authSurface(
  snapshot: AuthenticatedProductIntelligenceSnapshot | null,
  id: AuthenticatedProductIntelligenceSnapshot["productSurfaces"][number]["id"],
) {
  if (!snapshot) return null;
  const surface = snapshot.productSurfaces.find((candidate) => candidate.id === id);
  return surface?.detected ? { detected: true, id: evidenceId.authSurface(id) } : null;
}

function repoIntegration(snapshot: RepositoryIntelligenceSnapshot | null, category: string) {
  if (!snapshot) return null;
  const signal = snapshot.integrationSignals.find((candidate) => candidate.category === category);
  return signal ? { detected: true, id: evidenceId.repoIntegration(signal.id) } : null;
}

function liveCta(
  snapshot: LiveProductIntelligenceSnapshot | null,
  category: LiveProductIntelligenceSnapshot["conversionSignals"]["ctas"][number]["category"],
) {
  if (!snapshot) return null;
  const present = snapshot.conversionSignals.ctas.some((cta) => cta.category === category);
  return present ? { detected: true, id: evidenceId.liveCta(category) } : null;
}

function liveForm(
  snapshot: LiveProductIntelligenceSnapshot | null,
  kind: LiveProductIntelligenceSnapshot["conversionSignals"]["forms"][number]["kind"],
) {
  if (!snapshot) return null;
  const present = snapshot.conversionSignals.forms.some((form) => form.kind === kind);
  return present ? { detected: true, id: evidenceId.liveForm(kind) } : null;
}

/** True when any live page URL matches — a cheap structural signal. */
function livePathMatching(snapshot: LiveProductIntelligenceSnapshot | null, pattern: RegExp) {
  if (!snapshot) return null;
  const page = snapshot.pages.find((candidate) => pattern.test(candidate.path));
  return page ? { detected: true, id: evidenceId.livePage(page.path) } : null;
}

function repoRouteMatching(snapshot: RepositoryIntelligenceSnapshot | null, pattern: RegExp) {
  if (!snapshot) return null;
  const route = snapshot.routes.routes.find(
    (candidate) => candidate.kind === "page" && pattern.test(candidate.path),
  );
  return route ? { detected: true, id: evidenceId.repoRouteSummary() } : null;
}

// ---------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------

export type DeterministicInput = {
  repository: RepositoryIntelligenceSnapshot | null;
  liveProduct: LiveProductIntelligenceSnapshot | null;
  signedInProduct: AuthenticatedProductIntelligenceSnapshot | null;
};

/**
 * What a person can do with this product.
 *
 * Each rule is one question about observable surfaces, and the vocabulary is
 * closed (CORE-1 §8, §44) so the same rules describe a webshop and a booking
 * tool without either being forced into SaaS vocabulary.
 *
 * Only capabilities with real support are returned. A product that has none
 * gets an empty list, which is a truthful answer and one the UI can render —
 * unlike a list of sixteen "not found" rows.
 */
export function deriveCapabilities(input: DeterministicInput): ProductCapability[] {
  const { repository: repo, liveProduct: live, signedInProduct: auth } = input;

  const rules: { id: CapabilityId; support: Support }[] = [
    {
      id: "create_account",
      support: combine({
        live: liveSurface(live, "signup") ?? liveForm(live, "signup_like") ?? liveCta(live, "signup"),
        repo: repoSurface(repo, "authentication"),
      }),
    },
    {
      id: "sign_in",
      support: combine({
        live: liveSurface(live, "login") ?? liveForm(live, "login_like"),
        repo: repoSurface(repo, "authentication"),
        signedIn: auth?.applicationSignals.authenticatedAreaReached
          ? { detected: true, id: evidenceId.authArea() }
          : null,
      }),
    },
    {
      id: "browse_catalog",
      support: combine({
        live: livePathMatching(live, /^\/(products?|shop|store|catalog|collections?|listings?|browse)(\/|$)/i),
        repo: repoRouteMatching(repo, /^\/(products?|shop|store|catalog|collections?|listings?|browse)(\/|$)/i),
      }),
    },
    {
      id: "search",
      support: combine({
        live: liveForm(live, "search_like"),
        repo: repoRouteMatching(repo, /^\/search(\/|$)/i),
      }),
    },
    {
      id: "read_content",
      support: combine({
        live: liveSurface(live, "blog_content") ?? liveSurface(live, "docs_help"),
        repo: repoSurface(repo, "blog_content") ?? repoSurface(repo, "docs_help"),
      }),
    },
    {
      id: "purchase",
      support: combine({
        live: liveSurface(live, "checkout_billing") ?? liveCta(live, "purchase"),
        repo: repoSurface(repo, "checkout_billing") ?? repoSurface(repo, "payments"),
      }),
    },
    {
      id: "subscribe",
      support: combine({
        live: liveCta(live, "subscribe") ?? liveCta(live, "trial"),
        repo: repoIntegration(repo, "payments"),
      }),
    },
    {
      id: "book_appointment",
      support: combine({
        live: livePathMatching(live, /^\/(book|booking|reserve|reservations?|appointments?|schedule)(\/|$)/i),
        repo: repoRouteMatching(repo, /^\/(book|booking|reserve|reservations?|appointments?|schedule)(\/|$)/i),
      }),
    },
    {
      id: "use_dashboard",
      support: combine({
        live: liveSurface(live, "dashboard_app"),
        repo: repoSurface(repo, "dashboard_app"),
        signedIn: authSurface(auth, "dashboard") ?? authSurface(auth, "app_shell"),
      }),
    },
    {
      id: "create_or_upload_content",
      support: combine({
        signedIn: authSurface(auth, "project_workspace"),
        repo: repoRouteMatching(repo, /^\/(new|create|upload|compose|editor?)(\/|$)/i),
      }),
    },
    {
      id: "connect_integration",
      support: combine({
        signedIn: authSurface(auth, "integrations"),
        repo: repoRouteMatching(repo, /^\/(connect|integrations?)(\/|$)/i),
      }),
    },
    {
      id: "export_or_download",
      support: combine({
        repo: repoRouteMatching(repo, /^\/(export|download)(\/|$)/i),
      }),
    },
    {
      id: "collaborate_or_invite",
      support: combine({
        repo: repoRouteMatching(repo, /^\/(team|members?|invite|organi[sz]ations?|workspace)(\/|$)/i),
      }),
    },
    {
      id: "manage_settings",
      support: combine({
        signedIn: authSurface(auth, "settings"),
        repo: repoRouteMatching(repo, /^\/(settings|account|profile|preferences)(\/|$)/i),
      }),
    },
    {
      id: "contact_team",
      support: combine({
        live: liveSurface(live, "contact") ?? liveForm(live, "contact_like") ?? liveCta(live, "contact"),
        repo: repoSurface(repo, "contact"),
      }),
    },
    {
      id: "get_support",
      support: combine({
        live: liveSurface(live, "docs_help"),
        repo: repoSurface(repo, "docs_help"),
      }),
    },
  ];

  const order: Record<ProfileConfidence, number> = {
    confirmed: 0,
    likely: 1,
    unclear: 2,
    not_found: 3,
  };

  return rules
    .filter((rule) => rule.support.confidence !== "not_found")
    .sort((a, b) => order[a.support.confidence] - order[b.support.confidence])
    .map((rule) => ({
      id: rule.id,
      label: CAPABILITY_LABELS[rule.id],
      confidence: rule.support.confidence,
      sources: rule.support.sources,
      evidence: rule.support.evidence,
    }));
}

// ---------------------------------------------------------------------
// Journey
// ---------------------------------------------------------------------

/**
 * A rough answer to "what can a visitor do from arrival to value?"
 *
 * Every stage is returned, including the ones with nothing behind them: this
 * is the one list where absence is the interesting part, because "there is no
 * way to see what it costs" is exactly what a founder needs to notice — stated
 * as an observation, never as a verdict (CORE-1 §10).
 */
export function deriveJourney(input: DeterministicInput): JourneyStage[] {
  const { repository: repo, liveProduct: live, signedInProduct: auth } = input;

  const homepage = live?.pages.find((page) => page.path === "/") ?? null;
  const primaryCta = live?.conversionSignals.primaryCta ?? null;

  const stages: { id: JourneyStageId; detail: string | null; support: Support }[] = [
    {
      id: "entry_point",
      detail: homepage ? "A visitor lands on the public homepage." : null,
      support: homepage
        ? { confidence: "confirmed", sources: ["live_product"], evidence: [evidenceId.livePage("/")] }
        : NOTHING,
    },
    {
      id: "sign_up",
      detail: null,
      support: combine({
        live: liveSurface(live, "signup") ?? liveForm(live, "signup_like"),
        repo: repoSurface(repo, "authentication"),
      }),
    },
    {
      id: "login",
      detail: null,
      support: combine({
        live: liveSurface(live, "login") ?? liveForm(live, "login_like"),
        repo: repoSurface(repo, "authentication"),
      }),
    },
    {
      id: "onboarding",
      detail: null,
      support: combine({
        live: liveSurface(live, "onboarding"),
        repo: repoSurface(repo, "onboarding"),
        signedIn: authSurface(auth, "onboarding"),
      }),
    },
    {
      id: "primary_action",
      detail: primaryCta ? `The main call to action is "${primaryCta.label}".` : null,
      support: primaryCta
        ? {
            confidence: "confirmed",
            sources: ["live_product"],
            evidence: [evidenceId.livePrimaryCta()],
          }
        : NOTHING,
    },
    {
      id: "pricing",
      detail: null,
      support: combine({
        live: liveSurface(live, "pricing"),
        repo: repoSurface(repo, "pricing_page"),
      }),
    },
    {
      id: "checkout",
      detail: null,
      support: combine({
        live: liveSurface(live, "checkout_billing"),
        repo: repoSurface(repo, "checkout_billing"),
        signedIn: authSurface(auth, "billing"),
      }),
    },
    {
      id: "signed_in_experience",
      detail: auth?.applicationSignals.authenticatedAreaReached
        ? `Vibe reached ${auth.applicationSignals.reachableSurfaceCount} signed-in page(s).`
        : null,
      support: combine({
        live: liveSurface(live, "dashboard_app"),
        repo: repoSurface(repo, "dashboard_app"),
        signedIn: auth?.applicationSignals.authenticatedAreaReached
          ? { detected: true, id: evidenceId.authArea() }
          : null,
      }),
    },
  ];

  return stages.map((stage) => ({
    id: stage.id,
    detail: stage.support.confidence === "not_found" ? null : stage.detail,
    confidence: stage.support.confidence,
    sources: stage.support.sources,
    evidence: stage.support.evidence,
  }));
}

// ---------------------------------------------------------------------
// Business signals
// ---------------------------------------------------------------------

/**
 * Observable facts with commercial relevance — and no verdict (CORE-1 §10).
 *
 * The phrasing is load-bearing. "Subscription pricing appears to exist" is a
 * signal; "monetisation is weak" is a diagnosis, and diagnosis belongs to the
 * Business Audit. Every statement below is written so that it stays true even
 * if the audit later disagrees about what it means.
 */
export function deriveBusinessSignals(input: DeterministicInput): BusinessSignal[] {
  const { repository: repo, liveProduct: live, signedInProduct: auth } = input;
  const signals: BusinessSignal[] = [];

  function push(id: BusinessSignalId, present: string, absent: string, support: Support) {
    signals.push({
      id,
      statement: support.confidence === "not_found" ? absent : present,
      confidence: support.confidence,
      sources: support.sources,
      evidence: support.evidence,
    });
  }

  push(
    "pricing_surface",
    "A pricing surface exists.",
    "Vibe could not identify a pricing path in the sources it read.",
    combine({ live: liveSurface(live, "pricing"), repo: repoSurface(repo, "pricing_page") }),
  );

  push(
    "payment_capability",
    "Payment functionality appears to be present.",
    "Vibe found no payment signals in the sources it read.",
    combine({
      live: liveSurface(live, "checkout_billing"),
      repo: repoIntegration(repo, "payments") ?? repoSurface(repo, "payments"),
      signedIn: authSurface(auth, "billing"),
    }),
  );

  push(
    "subscription_capability",
    "Recurring or subscription pricing appears to be supported.",
    "Vibe found no subscription signals in the sources it read.",
    combine({
      live: liveCta(live, "subscribe") ?? liveCta(live, "trial"),
      repo: repoSurface(repo, "checkout_billing"),
      signedIn: authSurface(auth, "billing"),
    }),
  );

  push(
    "analytics",
    "An analytics integration signal is present.",
    "Vibe found no analytics signals, so how visitors behave is unobserved.",
    combine({ repo: repoIntegration(repo, "analytics") ?? repoSurface(repo, "analytics") }),
  );

  const primaryCta = live?.conversionSignals.primaryCta ?? null;
  push(
    "conversion_path",
    primaryCta
      ? `The public site leads with a "${primaryCta.label}" action.`
      : "The public site has a visible call to action.",
    "Vibe found no clear call to action on the pages it inspected.",
    primaryCta
      ? { confidence: "confirmed", sources: ["live_product"], evidence: [evidenceId.livePrimaryCta()] }
      : NOTHING,
  );

  push(
    "acquisition_surface",
    "The product publishes content that people can find it through.",
    "Vibe found no public content surfaces such as a blog or documentation.",
    combine({
      live: liveSurface(live, "blog_content") ?? liveSurface(live, "docs_help"),
      repo: repoSurface(repo, "blog_content") ?? repoSurface(repo, "docs_help"),
    }),
  );

  push(
    "retention_capability",
    "The product has a signed-in area users can come back to.",
    "Vibe found no signed-in area, so there is nothing observed for users to return to.",
    combine({
      live: liveSurface(live, "dashboard_app"),
      repo: repoSurface(repo, "dashboard_app"),
      signedIn: auth?.applicationSignals.authenticatedAreaReached
        ? { detected: true, id: evidenceId.authArea() }
        : null,
    }),
  );

  push(
    "account_system",
    "The product has user accounts.",
    "Vibe found no account system in the sources it read.",
    combine({
      live: liveSurface(live, "login") ?? liveSurface(live, "signup"),
      repo: repoSurface(repo, "authentication"),
    }),
  );

  return signals;
}

// ---------------------------------------------------------------------
// Technical profile
// ---------------------------------------------------------------------

export function deriveTechnicalProfile(input: DeterministicInput): TechnicalProfile {
  const repo = input.repository;

  if (!repo) {
    return {
      framework: null,
      languages: [],
      database: null,
      authProvider: null,
      paymentProvider: null,
      analyticsProvider: null,
      deployment: null,
      integrations: [],
      hasTestInfrastructure: false,
    };
  }

  const byCategory = (category: string) =>
    repo.integrationSignals.find((signal) => signal.category === category)?.name ?? null;

  return {
    framework: repo.frameworks[0]?.name ?? null,
    languages: repo.languages.map((language) => language.name),
    database: byCategory("database"),
    authProvider: byCategory("auth"),
    paymentProvider: byCategory("payments"),
    analyticsProvider: byCategory("analytics"),
    deployment: byCategory("deployment"),
    integrations: repo.integrationSignals.map((signal) => signal.name),
    hasTestInfrastructure: repo.projectStructure.topLevelDirectories.some((directory) =>
      ["test", "tests", "e2e", "__tests__", "spec"].includes(directory.toLowerCase()),
    ),
  };
}

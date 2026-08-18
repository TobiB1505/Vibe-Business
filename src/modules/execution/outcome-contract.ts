import type { RepositoryIntelligenceSnapshot } from "@/modules/repository-intelligence/schema";
import {
  MAX_PRIVATE_PREFIX_CHECKS,
  MAX_PUBLIC_PATH_CHECKS,
} from "@/modules/outcome-verification/budgets";
import {
  outcomeProfileVersionFor,
  type ExpectedOutcome,
  type OutcomeCheck,
  type OutcomeProfile,
} from "@/modules/outcome-verification/schema";
import { excludedSurfacePrefixes, selectSitemapRoutes } from "./generators/route-classification";
import type { ExecutionCapability } from "./schema";

/**
 * Outcome contracts belong to execution capabilities (Sprint 12A §4, §5).
 *
 * ## Why this file is here and not in the measurement module
 *
 * The tempting implementation is a measurement service containing
 * `if (capability === "seo") fetch("/robots.txt")`. It is also the version that
 * rots: the day a second capability exists, that service becomes a switch
 * statement that knows the intimate details of every generator and is updated
 * by nobody when a generator changes.
 *
 * The capability that knows what it wrote is the only thing entitled to say
 * what it expects to see. So the contract is derived here, from **the same
 * classification the generator itself used** — `selectSitemapRoutes` and
 * `excludedSurfacePrefixes` are the generator's own functions, not a second
 * opinion about what it probably emitted.
 *
 * That coupling is the point. If the generator's route selection changes, this
 * contract changes with it, in the same commit, or the shared test breaks.
 *
 * ## What never influences a contract
 *
 * No model. Not before the merge, not after it (§4). An AI that invented
 * success criteria post-hoc would be marking its own homework, and the criteria
 * would drift with every prompt revision. These expectations are a pure function
 * of `(capability, origin, structured routes)`.
 *
 * Nor does anything fetched from the customer's website. The observation reads
 * pages; the *expectations* are fixed before a single request is made (§9), so
 * a page cannot talk the verifier into expecting what it happens to contain
 * (CLAUDE.md rules 25, 36).
 */

/**
 * Which capabilities have a deterministic verifier (§10).
 *
 * A `Record` over the closed capability union rather than a lookup with a
 * default, so adding a capability without deciding whether it can be verified
 * is a type error rather than a silent `outcome_not_supported` in production.
 *
 * Both SEO capability versions map to the same profile deliberately. v1 and v2
 * differ in *which routes* they put in a sitemap, not in what a sitemap is —
 * and the contract derives the route lists from the capability's own
 * classification anyway, so v1's historical commit is described correctly by
 * the same profile.
 */
const CAPABILITY_OUTCOME_PROFILES: Record<ExecutionCapability, OutcomeProfile | null> = {
  nextjs_seo_foundations_v1: "nextjs_seo_foundations_outcome_v1",
  nextjs_seo_foundations_v2: "nextjs_seo_foundations_outcome_v1",
  /**
   * Agentic execution has no deterministic verifier, and cannot have a generic
   * one.
   *
   * A verifier answers "is the thing this change was supposed to do actually
   * true in production now?" — and it can only do that because it knows what
   * the change was: the SEO profile checks that `/robots.txt` and
   * `/sitemap.xml` are served, because that is what the generator emitted.
   *
   * An agent-produced change has no such fixed shape by design (§3), so any
   * profile here would either be a lie about what was verified or a check so
   * generic ("the site still responds") that reporting it as outcome
   * verification would be worse than reporting nothing. Null is the honest
   * answer, and it resolves to the existing `outcome_not_supported`.
   */
  agentic_execution_v1: null,
};

export function outcomeProfileForCapability(capability: string): OutcomeProfile | null {
  return CAPABILITY_OUTCOME_PROFILES[capability as ExecutionCapability] ?? null;
}

export type OutcomeContractInput = {
  capability: string;
  /** Server-resolved public origin, no trailing slash. Never client-supplied. */
  publicOrigin: string;
  /**
   * Structured route intelligence for the commit that was merged.
   *
   * The same input the generator consumed. Null when the snapshot behind the
   * prepared change is no longer resolvable, which is a refusal rather than a
   * reason to guess — see `outcome_expectation_unavailable`.
   */
  repository: RepositoryIntelligenceSnapshot | null;
};

export type OutcomeContractResolution =
  | { supported: true; expected: ExpectedOutcome }
  | { supported: false; reason: "outcome_not_supported" | "outcome_expectation_unavailable" };

/**
 * The expected public behaviour of `nextjs_seo_foundations_*`.
 *
 * Read against `generators/nextjs-seo-foundations.ts`, which emits exactly two
 * Next.js App Router metadata routes:
 *
 * ```
 * <appRoot>/robots.ts    → served at /robots.txt, naming <origin>/sitemap.xml
 * <appRoot>/sitemap.ts   → served at /sitemap.xml, listing <origin> plus
 *                          selectSitemapRoutes(routes)
 * ```
 *
 * So the observable consequences are: both endpoints answer, robots points at
 * the sitemap, the sitemap parses and contains the site root, it contains the
 * public routes the generator selected, and it contains **nothing under a
 * private surface prefix**.
 *
 * ## What is deliberately not expected
 *
 * **robots.txt disallowing `/login`.** The generator does not emit that, on
 * purpose and with a comment explaining why — omitting a route from a sitemap
 * says "we are not asking you to index this", while a robots `disallow` says
 * "do not fetch this at all", and conflating them breaks link previews and
 * verification flows. Expecting it here would fail a correct product.
 *
 * **An exact sitemap URL count.** Production may legitimately be ahead of the
 * merged commit — somebody adds a marketing page the next day — and a verifier
 * that failed on that would be measuring staleness, not outcome.
 */
function seoFoundationsContract(input: OutcomeContractInput): OutcomeContractResolution {
  if (input.repository === null) {
    return { supported: false, reason: "outcome_expectation_unavailable" };
  }

  const routes = input.repository.routes.routes;

  const publicPaths = selectSitemapRoutes(routes).slice(0, MAX_PUBLIC_PATH_CHECKS);
  const allPrivatePrefixes = excludedSurfacePrefixes(routes);
  const privatePrefixes = allPrivatePrefixes.slice(0, MAX_PRIVATE_PREFIX_CHECKS);

  const checks: OutcomeCheck[] = [
    { kind: "robots_reachable", target: null, resource: "robots_txt" },
    { kind: "robots_declares_sitemap", target: null, resource: "robots_txt" },
    { kind: "sitemap_reachable", target: null, resource: "sitemap_xml" },
    { kind: "sitemap_parsed", target: null, resource: "sitemap_xml" },
    { kind: "sitemap_includes_public_root", target: "/", resource: "sitemap_xml" },
    ...publicPaths.map(
      (path): OutcomeCheck => ({ kind: "sitemap_includes_path", target: path, resource: "sitemap_xml" }),
    ),
    ...privatePrefixes.map(
      (prefix): OutcomeCheck => ({
        kind: "sitemap_excludes_private_prefix",
        target: prefix,
        resource: "sitemap_xml",
      }),
    ),
  ];

  return {
    supported: true,
    expected: {
      profile: "nextjs_seo_foundations_outcome_v1",
      profileVersion: outcomeProfileVersionFor("nextjs_seo_foundations_outcome_v1"),
      publicOrigin: input.publicOrigin.replace(/\/+$/, ""),
      // Two, and only two. Every check above reads one of these documents; the
      // site root is never fetched, because "is the homepage in the sitemap" is
      // a question about the sitemap, not about the homepage (§13).
      resources: ["robots_txt", "sitemap_xml"],
      checks,
      truncated:
        allPrivatePrefixes.length > privatePrefixes.length ||
        selectSitemapRoutes(routes).length > publicPaths.length,
    },
  };
}

/**
 * The expected outcome for one merged change, or a typed refusal.
 *
 * Deterministic: same capability, same origin, same routes → byte-identical
 * expectations. That is what makes the frozen snapshot in §9 meaningful, and
 * what makes an unsupported capability a stated refusal rather than an empty
 * check list that would classify as `verified` for free.
 */
export function resolveOutcomeContract(input: OutcomeContractInput): OutcomeContractResolution {
  const profile = outcomeProfileForCapability(input.capability);
  if (profile === null) return { supported: false, reason: "outcome_not_supported" };

  switch (profile) {
    case "nextjs_seo_foundations_outcome_v1":
      return seoFoundationsContract(input);
  }
}

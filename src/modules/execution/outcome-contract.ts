import type { RepositoryIntelligenceSnapshot } from "@/modules/repository-intelligence/schema";
import { usablePath } from "@/modules/execution-context/compiler";
import { resolveExecutionSurface } from "@/modules/execution-context/surface";
import {
  DEFAULT_OUTCOME_BUDGETS,
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
   * Agentic execution cannot have a verifier that knows what the change meant —
   * and it can have one that knows where the change landed (ADR 0071).
   *
   * The paragraph this replaces was right about the first half and drew the
   * wrong conclusion from it. A verifier answers "is the thing this change was
   * supposed to do actually true in production now?" only because the SEO
   * profile knows the generator emitted `/robots.txt` and `/sitemap.xml`. An
   * agent-produced change has no fixed shape by design (§3), so nothing here
   * can state what it was supposed to do.
   *
   * What Vibe does know, without asking the agent anything, is **which files
   * changed** (rule 77) and **which public URLs those files serve** at the
   * pinned commit. The intersection is a fact about the change, produced by two
   * of Vibe's own observations, and it is enough for one narrow question that
   * is worth asking after every merge: are those pages still being served?
   *
   * That is a much weaker claim than the SEO profile's, and the reason it is
   * worth making anyway is the failure direction. The most expensive thing this
   * pipeline can do is merge a change that takes a public page to a 500, and
   * until now the agentic path answered that with `outcome_not_supported`.
   *
   * The check so generic it would be worse than nothing — "the site still
   * responds" — is a different check, and this is not it: an unrelated backend
   * change resolves no public route and refuses with
   * `outcome_no_public_surface` rather than collecting a free green tick off
   * the homepage.
   */
  agentic_execution_v1: "agentic_public_routes_outcome_v1",
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
  /**
   * The paths Vibe verified as changed by this commit.
   *
   * From `prepared_changes.files`, which is Vibe's own filesystem comparison
   * rather than the agent's account of its work (rule 77). It is the only input
   * here that describes *this* change rather than the repository around it, and
   * it is why the agentic contract can be specific at all.
   */
  changedPaths: readonly string[];
};

export type OutcomeContractResolution =
  | { supported: true; expected: ExpectedOutcome }
  | {
      supported: false;
      reason:
        | "outcome_not_supported"
        | "outcome_expectation_unavailable"
        | "outcome_no_public_surface";
    };

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
 * The public routes one agent-produced change touched (ADR 0071).
 *
 * Two of Vibe's own observations, intersected, and nothing else:
 *
 * ```
 * prepared_changes.files          which files this commit changed  (rule 77)
 *          ∩
 * resolveExecutionSurface(...)    which public URL each file serves at the
 *                                 pinned commit, from the analyzer's route table
 * ```
 *
 * ## Why the route table and not the file paths
 *
 * Because `src/app/pricing/page.tsx` serves `/pricing` in one repository and
 * nothing at all in another. The analyzer already answered that question for
 * this specific repository at this specific commit, and reading its answer is
 * not a filename heuristic — it is the same input `review/classification.ts`
 * decides a visual review from, for the same reason.
 *
 * ## What is deliberately not covered
 *
 * A changed layout, component or stylesheet serves no route of its own, so it
 * resolves nothing and the change refuses with `outcome_no_public_surface`
 * rather than guessing which pages it reached. Under-claiming is the safe
 * direction here: a verifier that invented the affected pages would report on
 * pages the change never touched, and every green tick it produced would be
 * about somebody else's code.
 *
 * The split between public and authenticated comes from the resolver with
 * `live: null` — the repository's own structure, uncorroborated by a crawl.
 * Authenticated pages are never probed: an anonymous GET of one observes the
 * login screen, which is a fact about the login screen.
 */
function agenticPublicRoutesContract(input: OutcomeContractInput): OutcomeContractResolution {
  if (input.repository === null) {
    return { supported: false, reason: "outcome_expectation_unavailable" };
  }

  const surface = resolveExecutionSurface({
    snapshot: input.repository,
    // A live scan may only corroborate the public/authenticated split, and the
    // one behind this change is not pinned to the commit that was merged. The
    // repository is, so the repository decides alone.
    live: null,
    usablePath,
  });

  const changed = new Set(input.changedPaths);
  const allPaths = [
    ...new Set(
      surface.publicPages
        .filter((route) => changed.has(route.sourcePath))
        // A dynamic route is a template, not a page: `/app/projects/[projectId]`
        // is not a URL anybody can request, and requesting it literally would
        // observe a 404 and report it as the change having broken something.
        // The analyzer keeps the brackets in the path, so this is a fact about
        // the route rather than a guess about the file.
        .filter((route) => !route.path.includes("["))
        .map((route) => route.path),
    ),
  ].sort();

  // A backend-only change, or one whose route analysis came back `limited`.
  // Neither is a defect, and neither has a public page to look at.
  if (allPaths.length === 0) {
    return { supported: false, reason: "outcome_no_public_surface" };
  }

  const paths = allPaths.slice(0, DEFAULT_OUTCOME_BUDGETS.maxObservedRoutes);

  return {
    supported: true,
    expected: {
      profile: "agentic_public_routes_outcome_v1",
      profileVersion: outcomeProfileVersionFor("agentic_public_routes_outcome_v1"),
      publicOrigin: input.publicOrigin.replace(/\/+$/, ""),
      resources: ["public_route"],
      checks: paths.map(
        (path): OutcomeCheck => ({
          kind: "public_route_serves_page",
          target: path,
          resource: "public_route",
        }),
      ),
      truncated: allPaths.length > paths.length,
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
    case "agentic_public_routes_outcome_v1":
      return agenticPublicRoutesContract(input);
  }
}

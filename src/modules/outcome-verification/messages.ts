import type {
  OutcomeCheckKind,
  OutcomeCheckResult,
  OutcomeFailureCode,
  OutcomeProfile,
} from "./schema";

/**
 * User-facing copy for outcome verification (Sprint 12A §22, §23, §29–§34).
 *
 * One exhaustive record over each closed union, so a new code without copy is a
 * type error rather than a blank space where an explanation should be.
 *
 * ## The three sentences this file is most careful about
 *
 * **"Not observed" is not "deployment failed."** Vibe reads no deployment API
 * and has no provenance for which build is serving. All it can honestly say is
 * that the expected behaviour was not visible on the public product within the
 * window, and that it does not know why (§22, §34).
 *
 * **"Could not observe" is not "the product is broken."** A DNS failure, an
 * unsafe redirect or a rate limit are facts about Vibe's observation. The copy
 * for `failed` never characterises the customer's product (§23).
 *
 * **Verified is not business impact.** Every success surface repeats it,
 * because the moment a user sees a green tick after a merge is exactly the
 * moment they will assume more happened than did (§2, §30, §33).
 */
export const OUTCOME_FAILURE_MESSAGES: Record<OutcomeFailureCode, string> = {
  outcome_merge_required:
    "This change has not been merged, so there is no production outcome to check yet.",
  outcome_merge_unverified:
    "Vibe could not confirm that the default branch holds the approved commit, so it will not report on the production outcome of it.",

  // A statement about Vibe's coverage, never about the customer's product being
  // wrong — the same discipline `validation_not_supported` follows.
  outcome_not_supported:
    "Vibe cannot verify the production outcome of this kind of change yet.",

  // Not a defect and not a limitation of Vibe's coverage — the change simply
  // has no public page behind it, which is the ordinary shape of backend work.
  // Says what would have been looked at, so the sentence is informative rather
  // than a shrug.
  outcome_no_public_surface:
    "This change did not touch a page Vibe can find on your public site, so there is nothing public to check.",

  outcome_public_origin_unavailable:
    "Vibe needs a verified production URL for this project before it can check your public product.",
  outcome_expectation_unavailable:
    "Vibe no longer has the repository evidence this change was prepared from, so it cannot say what it should expect to see.",
  outcome_not_authorized: "You do not have permission to check outcomes in this project.",

  // §23. Says what Vibe could not do, and does not diagnose the site.
  outcome_origin_unreachable:
    "Vibe could not reach your public product while checking, so it could not verify the outcome.",
  outcome_unsafe_destination:
    "Checking your public product led somewhere Vibe will not follow, so it stopped without verifying the outcome.",

  outcome_execution_start_failed: "This check could not be queued. Try again in a moment.",
  outcome_persistence_failed: "The result of this check could not be saved.",
  outcome_verification_failed: "Vibe could not complete this check.",
};

export function outcomeFailureMessage(code: OutcomeFailureCode): string {
  return OUTCOME_FAILURE_MESSAGES[code];
}

/**
 * The label for one check (§30, §31).
 *
 * Written the way a person would describe the behaviour, not the way the domain
 * models it: "login excluded", not "sitemap_excludes_private_prefix:/login".
 * The check id is still stored, so support can always match a label back to the
 * expectation it answers.
 */
const CHECK_LABELS: Record<OutcomeCheckKind, (target: string | null) => string> = {
  robots_reachable: () => "robots.txt reachable",
  robots_declares_sitemap: () => "robots.txt points at the sitemap",
  sitemap_reachable: () => "sitemap.xml reachable",
  sitemap_parsed: () => "sitemap.xml is a valid sitemap",
  sitemap_includes_public_root: () => "homepage included in sitemap",
  sitemap_includes_path: (target) => `${target ?? "page"} included in sitemap`,
  sitemap_excludes_private_prefix: (target) => `${target ?? "private routes"} excluded from sitemap`,

  /**
   * Written as an observation, not as a verdict.
   *
   * "`/pricing` answers" is what happened. "`/pricing` works", "`/pricing` is
   * live" and "`/pricing` updated" are three things this check cannot tell
   * anybody, and each of them is what a reader would take from a green tick
   * unless the label refuses to say it.
   */
  public_route_serves_page: (target) => `${target ?? "page"} answers`,
};

export function outcomeCheckLabel(result: Pick<OutcomeCheckResult, "kind" | "target">): string {
  return CHECK_LABELS[result.kind](result.target);
}

/**
 * What `verified` means for one profile, in one sentence (ADR 0071).
 *
 * The card renders this beside every outcome, in every state, because the two
 * profiles verify genuinely different things and the surrounding copy —
 * "Production outcome verified" — reads identically for both.
 *
 * The agentic sentence gives away its own limit on purpose. A founder reading a
 * green tick after a merge will assume the change is live unless something in
 * front of them says otherwise, and Vibe reads no deployment API (§3, §34).
 */
export const OUTCOME_PROFILE_SCOPE_NOTES: Record<OutcomeProfile, string> = {
  nextjs_seo_foundations_outcome_v1:
    "Vibe checks the two files this change publishes — robots.txt and your sitemap — and what they say about your pages.",
  agentic_public_routes_outcome_v1:
    "Vibe checks that the pages this change touched are still being served. It cannot tell you whether the new version is the one serving them, and it does not read what is on the page.",
};

export function outcomeProfileScopeNote(profile: OutcomeProfile): string {
  return OUTCOME_PROFILE_SCOPE_NOTES[profile];
}

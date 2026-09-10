import type { ChangeHistoryEntry } from "@/modules/execution/change-history";

/**
 * The change history, as six rows a browser can look at (audit R29).
 *
 * One per outcome worth seeing beside the others, because the thing this table
 * has to get right is that they do not read alike. A merge that landed, a
 * write that stopped without an answer, a change somebody said no to, one
 * whose checks failed, one still waiting — and one whose Move is gone from the
 * latest opportunity set, which is the case that falls back to a branch name
 * rather than disappearing.
 *
 * Fixtures rather than a database, like every scenario here: what a browser
 * can prove is that the six states are distinguishable on screen. Whether
 * `changeHistoryOutcome` assigns them correctly is `change-history.test.ts`'s
 * question, against the rows a merge and an approval actually produce.
 */
export const E2E_CHANGE_HISTORY: readonly ChangeHistoryEntry[] = [
  {
    preparedChangeId: "change_6",
    createdAt: "2026-09-08T11:20:00.000Z",
    branchName: "vibe/pricing-section",
    branchUrl: "https://github.com/TobiB1505/Vibe-Business/tree/vibe/pricing-section",
    filesChanged: 4,
    opportunityId: "move-pricing",
    operationRunId: "run_6",
    outcome: "waiting",
  },
  {
    preparedChangeId: "change_5",
    createdAt: "2026-09-05T09:02:00.000Z",
    branchName: "vibe/social-preview",
    branchUrl: "https://github.com/TobiB1505/Vibe-Business/tree/vibe/social-preview",
    filesChanged: 3,
    opportunityId: "move-social",
    operationRunId: "run_5",
    outcome: "merged",
  },
  {
    preparedChangeId: "change_4",
    createdAt: "2026-09-01T16:41:00.000Z",
    branchName: "vibe/signup-copy",
    branchUrl: "https://github.com/TobiB1505/Vibe-Business/tree/vibe/signup-copy",
    filesChanged: 2,
    opportunityId: "move-signup",
    operationRunId: "run_4",
    outcome: "merge_stopped",
  },
  {
    preparedChangeId: "change_3",
    createdAt: "2026-08-27T10:44:00.000Z",
    branchName: "vibe/sitemap",
    branchUrl: "https://github.com/TobiB1505/Vibe-Business/tree/vibe/sitemap",
    filesChanged: 1,
    opportunityId: "move-seo",
    operationRunId: "run_3",
    outcome: "discarded",
  },
  {
    preparedChangeId: "change_2",
    createdAt: "2026-08-24T09:12:00.000Z",
    branchName: "vibe/checkout-guard",
    branchUrl: "https://github.com/TobiB1505/Vibe-Business/tree/vibe/checkout-guard",
    filesChanged: 6,
    opportunityId: "move-checkout",
    operationRunId: "run_2",
    outcome: "checks_failed",
  },
  {
    /* The Move is not in the latest set, and the preparation produced nothing.
       Two absences in one row: the branch name stands in for the title, and
       the file count is a dash rather than a zero. */
    preparedChangeId: "change_1",
    createdAt: "2026-08-20T16:03:00.000Z",
    branchName: "vibe/onboarding-empty-state",
    branchUrl: null,
    filesChanged: 0,
    opportunityId: "move-retired",
    operationRunId: "run_1",
    outcome: "failed",
  },
];

/** The titles the surface holds. `move-retired` is deliberately absent. */
export const E2E_CHANGE_HISTORY_MOVES: ReadonlyMap<string, string> = new Map([
  ["move-pricing", "Add a clear pricing section to your website"],
  ["move-social", "Give the landing page a proper social preview"],
  ["move-signup", "Say what happens after signup"],
  ["move-seo", "Fix missing technical SEO foundations"],
  ["move-checkout", "Stop the checkout losing people at the card step"],
]);

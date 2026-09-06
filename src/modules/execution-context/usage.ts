/**
 * Did the briefing help? — measured, never asserted (PART L, PART M).
 *
 * ## Why raw counts and nothing else
 *
 * The obvious next move after building a context compiler is to score it: a
 * "context hit rate", an "AI efficiency score", one number that goes up. Every
 * one of those is a ratio whose denominator is arguable, and a ratio nobody can
 * argue about the denominator of is a ratio nobody can act on. Worse, it would
 * be a number that looks measured and is not: reading a briefed file proves the
 * agent opened it, never that opening it was what made the change correct.
 *
 * So this produces integers a person can compare across two runs of the same
 * step, and stops. Whether run #4 was cheaper than run #3 is answered by the
 * cost the provider billed and the calls it took, both of which are already
 * recorded; these say *where the reading went*, which is the part the briefing
 * was supposed to change.
 *
 * ## The two questions worth asking
 *
 * - **Verified**: how much of the briefing did the agent actually open? A brief
 *   nothing was read from cost prompt bytes and bought nothing.
 * - **Expanded**: how far did it go beyond the briefing? Not a failure — the
 *   instruction explicitly tells it to go wider when the briefing does not
 *   cover what it needs — but the number that says whether "verify, do not
 *   rediscover" changed behaviour at all.
 *
 * Nothing here is evidence that a change is correct. Independent validation
 * decides that, and it does not read this file.
 */

export type ContextUsage = {
  /** File candidates the brief offered. */
  candidatesOffered: number;
  /** Of those, how many the agent opened at least once. */
  candidatesRead: number;
  /** Distinct paths read, briefed or not. */
  uniqueFilesRead: number;
  /** Reads that landed on a path already read. Re-reading is a real cost. */
  repeatedFileReads: number;
  /** Distinct paths read that the brief did not name. */
  filesReadOutsideContext: number;
  /**
   * Which offered candidates were never opened — the briefing's wasted half.
   *
   * In the brief's own rank order, so the first entry is the file Vibe was most
   * confident about and the agent ignored. That ordering is the signal: a
   * top-ranked candidate going unread says something a set does not.
   */
  unreadCandidates: readonly string[];
  /**
   * Which paths the agent needed and was not offered — the briefing's blind half.
   *
   * In the order they were first read, so the first entry is what the agent
   * reached for before anything else. Counting these was the old answer, and it
   * could say the briefing missed without ever saying what it missed; the
   * ranking that would fix it cannot be written from a number.
   */
  readOutsideContext: readonly string[];
  /**
   * Whether either list was cut to its bound (rule 27).
   *
   * A truncated list is still useful — these are inputs to a ranking, not a
   * ledger — but a consumer counting from the list rather than from the counts
   * beside it would be counting the bound.
   */
  pathsTruncated: boolean;
};

/**
 * How many paths each list carries.
 *
 * Paths are repository-controlled, and a run that read four hundred files would
 * otherwise write four hundred of them into a telemetry row. Generous against a
 * measured maximum of ten unique reads per run, and the counters beside the
 * lists stay exact whatever this cuts.
 */
export const MAX_USAGE_PATHS = 40;

/**
 * Counts one run's reading against what it was briefed with.
 *
 * Path comparison is exact. Normalising — case folding, trailing slashes,
 * resolving `.` segments — would let two different files count as one, and a
 * metric that quietly merges paths is worse than one that quietly splits them:
 * an over-count of `filesReadOutsideContext` says the briefing helped less than
 * it did, which is the direction an honest measurement should err in.
 */
export function summarizeContextUsage(input: {
  candidates: readonly string[];
  /** Every `file_read`, in order, including repeats. */
  readPaths: readonly string[];
}): ContextUsage {
  const candidates = new Set(input.candidates);

  const seen = new Set<string>();
  let repeatedFileReads = 0;

  for (const path of input.readPaths) {
    if (seen.has(path)) repeatedFileReads += 1;
    else seen.add(path);
  }

  let candidatesRead = 0;
  // Built in first-read order rather than from the `seen` set, because the
  // order is part of the answer: what the agent reached for first is the
  // strongest evidence about what the briefing should have led with.
  const readOutsideContext: string[] = [];
  const outside = new Set<string>();
  for (const path of input.readPaths) {
    if (candidates.has(path) || outside.has(path)) continue;
    outside.add(path);
    readOutsideContext.push(path);
  }

  for (const path of seen) {
    if (candidates.has(path)) candidatesRead += 1;
  }

  // In the brief's own order, which `rankCandidates` already decided. A
  // top-ranked candidate going unread is a different fact from a last-ranked
  // one going unread, and a set cannot tell them apart.
  const unreadCandidates = input.candidates.filter(
    (path, index) => !seen.has(path) && input.candidates.indexOf(path) === index,
  );

  return {
    candidatesOffered: candidates.size,
    candidatesRead,
    uniqueFilesRead: seen.size,
    repeatedFileReads,
    filesReadOutsideContext: outside.size,
    unreadCandidates: unreadCandidates.slice(0, MAX_USAGE_PATHS),
    readOutsideContext: readOutsideContext.slice(0, MAX_USAGE_PATHS),
    pathsTruncated:
      unreadCandidates.length > MAX_USAGE_PATHS || readOutsideContext.length > MAX_USAGE_PATHS,
  };
}

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
};

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
  let filesReadOutsideContext = 0;
  for (const path of seen) {
    if (candidates.has(path)) candidatesRead += 1;
    else filesReadOutsideContext += 1;
  }

  return {
    candidatesOffered: candidates.size,
    candidatesRead,
    uniqueFilesRead: seen.size,
    repeatedFileReads,
    filesReadOutsideContext,
  };
}

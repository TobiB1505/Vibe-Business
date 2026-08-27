/**
 * `Promise.all` with a ceiling on how many run at once (VB-023, VB-024).
 *
 * Two read models fan out per prepared change, and each branch can reach GitHub.
 * A plain `Promise.all(items.map(…))` overlaps the work — which is the point —
 * and overlaps it without limit, which is how a project with thirty prepared
 * changes turns one page render into thirty simultaneous GitHub calls and meets
 * a secondary rate limit.
 *
 * Results come back in **input order** regardless of completion order, so this
 * is a drop-in for both a sequential loop and an unbounded `Promise.all`. That
 * matters: these lists are what a founder reads, and a card moving because one
 * call was slow is its own defect.
 *
 * A rejection propagates, exactly as `Promise.all` does — no failure is
 * swallowed to keep the rest of the list rendering.
 */
export async function mapWithConcurrency<In, Out>(
  items: readonly In[],
  limit: number,
  run: (item: In) => Promise<Out>,
): Promise<Out[]> {
  const results = new Array<Out>(items.length);
  let next = 0;

  const workers = Array.from({ length: Math.min(Math.max(limit, 1), items.length) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await run(items[index]);
    }
  });

  await Promise.all(workers);
  return results;
}

/**
 * How many per-change branches may be in flight at once.
 *
 * Above any render time that matters and below anything GitHub objects to. One
 * number, shared, so the two read models cannot drift into disagreeing about
 * what is safe.
 */
export const PER_CHANGE_CONCURRENCY = 6;

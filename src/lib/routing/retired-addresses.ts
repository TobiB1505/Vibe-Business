/**
 * The workspace addresses people still have (PERF-023).
 *
 * UI-2 Part 2 split one project page into seven routes and CORE-5 renamed what
 * those sections are. Bookmarks and pasted links did not get renamed with
 * them: Web Analytics still shows traffic to three of the old addresses, and
 * every one of them answers 404 — on the way back into a product somebody had
 * already used.
 *
 * ## Why a module rather than a literal in `next.config.ts`
 *
 * So the destinations can be checked against the sections that actually exist.
 * A rename that moves a section and leaves this behind sends people from a 404
 * to a different 404, which is worse than where they started, and nothing
 * about either file would look wrong. `next.config.ts` itself cannot be loaded
 * outside a Next build — its plugin wrappers resolve to nothing — so a table
 * that lives only there is a table nothing can assert.
 *
 * ## Only the three with traffic behind them
 *
 * `/moves`, `/impact`, `/deep-scan` and `/activity` were renamed in the same
 * sprint. Nobody asks for them, so nothing here claims to know they need
 * answering (rule 15).
 *
 * `/health` is not a retired address. It is a kept alias with a page of its
 * own, deliberately — see `health/page.tsx`.
 */

/** Old segment → the section segment that replaced it. Empty means the index. */
export const RETIRED_WORKSPACE_ADDRESSES: readonly { from: string; to: string }[] = [
  /** The score page became the project's own index (UI-11). */
  { from: "score", to: "" },
  /** Prepared changes became the Agent workspace's five stages. */
  { from: "prepared", to: "agent" },
  /** Product understanding became My Product. */
  { from: "understanding", to: "product" },
];

export type RouteRedirect = { source: string; destination: string; permanent: boolean };

/**
 * Temporary, not permanent, every one of them.
 *
 * A 308 is cached by the browser indefinitely, which would settle a routing
 * decision in other people's caches rather than in this file.
 */
export function retiredAddressRedirects(): RouteRedirect[] {
  const base = "/app/projects/:projectId";

  return RETIRED_WORKSPACE_ADDRESSES.map(({ from, to }) => ({
    source: `${base}/${from}`,
    destination: to === "" ? base : `${base}/${to}`,
    permanent: false,
  }));
}

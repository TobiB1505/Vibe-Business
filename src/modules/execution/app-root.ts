import type { RepositoryIntelligenceSnapshot } from "@/modules/repository-intelligence/schema";

/**
 * Where an App Router project's metadata routes belong (Sprint 9 §9).
 *
 * Returns null rather than guessing. "Do not write to the wrong package" is
 * the requirement, and a wrong app root means writing `robots.ts` into a
 * package that does not serve it — a file that looks correct in review and
 * does nothing in production.
 *
 * Ambiguity blocks (§9): a repository with several application roots is a real
 * case and a future capability, and resolving it by picking the first match
 * would be a guess wearing a resolver's clothes. That rule has not moved — it
 * is now enforced by the detector, which is the layer that can see all of them.
 *
 * ## Why this reads a recorded value now
 *
 * It used to re-derive the root with `^((?:src/)?app)/` over the route source
 * paths, which quietly built in the assumption that an application sits at the
 * repository root: for one in `frontend/`, nothing matched and the answer was
 * null. The analyzer records the directory it actually read the routes from, so
 * there is nothing left to reconstruct.
 *
 * The fallback is for snapshots written before `repo-intelligence-v6`, which
 * carry no recorded root. Deriving theirs the old way is not a compromise —
 * that analysis only ever looked at the repository root, so the old derivation
 * is the correct reading of the data it produced.
 */
export function resolveAppRoot(snapshot: RepositoryIntelligenceSnapshot): string | null {
  if (snapshot.routes.mode !== "app_router") return null;
  if (snapshot.routes.root !== undefined) return snapshot.routes.root;

  const roots = new Set<string>();
  for (const route of snapshot.routes.routes) {
    const match = /^((?:src\/)?app)\//.exec(route.sourcePath);
    if (match) roots.add(`${match[1]}/`);
  }

  return roots.size === 1 ? [...roots][0] : null;
}

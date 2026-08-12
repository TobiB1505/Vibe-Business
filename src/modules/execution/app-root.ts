import type { RepositoryIntelligenceSnapshot } from "@/modules/repository-intelligence/schema";

/**
 * Where an App Router project's metadata routes belong (Sprint 9 §9).
 *
 * Returns null rather than guessing. "Do not write to the wrong package" is
 * the requirement, and a wrong app root means writing `robots.ts` into a
 * package that does not serve it — a file that looks correct in review and
 * does nothing in production.
 *
 * Only the two unambiguous single-app layouts are supported. A monorepo with
 * several app roots is a real case and a future capability; resolving it by
 * picking the first match would be a guess wearing a resolver's clothes.
 */
export function resolveAppRoot(snapshot: RepositoryIntelligenceSnapshot): string | null {
  if (snapshot.routes.mode !== "app_router") return null;

  const sources = snapshot.routes.routes.map((route) => route.sourcePath);
  const roots = new Set<string>();

  for (const source of sources) {
    const match = /^((?:src\/)?app)\//.exec(source);
    if (match) roots.add(`${match[1]}/`);
  }

  // Exactly one, or nothing. Ambiguity blocks (§9).
  return roots.size === 1 ? [...roots][0] : null;
}

/**
 * Whether a path is a Next.js App Router route segment file.
 *
 * ## Why this is its own module
 *
 * It is one regex, and it could live in `render-impact.ts` beside the rule it
 * guards. It does not, for a specific reason: `render-impact.ts` imports the
 * TypeScript compiler (~9 MB), and `classification-inputs.ts` needs to ask this
 * question *before* deciding whether to load that module at all. Importing the
 * predicate from there would drag the compiler in eagerly and defeat the
 * dynamic import entirely.
 *
 * `next.config.ts` records what a large package loaded eagerly on a rendered
 * page cost this product once already. One small file is the cheap way not to
 * repeat it.
 *
 * ## Why the answer matters
 *
 * The framework guarantee `render-impact.ts` relies on — that `metadata` and
 * the route segment config exports never enter the element tree — holds
 * *because Next reads those exports from a route segment*. In an ordinary
 * component, `export const metadata` is just a constant that could perfectly
 * well feed the JSX beside it. So this predicate is not a filter for
 * convenience; it is the precondition that makes the analysis sound.
 */

/**
 * Both repository layouts are accepted — `src/app/` and a root-level `app/` —
 * the same way `execution/app-root.ts` accepts either. `api/` is excluded for
 * the reason `classification.ts` already gives about its own renderable set: a
 * `.tsx` under an API route would be a surprising thing to reason about.
 */
const ROUTE_SEGMENT_PATTERN = /^(?:src\/)?app\/(?!api\/)(?:.*\/)?(?:page|layout)\.tsx$/i;

export function isRenderImpactCandidate(path: string): boolean {
  return ROUTE_SEGMENT_PATTERN.test(path);
}

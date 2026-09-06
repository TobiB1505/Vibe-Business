import type { ProfileResolution } from "./profile";
import { CURRENT_VALIDATION_PROFILE } from "./schema";

/**
 * Applying the founder's answer to "which application?" (Stufe 4).
 *
 * ## This function never builds a path
 *
 * It matches the stored answer against the candidates Vibe computed, by exact
 * string equality, and returns one of them. It does not join, normalize,
 * resolve, trim or repair — because every one of those is a way for a value
 * that is not a candidate to become one, and the next thing that happens to a
 * workspace root is that a sandbox runs a customer's build in it.
 *
 * That is why an answer of `"../secrets"` is refused: **not because a regex
 * caught it**, but because it is not in the list. The list came from build
 * targets Vibe derived from tree entries it read itself; nothing a founder
 * types can add to it. The path shape is checked as well, in the resolver and
 * again in the database, and neither of those is what makes this safe.
 *
 * ## A stored answer is a routing signal, never permission
 *
 * Repositories change. An application gets deleted, renamed, or restructured
 * into a workspace, and an answer that named it stops naming anything. Then
 * this asks again rather than reaching for the nearest surviving candidate —
 * rule 55, applied to a stored answer rather than to stored evidence.
 */

/**
 * Narrows a resolution using the founder's stored choice.
 *
 * @param chosenWorkspaceRoot the stored answer, or null when none was given.
 *
 * Can only ever narrow. A resolution that is already `supported` is returned
 * untouched whatever the second argument says: the founder's answer decides
 * *between* candidates, and there is nothing to decide when Vibe found one
 * application. A test pins that, because "narrows" is the whole safety claim.
 */
export function selectValidationTarget(
  resolution: ProfileResolution,
  chosenWorkspaceRoot: string | null,
): ProfileResolution {
  if (resolution.supported) return resolution;
  if (resolution.reason !== "workspace_choice_required") return resolution;
  if (chosenWorkspaceRoot === null) return resolution;

  const chosen = resolution.candidates?.find(
    (candidate) => candidate.workspaceRoot === chosenWorkspaceRoot,
  );

  // Not a candidate any more — the application moved, was removed, or the
  // answer was never one. Asking again is the honest move; picking the nearest
  // surviving candidate would run against something nobody chose.
  if (!chosen) return resolution;

  return {
    supported: true,
    profile: CURRENT_VALIDATION_PROFILE,
    packageManager: chosen.packageManager,
    workspaceRoot: chosen.workspaceRoot,
    installRoot: chosen.installRoot,
    frameworks: chosen.frameworks,
    moduleLinker: chosen.moduleLinker,
  };
}

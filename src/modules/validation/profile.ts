import type { RepositoryIntelligenceSnapshot } from "@/modules/repository-intelligence/schema";
import type { SupportedPackageManager, ValidationBlockReason, ValidationProfile } from "./schema";

/**
 * Which repositories Vibe is willing to validate (Sprint 10A §5).
 *
 * ## Refusing is the feature
 *
 * A validation profile is a promise: *these exact commands, in this exact
 * environment, mean this exact thing.* Supporting "most repositories" would
 * turn that into a guess, and a guessed command sequence produces a verdict
 * nobody should act on — a green tick that means "some commands exited zero"
 * is worse than no tick at all.
 *
 * So there is one profile, and everything else is `validation_not_supported`.
 * That is not a gap to close quickly; it is how the verdict keeps its meaning
 * while the supported set grows deliberately.
 *
 * ## Structure only
 *
 * Resolution reads the deterministic repository snapshot — frameworks, package
 * manager, workspace layout. It never reads an opportunity's title, problem
 * text or any other model output, for the same reason capability resolution
 * does not (Sprint 9 §7): **model wording is not a machine API.**
 */

export type ProfileResolution =
  | {
      supported: true;
      profile: ValidationProfile;
      packageManager: SupportedPackageManager;
      /** Repository-relative directory the commands run in. `.` for a single-app repo. */
      workspaceRoot: string;
    }
  | { supported: false; reason: ValidationBlockReason };

function detectsFramework(snapshot: RepositoryIntelligenceSnapshot, id: string): boolean {
  return snapshot.frameworks.some((framework) => framework.id === id);
}

export function resolveValidationProfile(
  snapshot: RepositoryIntelligenceSnapshot,
): ProfileResolution {
  // The generated commands are Next.js build commands. Another framework is a
  // different profile that does not exist yet, not a close-enough match.
  if (!detectsFramework(snapshot, "nextjs")) {
    return { supported: false, reason: "validation_not_supported" };
  }

  // Yarn and Bun are deliberately absent: each has its own lockfile semantics
  // and its own "locked install" flag, and getting either subtly wrong would
  // silently validate a dependency tree the lockfile did not describe.
  if (snapshot.packageManager !== "pnpm" && snapshot.packageManager !== "npm") {
    return { supported: false, reason: "validation_not_supported" };
  }

  const { monorepo } = snapshot.projectStructure;

  // A monorepo is not unsupported because it is complex — it is unsupported
  // because "which app did we just validate?" has no single answer, and
  // answering it by picking the first workspace is a guess (§5).
  if (monorepo.detected) {
    return { supported: false, reason: "ambiguous_workspace" };
  }
  if (monorepo.ambiguous) {
    return { supported: false, reason: "ambiguous_workspace" };
  }

  return {
    supported: true,
    profile: "nextjs_node_v1",
    packageManager: snapshot.packageManager,
    workspaceRoot: ".",
  };
}

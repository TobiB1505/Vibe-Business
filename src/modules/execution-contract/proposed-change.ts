import { checkWriteScope, type WriteScopeViolation } from "./policy";
import { containsCredentialMaterial } from "./secrets";
import type { ExecutionSpec } from "./spec";

/**
 * The bridge from agent output into the existing pipeline
 * (EXECUTION CORE-3 §31, §32).
 *
 * ## The rule
 *
 * > Do NOT build a second post-agent pipeline.
 *
 * Everything after an agent produces files already exists and is already
 * tested: `PreparedChange` records the branch and commit, `ValidationRun`
 * proves the bytes build, `ReviewArtifact` shows a human what changed,
 * `ChangeApproval` binds one person's yes to one exact commit, and safe merge
 * fast-forwards to that commit or refuses. Four sprints of safety semantics.
 *
 * So an agent does not get its own path to a repository. It produces a file
 * set; Vibe checks it against the compiled policy; and if it passes, the
 * existing change-preparation machinery writes the branch — deriving the ref
 * name, the commit message and every path deterministically, as Rule 57
 * requires and `execution/github-writer.ts` already does.
 *
 * ## Why the check is here and not in the agent
 *
 * §31: the agent's output is a proposal, Vibe's observation is authority. An
 * agent that says "I only changed two files" has made a claim; this function
 * counts them. The distinction is the same one `sandbox_validation_passed`
 * draws — a verdict means something because Vibe observed it, not because
 * something reported it.
 *
 * ## What Core-3 builds
 *
 * The type and the gate. Nothing calls it, because nothing produces a file set
 * yet. Core-4 supplies the producer, and it will find the acceptance criteria
 * already written down and already tested rather than inventing them under
 * deadline.
 */

/** One file an agent proposes to write in the isolated workspace. */
export type ProposedFile = {
  /** Repository-relative. Checked, never trusted. */
  path: string;
  /** The bytes the agent produced. Never persisted by this module. */
  content: string;
};

export const PROPOSED_CHANGE_REJECTIONS = [
  /** A changed path is outside the compiled write scope (§17, §18). */
  "forbidden_path",
  "too_many_files",
  "diff_too_large",
  /** Credential-shaped content appears in the produced bytes (§11, §30). */
  "secret_material_introduced",
  /** Nothing was produced. An empty change is not a change. */
  "no_files_produced",
] as const;
export type ProposedChangeRejection = (typeof PROPOSED_CHANGE_REJECTIONS)[number];

export type ProposedChangeAcceptance =
  | {
      accepted: true;
      /** Handed to the existing change-preparation path, unchanged. */
      files: readonly { path: string; content: string }[];
    }
  | {
      accepted: false;
      rejections: readonly ProposedChangeRejection[];
      /** Detail for the write-scope failures, so a report can name the path. */
      violations: readonly WriteScopeViolation[];
    };

/**
 * Whether a produced file set may enter the existing pipeline (§30, §32).
 *
 * Deterministic and total. Every rejection is collected rather than
 * short-circuited, because a run that failed three ways should be reported as
 * three problems — fixing one and rediscovering the next is how a repair loop
 * burns a budget.
 */
export function acceptProposedChange(
  spec: ExecutionSpec,
  files: readonly ProposedFile[],
): ProposedChangeAcceptance {
  const rejections: ProposedChangeRejection[] = [];

  if (files.length === 0) {
    return { accepted: false, rejections: ["no_files_produced"], violations: [] };
  }

  const scope = checkWriteScope(
    spec.policy,
    files.map((file) => ({ path: file.path, bytes: Buffer.byteLength(file.content, "utf8") })),
  );

  const violations = scope.ok ? [] : scope.violations;
  for (const violation of violations) {
    if (!rejections.includes(violation.kind)) rejections.push(violation.kind);
  }

  // A path check cannot catch a key pasted into an ordinary source file, so the
  // content is checked too. This is one of the preconditions the spec's
  // validation requirement names (`no_secret_material_introduced`), enforced
  // here rather than described somewhere hopeful.
  if (files.some((file) => containsCredentialMaterial(file.content))) {
    rejections.push("secret_material_introduced");
  }

  if (rejections.length > 0) return { accepted: false, rejections, violations };

  return {
    accepted: true,
    files: files.map((file) => ({ path: file.path, content: file.content })),
  };
}

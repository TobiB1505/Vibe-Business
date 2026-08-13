import type { PreviewCard } from "@/modules/change-preview/view";
import { PreviewPanel } from "./preview-panel";
import { ValidationPanel, type ValidationSummary } from "./validation-panel";

/**
 * Prepared changes as artifacts (Sprint 10A §44).
 *
 * ## Why this exists separately from the opportunity list
 *
 * A prepared change was originally only reachable through the opportunity that
 * motivated it, matched by an execution identity that includes the opportunity
 * *set* id. Regenerating opportunities therefore made every existing prepared
 * change vanish from the UI — while its branch and commit sat untouched in the
 * customer's repository.
 *
 * That is the wrong model. A prepared change is an artifact, not a view of
 * current advice, and validation asks a question about the artifact: *does this
 * commit build?* — which does not stop being answerable because the advice
 * moved on. The opportunity list still shows "Change prepared" where the two
 * line up; this section is what guarantees an artifact stays reachable when
 * they do not.
 */

export type PreparedChangeCard = {
  id: string;
  branchName: string;
  commitSha: string | null;
  baseBranch: string;
  filePaths: string[];
  createdAt: string;
  branchUrl: string | null;
  validation: ValidationSummary | null;
  /** Preview state, decided on the server. Never inferred from the fields above. */
  preview: PreviewCard;
  /**
   * The ValidatedArtifact a preview would restore, when one exists.
   *
   * Its id is the validation run that captured it. The client passes it back to
   * start a preview and can name nothing else — no snapshot, no sandbox, no
   * port, no command (§6).
   */
  validatedArtifactId: string | null;
};

export function PreparedChangesSection({
  projectId,
  changes,
}: {
  projectId: string;
  changes: PreparedChangeCard[];
}) {
  if (changes.length === 0) return null;

  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-medium text-zinc-100">Prepared changes</h2>
        <p className="text-sm text-zinc-500">
          Changes Vibe wrote to isolated branches. None has been merged or deployed.
        </p>
      </div>

      <ul className="space-y-4">
        {changes.map((change) => (
          <li key={change.id} className="space-y-3 rounded-lg border border-zinc-800 p-4">
            <div className="space-y-1">
              <p className="font-mono text-sm text-zinc-200">{change.branchName}</p>
              <p className="text-xs text-zinc-500">
                {change.commitSha ? `${change.commitSha.slice(0, 7)} on ${change.baseBranch}` : change.baseBranch}
                {" · "}
                {change.filePaths.length} file{change.filePaths.length === 1 ? "" : "s"}
              </p>
            </div>

            {/* Paths only. File contents live on the branch, never in our rows. */}
            <ul className="space-y-0.5">
              {change.filePaths.map((path) => (
                <li key={path} className="font-mono text-xs text-zinc-500">
                  {path}
                </li>
              ))}
            </ul>

            {change.branchUrl && (
              <a
                href={change.branchUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-block text-sm text-zinc-300 underline underline-offset-2 hover:text-zinc-50"
              >
                Open branch on GitHub
              </a>
            )}

            <ValidationPanel
              projectId={projectId}
              preparedChangeId={change.id}
              summary={change.validation}
              runningOperation={null}
            />

            {/* Below validation, deliberately: a preview restores what a
                validation produced, so the order on screen is the order of the
                gates. There is no Merge, Deploy or Approve button here or
                anywhere — none of those exist. */}
            <PreviewPanel
              projectId={projectId}
              preparedChangeId={change.id}
              card={change.preview}
              validatedArtifactId={change.validatedArtifactId}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

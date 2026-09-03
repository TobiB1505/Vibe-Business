import { Notice } from "@/components/ui/states";
import type { WorkspaceCandidate } from "@/modules/validation/profile";

/**
 * "Which app should Vibe work on?", asked once (Stufe 4).
 *
 * ## Why this is presentational and takes a plain list
 *
 * The same reason `AgentStartRefusalNotice` is: a component that binds a server
 * action to a real project cannot be mounted in the fixture harness, and this
 * question is exactly the state that has to be provable in a browser. A
 * repository with two applications is not something the founder's own projects
 * can produce on demand.
 *
 * ## Why every option is a button and none is a text field
 *
 * A workspace root becomes the directory a sandbox runs a customer's build in.
 * `selectValidationTarget` only ever matches an answer against the candidates
 * Vibe derived from tree entries it read itself, so a typed path could never
 * become one — but the absence of a field is the property made visible, and a
 * browser test asserts that absence rather than trusting the sentence above it.
 *
 * The list itself is repository-derived and therefore untrusted data (rule 25):
 * directory names and framework ids are rendered as text, never interpolated
 * into a href, a class, or anything a browser would execute.
 */
export function AgentWorkspaceChoice({
  candidates,
  action,
  chosen = null,
  error = null,
}: {
  /** The applications Vibe found. Never empty when this renders. */
  candidates: readonly WorkspaceCandidate[];
  /** One submit control per candidate, built by the route that owns the action. */
  action: (candidate: WorkspaceCandidate) => React.ReactNode;
  /** The application already chosen, when the founder is changing their mind. */
  chosen?: string | null;
  error?: string | null;
}) {
  return (
    <div data-testid="agent-workspace-choice" className="flex flex-col gap-3">
      <Notice
        tone="info"
        label="which app?"
        footnote="Choosing is free and you can change it later. Nothing starts running."
      >
        This repository holds more than one app. Vibe builds and checks one of them — tell it which.
      </Notice>

      <ul className="flex flex-col gap-2">
        {candidates.map((candidate) => (
          <li
            key={candidate.workspaceRoot}
            data-testid="agent-workspace-candidate"
            data-chosen={candidate.workspaceRoot === chosen ? "true" : undefined}
            className="border-edge flex items-center justify-between gap-4 rounded-md border px-3 py-2"
          >
            <div className="min-w-0">
              <p className="text-fg font-mono text-sm">{candidate.workspaceRoot}</p>
              <p className="text-fg-prose text-xs">
                {[candidate.packageManager, ...candidate.frameworks].join(" · ")}
              </p>
            </div>
            {action(candidate)}
          </li>
        ))}
      </ul>

      {error ? (
        <div data-testid="agent-workspace-choice-error">
          <Notice tone="problem" label="not recorded">
            {error}
          </Notice>
        </div>
      ) : null}
    </div>
  );
}

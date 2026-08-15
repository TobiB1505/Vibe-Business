"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { inspectRepositoryAction, type InspectActionState } from "./inspect-action";
import type { InspectFailureCode } from "@/modules/repository-intelligence/service";

/**
 * User-facing copy for every typed failure. Raw GitHub responses never
 * reach the browser (Sprint 2 §33); the permission case in particular
 * gets an actionable message rather than a generic error
 * (Sprint 2 §1, §25).
 */
const ERROR_MESSAGES: Record<InspectFailureCode, string> = {
  project_not_found: "This project could not be found.",
  repository_not_connected: "No repository is connected to this project.",
  already_running: "An inspection is already running for this commit. Give it a moment.",
  repository_not_found: "This repository is no longer reachable on GitHub.",
  github_access_revoked: "GitHub access was revoked. Reconnect GitHub to continue.",
  github_contents_permission_required:
    "Vibe Business needs read-only access to repository contents to inspect this project.",
  repository_empty: "This repository has no commits yet, so there is nothing to inspect.",
  github_rate_limited: "GitHub is rate limiting requests right now. Try again in a few minutes.",
  github_api_error: "GitHub could not be reached. Try again in a moment.",
  analysis_failed: "Repository inspection could not be completed.",
};

const initialState: InspectActionState = null;

export function InspectButton({
  projectId,
  hasSnapshot,
}: {
  projectId: string;
  hasSnapshot: boolean;
}) {
  const action = inspectRepositoryAction.bind(null, projectId);
  const [state, formAction, pending] = useActionState(action, initialState);

  const permissionProblem = state && !state.ok && state.error === "github_contents_permission_required";

  return (
    <div className="space-y-3">
      <form action={formAction} className="flex items-center gap-3">
        {/* A refresh on an unchanged commit would otherwise reuse the
            stored snapshot and appear to do nothing. */}
        <input type="hidden" name="force" value={hasSnapshot ? "true" : "false"} />
        <Button type="submit" disabled={pending}>
          {pending ? "Inspecting…" : hasSnapshot ? "Refresh repository intelligence" : "Inspect repository"}
        </Button>
      </form>

      {state && !state.ok && (
        <div className="space-y-2">
          <p className="text-sm text-amber">{ERROR_MESSAGES[state.error]}</p>
          {permissionProblem && (
            <a
              href="https://github.com/settings/installations"
              target="_blank"
              rel="noreferrer"
              className="inline-block text-sm text-fg-prose underline underline-offset-2 hover:text-fg"
            >
              Update GitHub access
            </a>
          )}
        </div>
      )}

      {state?.ok && state.reused && (
        <p className="text-sm text-fg-muted">
          Already up to date — the latest commit was inspected before.
        </p>
      )}
    </div>
  );
}

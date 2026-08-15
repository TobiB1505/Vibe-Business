"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { TechnicalDetails } from "@/components/ui/disclosure";
import { inspectRepositoryAction, type InspectActionState } from "./inspect-action";
import type { InspectFailureCode } from "@/modules/repository-intelligence/service";

/**
 * Reading the code, and saying so in the customer's words (Sprint UI-3.6
 * §31/§32/§35).
 *
 * The control used to say "Inspect repository", and a failure used to say
 * `github_contents_permission_required` in a sentence about repository
 * contents. Both were true and both assumed the reader thinks in repositories.
 *
 * Every failure now leads with what happened to *them*, follows with what to do
 * about it, and keeps the failure code itself in the technical layer — raw
 * GitHub responses still never reach the browser (Sprint 2 §33).
 */

type FailureCopy = {
  /** What happened, in one sentence, from the reader's point of view. */
  title: string;
  /** What to do about it. Omitted when there is nothing useful to say. */
  guidance?: string;
};

const FAILURES: Record<InspectFailureCode, FailureCopy> = {
  project_not_found: { title: "Vibe couldn't find this project." },
  repository_not_connected: {
    title: "There is no code connected to this project yet.",
    guidance: "Connect a repository and Vibe can read it.",
  },
  already_running: {
    title: "Vibe is already reading this version of your code.",
    guidance: "Give it a moment and the result will appear here.",
  },
  repository_not_found: {
    title: "Vibe couldn't reach your code any more.",
    guidance: "The project may have been renamed, moved or deleted on GitHub.",
  },
  github_access_revoked: {
    title: "Vibe no longer has access to your code.",
    guidance: "Reconnect GitHub to let Vibe read it again.",
  },
  github_contents_permission_required: {
    title: "Vibe couldn't read your code.",
    guidance: "Check that the GitHub connection still has read access to this project.",
  },
  repository_empty: {
    title: "There is no code here yet.",
    guidance: "Vibe reads what has been committed, and this project has nothing in it so far.",
  },
  github_rate_limited: {
    title: "GitHub is asking Vibe to slow down.",
    guidance: "Try again in a few minutes — nothing is wrong with your project.",
  },
  github_api_error: {
    title: "Vibe couldn't reach GitHub.",
    guidance: "Try again in a moment.",
  },
  analysis_failed: {
    title: "Vibe couldn't finish understanding your product.",
    guidance: "Anything it had already worked out is still shown above.",
  },
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

  const failure = state && !state.ok ? FAILURES[state.error] : null;
  const permissionProblem =
    state && !state.ok &&
    (state.error === "github_contents_permission_required" || state.error === "github_access_revoked");

  return (
    <div className="flex flex-col gap-3">
      <form action={formAction} className="flex items-center gap-3">
        {/* A refresh on an unchanged commit would otherwise reuse the
            stored snapshot and appear to do nothing. */}
        <input type="hidden" name="force" value={hasSnapshot ? "true" : "false"} />
        <Button type="submit" disabled={pending}>
          {/* No developer operations, and no invented progress: the work is
              one bounded synchronous analysis, so this says what is happening
              rather than pretending to phases the backend does not report. */}
          {pending
            ? "Vibe is understanding your product…"
            : hasSnapshot
              ? "Check the code again"
              : "Understand my product"}
        </Button>
      </form>

      {state && !state.ok && failure && (
        <div className="flex flex-col gap-2">
          <p className="text-amber text-sm font-semibold">{failure.title}</p>
          {failure.guidance && <p className="text-fg-prose max-w-[70ch] text-sm">{failure.guidance}</p>}
          {permissionProblem && (
            <a
              href="https://github.com/settings/installations"
              target="_blank"
              rel="noreferrer"
              className="text-fg-prose hover:text-fg w-fit rounded-sm text-sm underline underline-offset-4"
            >
              Reconnect GitHub
            </a>
          )}
          {/* The exact reason, for whoever needs it. Never the leading text. */}
          <TechnicalDetails entries={[{ key: "failureCode", value: state.error }]} />
        </div>
      )}

      {state?.ok && state.reused && (
        <p className="text-fg-muted text-sm">
          Nothing has changed in your code since Vibe last read it.
        </p>
      )}
    </div>
  );
}

"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { TechnicalDetails } from "@/components/ui/disclosure";
import type { InspectLiveFailureCode } from "@/modules/live-product-intelligence/service";
import type { InspectFailureCode } from "@/modules/repository-intelligence/service";
import { runProductScanAction, type ProductScanState } from "./product-scan-action";

/**
 * The one Product Scan control (Stage D).
 *
 * Replaces the per-module pair ("Inspect repository" / "Inspect live
 * product"). The failure copy is carried over verbatim from both: every
 * failure leads with what happened to the *founder*, follows with what to do,
 * and keeps the code itself in the technical layer — raw GitHub responses and
 * raw network errors still never reach the browser.
 */

type FailureCopy = {
  /** What happened, in one sentence, from the reader's point of view. */
  title: string;
  /** What to do about it. Omitted when there is nothing useful to say. */
  guidance?: string;
};

const REPOSITORY_FAILURES: Record<InspectFailureCode, FailureCopy> = {
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
    title: "Vibe couldn't finish reading your code.",
    guidance: "Anything it had already worked out is still shown above.",
  },
};

/**
 * The live half failing does not undo the repository half: the scan keeps
 * what it read, and this copy says which part stopped and why.
 */
const LIVE_FAILURES: Record<InspectLiveFailureCode, FailureCopy> = {
  project_not_found: { title: "Vibe couldn't find this project." },
  production_url_not_set: {
    title: "There is no website set for this product yet.",
    guidance: "Add your production URL in Settings and the scan will visit it too.",
  },
  invalid_production_url: {
    title: "The saved website address is no longer valid.",
    guidance: "Update it in Settings and scan again.",
  },
  unsafe_destination: {
    title: "That address resolves to a private network, so Vibe won't visit it.",
  },
  dns_resolution_failed: {
    title: "Vibe couldn't find your website's domain.",
    guidance: "Check the address is correct and the site is live.",
  },
  homepage_unreachable: {
    title: "Vibe read your code, but couldn't reach your website.",
    guidance: "Check the site is online and scan again.",
  },
  tls_error: {
    title: "Your website's HTTPS certificate could not be verified.",
  },
  too_many_redirects: { title: "Your website redirected too many times." },
  unsupported_content_type: { title: "That address did not return a web page." },
  page_too_large: { title: "Your homepage is too large for Vibe to read." },
  crawl_budget_reached: {
    title: "Vibe reached its visiting limit before it could finish your site.",
  },
  site_rate_limited: {
    title: "Your site asked Vibe to slow down.",
    guidance: "Try again in a few minutes.",
  },
  site_forbidden: {
    title: "Your site refused Vibe's visit.",
    guidance: "It may be blocking automated visitors.",
  },
  already_running: {
    title: "Vibe is already visiting your product.",
    guidance: "Give it a moment and the result will appear here.",
  },
  analysis_failed: {
    title: "Vibe read your code, but couldn't finish looking at your website.",
    guidance: "Anything it had already seen is still shown above.",
  },
};

const initialState: ProductScanState = null;

export function ProductScanButton({
  projectId,
  hasSnapshot,
}: {
  projectId: string;
  /** Whether any source has been read before — decides label and force. */
  hasSnapshot: boolean;
}) {
  const action = runProductScanAction.bind(null, projectId);
  const [state, formAction, pending] = useActionState(action, initialState);

  const failure =
    state && !state.ok
      ? state.step === "repository"
        ? REPOSITORY_FAILURES[state.error]
        : LIVE_FAILURES[state.error]
      : null;
  const permissionProblem =
    state &&
    !state.ok &&
    state.step === "repository" &&
    (state.error === "github_contents_permission_required" ||
      state.error === "github_access_revoked");

  return (
    <div className="flex flex-col gap-3">
      <form action={formAction} className="flex items-center gap-3">
        {/* A re-scan on unchanged sources would otherwise reuse the stored
            snapshots and appear to do nothing. */}
        <input type="hidden" name="force" value={hasSnapshot ? "true" : "false"} />
        <Button type="submit" disabled={pending} busy={pending}>
          {pending
            ? "Vibe is scanning your product…"
            : hasSnapshot
              ? "Scan my product again"
              : "Scan my product"}
        </Button>
      </form>

      {failure && (
        <div className="flex flex-col gap-2">
          <p className="text-amber text-sm font-semibold">{failure.title}</p>
          {failure.guidance && (
            <p className="text-fg-prose max-w-[70ch] text-sm">{failure.guidance}</p>
          )}
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
          {state && !state.ok && (
            <TechnicalDetails
              entries={[
                { key: "step", value: state.step },
                { key: "failureCode", value: state.error },
              ]}
            />
          )}
        </div>
      )}

      {state?.ok && state.repositoryReused && state.liveReused !== false && (
        <p className="text-fg-muted text-sm">
          Nothing has changed since Vibe last scanned your product.
        </p>
      )}
    </div>
  );
}

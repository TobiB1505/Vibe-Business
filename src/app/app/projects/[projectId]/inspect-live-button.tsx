"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import type { InspectLiveFailureCode } from "@/modules/live-product-intelligence/service";
import { inspectLiveProductAction, type InspectLiveActionState } from "./inspect-live-action";

/**
 * User-facing copy for every typed failure (Sprint 3 §32).
 *
 * Raw network errors, TLS messages and upstream response bodies never
 * reach the browser — those describe internal infrastructure, which is
 * exactly what an SSRF probe would be fishing for.
 */
const ERROR_MESSAGES: Record<InspectLiveFailureCode, string> = {
  project_not_found: "This project could not be found.",
  production_url_not_set: "Add a production URL before inspecting the live product.",
  invalid_production_url: "The saved production URL is no longer valid. Update it and try again.",
  unsafe_destination: "That address resolves to a private network and cannot be inspected.",
  dns_resolution_failed: "The domain could not be resolved. Check the address is correct and live.",
  homepage_unreachable: "The homepage could not be reached. Check the site is online.",
  tls_error: "The site's HTTPS certificate could not be verified.",
  too_many_redirects: "The site redirected too many times.",
  unsupported_content_type: "That address did not return a web page.",
  page_too_large: "The homepage is too large to inspect.",
  crawl_budget_reached: "The inspection limit was reached before the site could be analysed.",
  site_rate_limited: "The site rate-limited our requests. Try again in a few minutes.",
  site_forbidden: "The site refused our request. It may be blocking automated visitors.",
  already_running: "An inspection is already running for this project. Give it a moment.",
  analysis_failed: "Live product inspection could not be completed.",
};

const initialState: InspectLiveActionState = null;

export function InspectLiveButton({
  projectId,
  hasSnapshot,
}: {
  projectId: string;
  hasSnapshot: boolean;
}) {
  const action = inspectLiveProductAction.bind(null, projectId);
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <div className="space-y-3">
      <form action={formAction} className="flex items-center gap-3">
        {/* Without this a refresh inside the freshness window would reuse
            the stored snapshot and appear to do nothing. */}
        <input type="hidden" name="force" value={hasSnapshot ? "true" : "false"} />
        <Button type="submit" disabled={pending} busy={pending}>
          {pending ? "Inspecting…" : hasSnapshot ? "Refresh live product intelligence" : "Inspect live product"}
        </Button>
      </form>

      {state && !state.ok && <p className="text-sm text-amber">{ERROR_MESSAGES[state.error]}</p>}

      {state?.ok && state.reused && (
        <p className="text-sm text-fg-muted">
          Showing a recent inspection — the site was analysed within the last 24 hours.
        </p>
      )}
    </div>
  );
}

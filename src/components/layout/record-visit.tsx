"use client";

import { useEffect } from "react";
import { lastVisitedCookie } from "@/modules/projects/last-visited";

/**
 * Remember which product this is, so `/app` can come back to it.
 *
 * ## Why a client effect
 *
 * Because it must record an *opening*, and only a mount is one. Writing this
 * during a Server Component render would also run on Next's prefetch, which
 * would record visits to products the founder only hovered a link to — the
 * failure mode is silent and it would send them somewhere they never went.
 *
 * ## Why it renders nothing
 *
 * It has no UI and no state. It is a leaf so the `"use client"` boundary stops
 * here rather than pulling the workspace tree onto the client, which is the
 * rule the rest of this codebase follows for exactly one reason: a boundary on
 * a layout is a boundary on everything inside it.
 */
export function RecordVisit({ projectId }: { projectId: string }) {
  useEffect(() => {
    try {
      document.cookie = lastVisitedCookie(projectId);
    } catch {
      // Blocked cookies. `/app` falls back to the attention ranking, which is
      // a correct screen — so there is nothing to report and nothing to retry.
    }
  }, [projectId]);

  return null;
}

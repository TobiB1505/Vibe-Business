"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/states";

/**
 * The boundary for a workspace section (UI-4 §2).
 *
 * This renders in the layout's content slot, so the sidebar, the project
 * header and the section navigation stay on screen: one section failing to
 * load is not the project becoming unreachable, and the UI should not say
 * otherwise. A failure in the layout itself bubbles past this to `/app`.
 *
 * See `src/app/app/error.tsx` for why the report is explicit and why "nothing
 * was changed" is a guarantee rather than a comfort.
 */
export default function ProjectSectionError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <Notice
      tone="problem"
      label="This section didn't load"
      action={
        <Button type="button" onClick={reset}>
          Try again
        </Button>
      }
    >
      Something failed on Vibe&rsquo;s side while reading this part of your project. Nothing was
      changed, and the rest of the project is still available from the menu.
    </Notice>
  );
}

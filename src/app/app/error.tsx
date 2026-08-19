"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/states";

/**
 * The boundary for everything under `/app` outside a project workspace
 * (UI-4 §2).
 *
 * ## Why it supplies its own shell
 *
 * The `/app` layout renders no chrome — it is an authorization gate and
 * nothing else — so without `AppShell` here a failure would drop the header
 * and read as having been thrown out of the application.
 *
 * ## What it may claim
 *
 * That nothing was modified is a real guarantee, not reassurance: this
 * boundary only ever catches a failure while a screen was being *rendered*,
 * and a render is a read. Every write in this product goes through a Server
 * Action, which reports its own outcome and never lands here.
 *
 * Reported explicitly, following `global-error.tsx`: Next.js catches boundary
 * errors before the global handlers see them. A server-render failure is
 * therefore recorded twice — once by `onRequestError` in `instrumentation.ts`
 * and once here — which is the same trade the root boundary already accepts,
 * and cheaper than a class of failure going unreported.
 */
export default function AppError({
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
    <AppShell>
      <Notice
        tone="problem"
        label="This screen didn't load"
        action={
          <Button type="button" onClick={reset}>
            Try again
          </Button>
        }
      >
        Something failed on Vibe&rsquo;s side while putting this page together. Nothing was changed —
        no project, no repository, and no work in progress.
      </Notice>
    </AppShell>
  );
}

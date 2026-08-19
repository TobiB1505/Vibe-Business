"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

/**
 * The last boundary (UI-4 §2).
 *
 * ## Why this one is styled by hand
 *
 * `global-error` replaces the root layout, so the font variables, the token
 * stylesheet and every UI primitive are gone by the time it renders. Reaching
 * for `Surface` or `Button` here would produce unstyled markup at the worst
 * possible moment, so the handful of values this needs are inlined from
 * `globals.css` — ground, foreground, muted foreground and mint — rather than
 * imported.
 *
 * It previously rendered Next.js' own error page, which is light-themed and
 * carries no product identity: a user whose session had just failed was shown
 * a screen that did not look like the thing they were using.
 *
 * ## What it says
 *
 * One statement and one way forward. It cannot know what failed, so it does
 * not guess, and it does not apologise at length. The reload is a real
 * recovery for the overwhelming majority of what reaches this boundary.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    // Next.js catches boundary errors before the global handlers can observe
    // them, so the root boundary must report them explicitly.
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "2rem",
          backgroundColor: "#0a0908",
          color: "#edebe7",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
          WebkitFontSmoothing: "antialiased",
        }}
      >
        <main style={{ display: "flex", flexDirection: "column", gap: "1.25rem", maxWidth: "34rem" }}>
          <span
            style={{
              fontSize: "0.65625rem",
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: "#8c8880",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            }}
          >
            Vibe Business
          </span>
          <h1 style={{ margin: 0, fontSize: "1.75rem", lineHeight: 1.15, fontWeight: 700, color: "#f7f5f1" }}>
            Vibe couldn&rsquo;t load.
          </h1>
          <p style={{ margin: 0, fontSize: "0.9375rem", lineHeight: 1.6, color: "#a5a19a" }}>
            Something failed before the page could start. Nothing was changed — no project, no
            repository, and no work in progress. Reloading usually fixes it.
          </p>
          <p>
            <a
              href="/app"
              style={{
                display: "inline-block",
                padding: "0.75rem 1.25rem",
                borderRadius: "999px",
                backgroundColor: "#00e5a0",
                color: "#04150f",
                fontWeight: 700,
                fontSize: "0.875rem",
                textDecoration: "none",
              }}
            >
              Reload Vibe
            </a>
          </p>
        </main>
      </body>
    </html>
  );
}

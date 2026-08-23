"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import {
  isPixelTrackablePath,
  metaPixelLoaderScript,
  metaPixelNoscriptImageSrc,
} from "@/lib/analytics/meta-pixel";

declare global {
  interface Window {
    /** Defined by Meta's loader snippet; absent until it has run. */
    fbq?: (...args: unknown[]) => void;
  }
}

/**
 * Whether Meta's loader has already accounted for one page view in this
 * browsing session.
 *
 * Module scope rather than a ref, because a ref would reset exactly where the
 * count goes wrong. The tag is not rendered on the authenticated surface, so
 * a visitor who goes `/` → `/app` → `/` unmounts and remounts this component;
 * a fresh ref would then read as "first view" and skip the report, even
 * though `next/script` will not re-execute an inline script it has already
 * run for this id. One module-level flag makes both halves agree: the loader
 * reports the view that loaded it, and this component reports every one
 * after that — never both, never neither.
 */
let loaderHasReportedFirstView = false;

/**
 * The Meta Pixel, mounted by the root layout on production deployments only
 * (`isMetaPixelEnabled`) and rendered on public pages only.
 *
 * Client-side navigations are invisible to a script tag — nothing reloads, so
 * nothing re-runs — which is why an App Router site that ships only Meta's
 * snippet reports the first page of a visit and nothing else. The effect
 * below closes that gap by reporting each subsequent path.
 *
 * Why the tag is absent rather than silenced on `/app`: Meta receives the URL
 * of every view reported to it, and Vibe's authenticated paths carry project
 * identifiers. See `src/lib/analytics/meta-pixel.ts`.
 */
export function MetaPixel() {
  const pathname = usePathname();
  const trackable = isPixelTrackablePath(pathname);

  useEffect(() => {
    if (!trackable) return;

    if (!loaderHasReportedFirstView) {
      loaderHasReportedFirstView = true;
      return;
    }

    // Optional call: a navigation fast enough to beat `fbevents.js` needs no
    // report from here, because the loader has not run yet and will report
    // the path it finds when it does.
    window.fbq?.("track", "PageView");
  }, [pathname, trackable]);

  if (!trackable) return null;

  return (
    <>
      <Script id="meta-pixel" strategy="afterInteractive">
        {metaPixelLoaderScript()}
      </Script>
      <noscript>
        {/* eslint-disable-next-line @next/next/no-img-element -- a 1x1 tracking pixel is not an image to optimise */}
        <img
          height="1"
          width="1"
          alt=""
          style={{ display: "none" }}
          src={metaPixelNoscriptImageSrc()}
        />
      </noscript>
    </>
  );
}

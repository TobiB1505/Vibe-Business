/**
 * The Meta Pixel — Vibe's advertising attribution tag.
 *
 * This file holds every decision about the pixel that can be made without a
 * browser, so that each one is testable in isolation and none of them is
 * buried inside a JSX file: which pixel, whether it runs at all, which paths
 * it may report, and the exact script text that reaches the page.
 *
 * ## Three deliberate constraints
 *
 * 1. **Production only.** A pixel that fires from local development and from
 *    every Preview deployment reports page views nobody visited into the ad
 *    account that decides where money goes. `getAppEnvironment()` is already
 *    the repository's answer to "which deployment tier is this"
 *    (`src/lib/env/app-url.ts`), so this is a second reader of a value that
 *    is already trusted, not a new source of truth. The public pages this tag
 *    runs on are prerendered, so the gate is resolved at build time for them —
 *    which is the same answer, because Vercel sets `VERCEL_ENV` during the
 *    build as well as at runtime.
 * 2. **Public pages only.** Meta receives the page URL of every view it is
 *    told about. Vibe's authenticated surface carries project identifiers in
 *    its paths, and an advertising network is the last place those belong, so
 *    `/app` and everything under it is excluded — the tag is not loaded there
 *    at all, rather than loaded and asked politely not to look.
 * 3. **The id is not interpolated blindly.** The loader below is inline
 *    script text. Anything placed into it executes, so the id is checked
 *    against a digits-only pattern first and a value that fails throws rather
 *    than shipping. Today's id is a constant in this file and could not fail
 *    that check; the check exists so that it stays true when the id one day
 *    comes from somewhere else.
 *
 * The pixel id itself is not a secret — it is visible in the page source of
 * every site that runs one, which is how Meta's own tooling verifies it — so
 * it lives here rather than in the environment. It identifies a destination,
 * exactly as a Sentry DSN does; it authorises nothing.
 */

import { getAppEnvironment, type AppUrlEnvSource } from "@/lib/env/app-url";

/** The pixel belonging to Vibe Business's Meta ad account. */
export const META_PIXEL_ID = "1054822680793362";

/** Meta pixel ids are numeric. See constraint 3 above. */
const PIXEL_ID_PATTERN = /^\d{10,20}$/;

/** The authenticated surface, which the pixel never sees. */
const AUTHENTICATED_PATH_PREFIX = "/app";

function assertPixelId(pixelId: string): string {
  if (!PIXEL_ID_PATTERN.test(pixelId)) {
    throw new Error(
      `Refusing to build a Meta Pixel tag from ${JSON.stringify(pixelId)}: ` +
        "a pixel id must be 10-20 digits. The value is interpolated into inline " +
        "script text, so anything else is either a misconfiguration or an injection.",
    );
  }
  return pixelId;
}

/**
 * Whether this deployment may run the pixel at all.
 *
 * Development and Preview deliberately return `false`: verifying a pixel
 * before it is live is what Meta's Test Events tool is for, and neither tier
 * should be able to move a production advertising metric.
 */
export function isMetaPixelEnabled(source: AppUrlEnvSource = process.env): boolean {
  return getAppEnvironment(source) === "production";
}

/**
 * Whether a page view at `pathname` may be reported.
 *
 * Prefix-matched on a path *segment*, not on the string: `/application` is a
 * public page that happens to start with the same four characters, and
 * excluding it would be a bug in the direction of silently losing data.
 */
export function isPixelTrackablePath(pathname: string): boolean {
  return !(
    pathname === AUTHENTICATED_PATH_PREFIX ||
    pathname.startsWith(`${AUTHENTICATED_PATH_PREFIX}/`)
  );
}

/**
 * Meta's published loader snippet, verbatim apart from the id.
 *
 * It defines the `fbq` stub (which queues calls made before the real library
 * arrives), loads `fbevents.js`, initialises the pixel and reports the page
 * view that caused it to load. Subsequent views are client-side navigations,
 * which no script tag observes — `MetaPixel` reports those.
 */
export function metaPixelLoaderScript(pixelId: string = META_PIXEL_ID): string {
  return `!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${assertPixelId(pixelId)}');
fbq('track', 'PageView');`;
}

/** The scriptless fallback image, for browsers running with JS disabled. */
export function metaPixelNoscriptImageSrc(pixelId: string = META_PIXEL_ID): string {
  return `https://www.facebook.com/tr?id=${assertPixelId(pixelId)}&ev=PageView&noscript=1`;
}

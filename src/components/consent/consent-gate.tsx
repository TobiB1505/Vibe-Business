"use client";

import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { MetaPixel } from "@/components/analytics/meta-pixel";
import { useConsent } from "./use-consent";

/**
 * The third-party tags, and the decision that has to come first (UI-23).
 *
 * Before this, all three loaded on first paint with nothing asked. The Meta
 * Pixel is an advertising tag — it sets `_fbp` and reports the address of every
 * public page a visitor opens to Meta — and under TTDSG §25 that needs prior
 * opt-in in Germany, where Vibe is operated from. `/privacy` listed the gap
 * itself: *"consent for advertising cookies where the law requires asking
 * first, and a way to decline."*
 *
 * ## Absent, not silenced
 *
 * A refused tag is not rendered. There is no script element to disable, no
 * `fbq` stub queuing calls for a library that will not arrive, and nothing to
 * get wrong later — the same argument CLAUDE.md rule 76 makes about the coding
 * agent's tools, applied to a page: an effect that must not happen is best
 * expressed as a capability that is not there.
 *
 * ## Why `metaPixelAllowed` is passed in
 *
 * Whether this deployment may run the pixel at all is a server fact
 * (`isMetaPixelEnabled` reads `VERCEL_ENV`), and it stays a server fact:
 * consent cannot switch on a tag that a Preview deployment must never run.
 * Both have to be true, and they are two different kinds of true.
 */
export function ConsentGate({ metaPixelAllowed }: { metaPixelAllowed: boolean }) {
  const { choices, record } = useConsent();

  // `undefined` means the cookie has not been read yet. Nothing loads on a
  // maybe.
  if (record === undefined) return null;

  return (
    <>
      {choices.analytics && (
        <>
          <Analytics />
          <SpeedInsights />
        </>
      )}
      {metaPixelAllowed && choices.marketing && <MetaPixel />}
    </>
  );
}

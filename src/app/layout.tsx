import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ConsentBanner } from "@/components/consent/consent-banner";
import { ConsentGate } from "@/components/consent/consent-gate";
import { Atmosphere } from "@/components/layout/atmosphere";
import { MotionProvider } from "@/components/ui/motion-provider";
import { isMetaPixelEnabled } from "@/lib/analytics/meta-pixel";
import { getAppUrl } from "@/lib/env/app-url";
import { fontVariables } from "./fonts";
import "./globals.css";
import { activePalette, paletteSwitchable, PALETTE_BOOT_SCRIPT } from "./palette";

/**
 * The technical typeface is declared in `./fonts.ts` and exposed to the
 * design tokens as `--font-mono`. The product UI uses the native interface
 * stack declared as `--font-sans` in globals.css.
 *
 * The bundled face is self-hosted, so a build needs no network access and a
 * page makes no third-party font request.
 * Components must reach them through `font-sans` / `font-mono`; a
 * `font-family` declaration anywhere else in the codebase is a bug.
 */
export const metadata: Metadata = {
  // Resolves any relative URL a page's own metadata provides (Open Graph
  // images, alternates, ...) against this deployment's own origin, so a
  // Preview build never resolves one against Production's domain. No page
  // currently sets a relative metadata URL — this establishes the base
  // before one needs it, rather than after a wrong resolution ships.
  metadataBase: new URL(getAppUrl()),
  /*
   * A template, so a route states its own name and the product name is
   * appended once (UX audit F-1).
   *
   * Twenty-two of twenty-nine routes had no title at all and inherited the
   * bare product name, which made every tab, every bookmark and every history
   * entry identical — the contract's "every route has a truthful metadata
   * title" was true of seven. `default` is what the landing page and any route
   * that sets none still gets.
   */
  title: {
    default: "Vibe Business",
    template: "%s — Vibe Business",
  },
  description: "The business layer for AI-built products.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    /*
      The one place the design system is chosen, from configuration.
      `theme-v2.css` scopes every redefinition to `[data-vibe="v2"]`, so this
      attribute is the whole switch — and the attribute is written in both
      states rather than only in v2, because "why is it still the old design"
      should be answerable by looking at the document rather than by finding
      out which deployment read which variable.

      Global rather than per route: `.vibe-atmosphere` is `position: fixed`, so
      a half-migrated product changes its own background as a founder
      navigates. See `palette.ts` and ADR 0098.
    */
    <html lang="en" data-vibe={activePalette()} className={`h-full antialiased ${fontVariables}`}>
      {paletteSwitchable() && (
        <head>
          {/*
            The stored override, applied before the first paint.
            `localStorage` cannot be read while the server renders, so without
            this the document paints the deployment's palette and swaps a frame
            later — on a switch that moves the ground, the corners and the type,
            that is the whole product flashing on every navigation.

            Blocking on purpose, and shipped only where the switch itself is:
            production has no override to read.
          */}
          <script dangerouslySetInnerHTML={{ __html: PALETTE_BOOT_SCRIPT }} />
        </head>
      )}
      <body className="bg-app text-fg-body h-full font-sans">
        {/*
          The ground, before anything that stands on it. Two inert fixed
          layers that match no rule in v1, so this is dead weight of two empty
          divs until the palette is switched on — and connected now rather
          than at switch-on, because the version of this that was written and
          never rendered is exactly why the glass had nothing to refract.
        */}
        <Atmosphere />
        {children}
        {/*
          One listener for every animation in the product: it stamps
          `data-motion` on `<html>` while the tab is hidden, and `globals.css`
          pauses off that attribute. Renders nothing and adds no client
          boundary to the tree — this leaf is the only client component here.
        */}
        <MotionProvider />
        {/*
          Every third-party tag, behind the decision (UI-23).

          All three used to be mounted here unconditionally. The Meta Pixel is
          an advertising tag — it sets `_fbp` and reports the address of each
          public page a visitor opens — and under TTDSG §25 that needs prior
          opt-in in Germany, where this is operated from. `/privacy` listed the
          gap itself.

          `isMetaPixelEnabled()` stays a server fact and is passed down rather
          than replaced by consent: whether this deployment may run the pixel
          at all, and whether this visitor agreed to it, are two different
          kinds of true and both have to hold.
        */}
        <ConsentGate metaPixelAllowed={isMetaPixelEnabled()} />
        <ConsentBanner />
      </body>
    </html>
  );
}

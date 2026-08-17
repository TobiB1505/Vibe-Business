"use client";

import { useCallback, useState } from "react";
import { VibeMark } from "@/components/brand/vibe-mark";

/**
 * The customer's own logo, or a mark that is not a broken image (UI-S1 §18).
 *
 * ## What went wrong without this
 *
 * The reveal moment renders a logo taken from the customer's own site, at a URL
 * on their origin. When that URL 404s, times out, or is blocked — which is
 * ordinary, since it was inferred from evidence rather than handed over — the
 * browser draws its broken-image glyph. Directly above the sentence "I
 * understand what you built."
 *
 * That is the single worst place in the product for an image to break. The
 * whole screen is an argument that Vibe read the product carefully, and the
 * first thing a founder sees is Vibe visibly failing to load their logo.
 *
 * ## Why an error handler rather than a server-side check
 *
 * Because the check would have to be a request from Vibe's servers to the
 * customer's origin, and the answer would still not be the browser's answer —
 * a URL that resolves for us can fail for them, and the reveal would still
 * break. The browser is the only thing that knows whether the browser could
 * load it, so the browser is what is asked.
 *
 * The fallback is the Vibe mark rather than a grey box: the moment still needs
 * something at the top of it, and an empty space reads as a layout bug. Nothing
 * about the reveal — headline, understanding, facts, confirmation — depends on
 * this succeeding.
 *
 * ## Why `onError` alone is not enough
 *
 * This element is server-rendered, so the browser starts fetching it long
 * before React hydrates. A logo that fails *fast* — a dead host, a blocked
 * request, an immediate 404, which is most of them — fires its `error` event
 * while there is no React handler attached to hear it, and the broken glyph
 * then stays on screen forever. The browser suite caught exactly that: the
 * handler was correct and never ran.
 *
 * The ref callback closes it by asking the element what already happened.
 * `complete` is true once the fetch has settled either way, and a settled image
 * with no intrinsic width is one that failed — so a load that was already over
 * before hydration is detected on mount rather than waited for.
 */
export function ProductLogo({
  src,
  alt,
  size = 44,
  className = "h-12 max-w-[220px] object-contain",
}: {
  src: string;
  alt: string;
  /** The fallback mark's size, matched to the logo's rendered height. */
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  const catchUp = useCallback((node: HTMLImageElement | null) => {
    if (node && node.complete && node.naturalWidth === 0) setFailed(true);
  }, []);

  if (failed) return <VibeMark size={size} />;

  return (
    // `next/image` is deliberately not used: the host is the customer's own
    // origin and is unknown at build time, so a plain img with no referrer is
    // the honest primitive.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={catchUp}
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      className={className}
      onError={() => setFailed(true)}
      data-testid="product-logo"
    />
  );
}

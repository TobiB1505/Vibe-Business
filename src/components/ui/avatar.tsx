"use client";

import { useCallback, useState } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * A person's picture, or their initials — never a broken image (CORE-6).
 *
 * ## Why this repeats `ProductLogo`'s shape rather than importing it
 *
 * The failure handling is the same and is the reason both exist: an image on a
 * host we do not control needs *two* guards, not one. `onError` catches a load
 * that fails after hydration. It does not catch the common case — the element
 * is server-rendered, the browser starts fetching immediately, and a fast
 * failure (dead host, blocked request, immediate 404) fires its `error` event
 * while no React handler is attached to hear it, leaving the broken-image glyph
 * on screen permanently. The ref callback asks the element what already
 * happened: `complete` with no intrinsic width is a load that is over and
 * failed.
 *
 * `ProductLogo` is not reused directly because its fallback is the Vibe mark at
 * a logo's aspect ratio, and this one is a circle with initials. Same
 * mechanism, different answer to "what goes here instead".
 *
 * ## What the initials are
 *
 * Whatever the caller passes. This component does not derive them, because
 * "first letter of the email" and "first letter of a GitHub login" are
 * different decisions with different honesty properties, and neither belongs
 * in a presentational primitive.
 */
export function Avatar({
  src,
  initials,
  label,
  size = 32,
  className,
}: {
  /** Null when there is no picture to try — renders initials directly. */
  src: string | null;
  /** One or two characters. Already uppercased by the caller. */
  initials: string;
  /** Who this is, for assistive technology. */
  label: string;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  const catchUp = useCallback((node: HTMLImageElement | null) => {
    if (node && node.complete && node.naturalWidth === 0) setFailed(true);
  }, []);

  const shared = cn(
    "shrink-0 rounded-full object-cover",
    // A ring rather than a border: it does not affect layout, so the image and
    // the initials tile are the same size to the pixel.
    "ring-1 ring-line-4",
    className,
  );

  if (src === null || failed) {
    return (
      <span
        role="img"
        aria-label={label}
        style={{ width: size, height: size }}
        className={cn(
          shared,
          "bg-surface-hover text-fg-body inline-flex items-center justify-center",
          "font-mono text-[0.6875rem] tracking-[0.04em]",
        )}
      >
        {initials}
      </span>
    );
  }

  return (
    // `next/image` is deliberately not used: the host is outside this project
    // and is not configured in `images.remotePatterns`, so a plain tag with no
    // referrer is the honest primitive — the same call `ProductLogo` makes.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={catchUp}
      src={src}
      alt={label}
      width={size}
      height={size}
      referrerPolicy="no-referrer"
      className={shared}
      onError={() => setFailed(true)}
      data-testid="account-avatar"
    />
  );
}

import type { SVGProps } from "react";

/**
 * The furniture a web page is made of, as glyphs.
 *
 * They fly into the mark while an analysis runs. They are **decoration**, and
 * the distinction matters enough to write down: an `@` or a cart passing by
 * says "web pages contain things like this", which is true of every web page.
 * Neither says Vibe found a contact form or a checkout in *this* product —
 * they carry no path, no label and no count, and they are drawn identically so
 * they read as one set rather than as a list of results.
 *
 * Drawn here rather than taken from `dashboard-icons.tsx` for a reason: those
 * are navigation icons with a name union that other screens switch on, and
 * adding page furniture to it would put decoration in a menu's vocabulary.
 * The frame below is deliberately identical to that file's, so the two sets
 * still look like one hand.
 */

type GlyphProps = SVGProps<SVGSVGElement> & { size?: number };

function GlyphFrame({ size = 18, children, ...props }: GlyphProps) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {children}
    </svg>
  );
}

export function AtGlyph(props: GlyphProps) {
  return (
    <GlyphFrame {...props}>
      <circle cx="12" cy="12" r="3.6" />
      <path d="M15.6 8.4v4.8a2.8 2.8 0 0 0 5.6 0V12a9 9 0 1 0-3.6 7.2" />
    </GlyphFrame>
  );
}

export function FolderGlyph(props: GlyphProps) {
  return (
    <GlyphFrame {...props}>
      <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5h9A1.5 1.5 0 0 1 21 10v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18Z" />
    </GlyphFrame>
  );
}

export function ImageGlyph(props: GlyphProps) {
  return (
    <GlyphFrame {...props}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="8.5" cy="10" r="1.5" />
      <path d="m4 17 5-4.5 4 3.5 3-2.5 4 3.5" />
    </GlyphFrame>
  );
}

export function FieldGlyph(props: GlyphProps) {
  return (
    <GlyphFrame {...props}>
      <rect x="3" y="8" width="18" height="8" rx="2" />
      <path d="M7 10.5v3" />
    </GlyphFrame>
  );
}

export function CartGlyph(props: GlyphProps) {
  return (
    <GlyphFrame {...props}>
      <path d="M3 5h2l2.2 9.5h9.4L19 8H6" />
      <circle cx="9" cy="19" r="1.4" />
      <circle cx="16.5" cy="19" r="1.4" />
    </GlyphFrame>
  );
}

export function TableGlyph(props: GlyphProps) {
  return (
    <GlyphFrame {...props}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 10h18M9 10v9" />
    </GlyphFrame>
  );
}

export function ButtonGlyph(props: GlyphProps) {
  return (
    <GlyphFrame {...props}>
      <rect x="3" y="9" width="18" height="7" rx="3.5" />
      <path d="M8.5 12.5h7" />
    </GlyphFrame>
  );
}

export function ParagraphGlyph(props: GlyphProps) {
  return (
    <GlyphFrame {...props}>
      <path d="M4 6.5h16M4 11h16M4 15.5h11" />
    </GlyphFrame>
  );
}

export function BellGlyph(props: GlyphProps) {
  return (
    <GlyphFrame {...props}>
      <path d="M6.5 10a5.5 5.5 0 0 1 11 0c0 4 1.5 5.5 1.5 5.5H5S6.5 14 6.5 10Z" />
      <path d="M10.5 18.5a1.8 1.8 0 0 0 3 0" />
    </GlyphFrame>
  );
}

export function LinkGlyph(props: GlyphProps) {
  return (
    <GlyphFrame {...props}>
      <path d="M10 13.5a3.5 3.5 0 0 0 5 0l3-3a3.54 3.54 0 0 0-5-5l-1.5 1.5" />
      <path d="M14 10.5a3.5 3.5 0 0 0-5 0l-3 3a3.54 3.54 0 0 0 5 5L12.5 17" />
    </GlyphFrame>
  );
}

export function PlayGlyph(props: GlyphProps) {
  return (
    <GlyphFrame {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m10.5 9 5 3-5 3Z" />
    </GlyphFrame>
  );
}

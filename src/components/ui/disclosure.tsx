import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import { MonoLabel } from "./typography";

/**
 * Progressive disclosure (Sprint UI-3.5).
 *
 * The product's answer comes first; the evidence behind it comes second; the
 * raw technical values come last. This is the component that makes the last
 * two optional without deleting them — nothing is hidden from the user, it is
 * ordered behind what they actually asked.
 *
 * ## Why `<details>` rather than a client component
 *
 * It is keyboard operable, exposes `aria-expanded` to assistive technology,
 * survives with JavaScript disabled and needs no hydration. A hand-rolled
 * button with `useState` would be a client component on a server-rendered page
 * to reproduce behaviour the platform already has — and would be one more
 * place to get the ARIA wrong.
 *
 * The one thing it needs help with is the marker: browsers render a default
 * triangle inconsistently, so it is removed and replaced with our own.
 */
export function Disclosure({
  label,
  children,
  /** Small evidence lists can stay visible; long or raw ones should not. */
  defaultOpen = false,
  className,
}: {
  label: string;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  return (
    <details open={defaultOpen} className={cn("group", className)}>
      <summary
        className={cn(
          "text-fg-muted hover:text-fg-body flex cursor-pointer list-none items-center gap-2",
          "rounded-sm text-xs transition-interactive",
          // Safari and Chrome each add their own marker; both are removed so
          // the caret below is the only one.
          "[&::-webkit-details-marker]:hidden",
        )}
      >
        <span
          aria-hidden
          className="text-fg-meta inline-block transition-transform duration-150 group-open:rotate-90"
        >
          ▸
        </span>
        {label}
      </summary>
      <div className="pt-3">{children}</div>
    </details>
  );
}

/**
 * The bottom layer: exact values, as the system recorded them.
 *
 * Deliberately mono and deliberately unstyled beyond that — this is the place
 * where `canonicalUrl: null` is the right thing to write, because someone
 * opening it is asking precisely that question. Nothing above it should read
 * this way, and nothing here should be softened.
 *
 * Values wrap rather than overflow: a SHA, a URL or a branch name on a 375px
 * screen would otherwise push the page sideways.
 */
export function TechnicalDetails({
  entries,
  label = "Technical details",
  children,
}: {
  /** Exact recorded values. `null` is shown as `null`, not as an em dash. */
  entries?: { key: string; value: string | number | boolean | null }[];
  label?: string;
  children?: ReactNode;
}) {
  return (
    <Disclosure label={label}>
      <div className="rounded-well border-line-2 bg-well flex flex-col gap-2 border p-4">
        {entries && entries.length > 0 && (
          <dl className="flex flex-col gap-1.5">
            {entries.map((entry) => (
              <div key={entry.key} className="flex flex-wrap gap-x-3 gap-y-0.5">
                <dt className="text-fg-meta font-mono text-meta">{entry.key}</dt>
                <dd className="text-fg-secondary [overflow-wrap:anywhere] font-mono text-meta">
                  {entry.value === null ? "null" : String(entry.value)}
                </dd>
              </div>
            ))}
          </dl>
        )}
        {children}
      </div>
    </Disclosure>
  );
}

/**
 * A short list of what the system observed — the middle layer.
 *
 * Concrete but still readable: "Homepage", "Sign-up page", not
 * `live.surface.signup`. Present and absent are separated because "we looked
 * and it was not there" is a finding, while an item simply missing from a list
 * is ambiguous.
 */
export function FoundList({
  found,
  missing,
  label = "What Vibe found",
}: {
  found: string[];
  missing?: string[];
  label?: string;
}) {
  if (found.length === 0 && (missing ?? []).length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <MonoLabel className="tracking-[0.14em]">{label}</MonoLabel>
      <ul className="flex flex-col gap-1.5">
        {found.map((item) => (
          <li key={item} className="text-fg-prose flex items-baseline gap-2.5 text-sm">
            {/* The glyph is decorative; the two groups are separated by a
                labelled heading, so nothing depends on colour or icon alone. */}
            <span aria-hidden className="text-mint text-xs">
              ✓
            </span>
            {item}
          </li>
        ))}
        {(missing ?? []).map((item) => (
          <li key={item} className="text-fg-muted flex items-baseline gap-2.5 text-sm">
            <span aria-hidden className="text-fg-meta text-xs">
              —
            </span>
            Not found: {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

import Image from "next/image";
import { cn } from "@/lib/utils/cn";

/**
 * Brand marks (UI-0).
 *
 * The SVGs in `public/brand/` are the canonical artwork. These components exist
 * so callers pick a *variant* rather than a file path, and so the accessible
 * name is decided in one place: the mark next to the word "Vibe Business" is
 * decorative and must be hidden from assistive technology, while a mark
 * standing alone is the product's name and must be announced.
 */

export type VibeMarkVariant = "dark" | "light" | "mono";

const MARK_SRC: Record<VibeMarkVariant, string> = {
  dark: "/brand/vibe-mark.svg",
  light: "/brand/vibe-mark-on-light.svg",
  mono: "/brand/vibe-mark-mono.svg",
};

export function VibeMark({
  size = 24,
  variant = "dark",
  /** Set when the mark stands alone and therefore carries the product name. */
  label,
  className,
}: {
  size?: number;
  variant?: VibeMarkVariant;
  label?: string;
  className?: string;
}) {
  return (
    <Image
      src={MARK_SRC[variant]}
      alt={label ?? ""}
      aria-hidden={label ? undefined : true}
      width={size}
      height={size}
      className={cn("shrink-0", className)}
      priority
    />
  );
}

/**
 * Mark plus wordmark — the header/nav signature.
 *
 * The wordmark is live text rather than the baked `vibe-lockup.svg`, so it
 * renders in the real loaded Space Grotesk, scales with the type ramp, and is
 * selectable and searchable. The flat lockup file stays for contexts that can
 * only take an image.
 */
export function VibeLockup({
  size = 24,
  variant = "dark",
  className,
}: {
  size?: number;
  variant?: VibeMarkVariant;
  className?: string;
}) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <VibeMark size={size} variant={variant} />
      <span className="text-fg text-[0.9375rem] font-bold tracking-[-0.02em]">Vibe Business</span>
    </span>
  );
}

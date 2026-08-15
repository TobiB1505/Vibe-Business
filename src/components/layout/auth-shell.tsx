import type { ReactNode } from "react";
import { VibeLockup } from "@/components/brand/vibe-mark";

/**
 * The sign-in / sign-up shell (UI-0).
 *
 * Two halves on a wide screen: the product's claim on the left, the form on
 * the right. Below `lg` the claim collapses to the lockup alone and the form
 * takes the screen — on a phone, someone opening `/login` came to sign in, and
 * making them scroll past a value proposition to reach the password field is a
 * desktop composition imposed on a phone.
 *
 * The mockups' drifting mint glow is present as a static radial wash. The
 * animation belongs to the motion sprint; the shape it animates is here so
 * that sprint is a change of one declaration.
 */
export function AuthShell({
  headline,
  intro,
  assurances,
  children,
}: {
  headline: ReactNode;
  intro?: ReactNode;
  /** Short factual guarantees. Each must be something the system actually does. */
  assurances?: string[];
  /** The form column. */
  children: ReactNode;
}) {
  return (
    <div className="bg-app text-fg-body grid min-h-dvh lg:grid-cols-2">
      <div className="border-line-1 relative hidden flex-col justify-between overflow-clip border-r p-14 lg:flex">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-44 -left-32 size-[46rem] rounded-full"
          style={{
            background:
              "radial-gradient(closest-side, rgb(0 229 160 / 0.15), rgb(0 229 160 / 0))",
          }}
        />
        <div className="relative">
          <VibeLockup />
        </div>

        <div className="relative flex flex-col gap-6">
          <h1 className="text-fg text-hero font-bold text-balance">{headline}</h1>
          {intro && <p className="text-fg-secondary max-w-[38ch] text-base leading-relaxed">{intro}</p>}
          {assurances && assurances.length > 0 && (
            <ul className="text-fg-prose flex flex-col gap-3 text-sm">
              {assurances.map((assurance) => (
                <li key={assurance} className="flex items-center gap-3">
                  <span
                    aria-hidden
                    className="bg-mint-tint border-mint-line text-mint flex size-5 shrink-0 items-center justify-center rounded-full border text-[0.625rem]"
                  >
                    ✓
                  </span>
                  {assurance}
                </li>
              ))}
            </ul>
          )}
        </div>

        <p className="text-fg-muted relative font-mono text-xs">
          The business layer for AI-built products.
        </p>
      </div>

      <div className="flex items-center justify-center px-5 py-12 sm:px-10">
        <div className="flex w-full max-w-[25rem] flex-col gap-6">
          <div className="lg:hidden">
            <VibeLockup />
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

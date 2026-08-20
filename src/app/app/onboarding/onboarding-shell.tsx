import Link from "next/link";
import type { ReactNode } from "react";
import { TextAction } from "@/components/ui/button";
import { VibeLockup } from "@/components/brand/vibe-mark";
import { signOut } from "@/modules/auth/actions";
import {
  ONBOARDING_PHASES,
  onboardingPhase,
  phasePosition,
  type OnboardingState,
} from "@/modules/onboarding/state";

export function OnboardingShell({
  children,
  email,
  state,
  projectName,
  canLeave = false,
}: {
  children: ReactNode;
  email: string | null;
  state: OnboardingState;
  projectName?: string;
  /**
   * Whether leaving actually leads somewhere.
   *
   * True once any project has finished setup, which is exactly when `/app`
   * stops redirecting back here. Tying the two to one predicate is what keeps
   * a visible exit from being a loop — the logo already linked to `/app` and
   * bounced straight back, which is the defect this answers.
   */
  canLeave?: boolean;
}) {
  const active = onboardingPhase(state);
  const position = phasePosition(active);

  return (
    <div className="bg-app text-fg-body min-h-dvh">
      <header className="border-line-1 border-b">
        <div className="mx-auto flex max-w-[76rem] items-center gap-4 px-5 py-4 sm:px-8">
          <Link href="/app" aria-label="Vibe Business" className="rounded-sm">
            <VibeLockup />
          </Link>
          {projectName && (
            <span className="text-fg-muted border-line-2 hidden border-l pl-4 text-sm sm:inline">
              {projectName}
            </span>
          )}
          <div className="ml-auto flex items-center gap-4">
            {canLeave && (
              <Link
                href="/app"
                className="text-fg-muted hover:text-fg-body text-xs underline underline-offset-4"
              >
                Back to your projects
              </Link>
            )}
            {email && <span className="text-fg-meta hidden text-xs sm:inline">{email}</span>}
            <form action={signOut}>
              <TextAction className="text-xs">Sign out</TextAction>
            </form>
          </div>
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-[76rem] gap-8 px-5 py-7 sm:px-8 sm:py-10 lg:grid-cols-[11rem_minmax(0,1fr)] lg:gap-12">
        <nav aria-label="Onboarding progress" className="lg:pt-2">
          <ol className="grid grid-cols-4 gap-2 lg:flex lg:flex-col lg:gap-5">
            {ONBOARDING_PHASES.map((phase, index) => {
              const current = phase.id === active;
              const complete = index < position || state === "complete";
              return (
                <li key={phase.id} className="flex min-w-0 items-center gap-2.5">
                  <span
                    aria-hidden="true"
                    className={`flex size-5 shrink-0 items-center justify-center rounded-full border font-mono text-[0.5625rem] ${
                      complete
                        ? "border-mint bg-mint text-mint-ink"
                        : current
                          ? "border-mint text-mint shadow-mint"
                          : "border-line-3 text-fg-meta"
                    }`}
                  >
                    {complete ? "✓" : index + 1}
                  </span>
                  <span
                    className={`truncate text-[0.6875rem] font-medium tracking-[0.08em] uppercase ${
                      current ? "text-fg-body" : complete ? "text-fg-secondary" : "text-fg-meta"
                    }`}
                  >
                    {phase.label}
                  </span>
                </li>
              );
            })}
          </ol>
        </nav>

        <main className="min-w-0">{children}</main>
      </div>
    </div>
  );
}

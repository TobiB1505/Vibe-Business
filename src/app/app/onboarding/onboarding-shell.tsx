import Link from "next/link";
import type { ReactNode } from "react";
import { TextAction } from "@/components/ui/button";
import { VibeLockup } from "@/components/brand/vibe-mark";
import { signOut } from "@/modules/auth/actions";
import type { OnboardingState } from "@/modules/onboarding/state";

export function OnboardingShell({
  children,
  email,
  projectName,
  canLeave = false,
}: {
  children: ReactNode;
  email: string | null;
  /**
   * Accepted and unread, deliberately.
   *
   * The progress list this positioned is gone: it was a to-do list about the
   * product's process, and Nova says where we are in a sentence now. The prop
   * stays because `loading.tsx` and the page both mount this shell and both
   * pass it — dropping it would make the wait render a different frame from
   * the page it is waiting for, which is how the two come apart.
   */
  state?: OnboardingState | null;
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

      {/*
        One column, because the left one is Nova's now.

        It held a four-step progress list — Connect, Understand, Audit, First
        move, with ticks — and that is a to-do list about the *product's*
        process rather than anything a founder decides. It also said the one
        thing Nova now says herself, in a sentence, at the top of the thread:
        where we are. The rail that replaced it carries her mark and what has
        already happened, which is what makes this a place rather than a form.
      */}
      <div className="mx-auto w-full max-w-[76rem] px-5 py-7 sm:px-8 sm:py-10">
        <main className="min-w-0">{children}</main>
      </div>
    </div>
  );
}

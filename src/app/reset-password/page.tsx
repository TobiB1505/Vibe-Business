import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/layout/auth-shell";
import { getSession } from "@/modules/auth/session";
import { ResetPasswordForm } from "./reset-password-form";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Choose a new password",
  description: "Set a new password for your account.",
};

/**
 * The final step of password recovery.
 *
 * Reaching this screen requires a session, which `/auth/confirm` created from
 * the emailed token. Someone who navigates here directly — or follows a link
 * whose token had already expired — has no session, and gets sent to request
 * a fresh link rather than a form that could only fail on submit.
 *
 * This page is deliberately *not* in the proxy's "authenticated users don't
 * belong here" list: the recovery session is exactly what makes it reachable.
 */
export default async function ResetPasswordPage() {
  const session = await getSession();
  if (!session) {
    redirect("/forgot-password?error=expired_link");
  }

  return (
    <AuthShell
      headline={
        <>
          Almost there.
          <br />
          <span className="text-mint">Pick a new password.</span>
        </>
      }
      intro="Then you're back in."
    >
      <div className="flex flex-col gap-2">
        <h1 className="text-fg text-headline font-bold">Set a new password</h1>
        <p className="text-fg-muted text-sm">
          You&apos;ll stay signed in on this device once it&apos;s saved.
        </p>
      </div>

      <ResetPasswordForm />

      <p className="text-fg-muted text-sm">
        Changed your mind?{" "}
        <Link href="/app" className="text-mint hover:text-mint-hover rounded-sm">
          Back to Vibe
        </Link>
      </p>
    </AuthShell>
  );
}

import Link from "next/link";
import { AuthShell } from "@/components/layout/auth-shell";
import { authFailureMessage, parseFailureParam } from "@/modules/auth/errors";
import { ForgotPasswordForm } from "./forgot-password-form";

/**
 * Where a dead reset link sends people, as well as where a forgotten password
 * starts — the same screen answers both, because in both cases the only thing
 * that helps is a fresh link.
 */
export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const error = params.error
    ? authFailureMessage(parseFailureParam(params.error), "recovery")
    : null;

  return (
    <AuthShell
      headline={
        <>
          Locked out?
          <br />
          <span className="text-mint">Let&apos;s fix that.</span>
        </>
      }
      intro="We'll email you a link to set a new password."
    >
      <div className="flex flex-col gap-2">
        <h1 className="text-fg text-headline font-bold">Reset your password</h1>
        <p className="text-fg-muted text-sm">
          Enter the email address you signed up with.
        </p>
      </div>

      <ForgotPasswordForm initialError={error} />

      <p className="text-fg-muted text-sm">
        Remembered it?{" "}
        <Link href="/login" className="text-mint hover:text-mint-hover rounded-sm">
          Back to sign in
        </Link>
      </p>
    </AuthShell>
  );
}

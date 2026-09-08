import Link from "next/link";
import { AuthHeading, AuthShell } from "@/components/layout/auth-shell";
import { authFailureMessage, parseFailureParam } from "@/modules/auth/errors";
import { ForgotPasswordForm } from "./forgot-password-form";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Reset your password",
  description: "Send yourself a password reset link.",
};

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
    /*
      No assurances here. They are about what Vibe does to a repository, and
      this screen is about getting back into an account — a promise about
      branches beside a password reset is furniture.
    */
    <AuthShell>
      <AuthHeading title="Reset your password">
        Remembered it?{" "}
        <Link href="/login" className="text-mint hover:text-mint-hover rounded-inline">
          Back to sign in
        </Link>
      </AuthHeading>

      <p className="text-fg-prose text-body">
        Enter the email address you signed up with and we&apos;ll send you a link to set a new
        password.
      </p>

      <ForgotPasswordForm initialError={error} />
    </AuthShell>
  );
}

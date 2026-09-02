import Link from "next/link";
import { AuthShell } from "@/components/layout/auth-shell";
import { sanitizeNextPath } from "@/modules/auth/redirects";
import { SignupForm } from "./signup-form";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Create account",
  description: "Create your Vibe Business account.",
};

/**
 * `next` is sanitized here, once, so the value that reaches the form — and
 * from there the email confirmation link — is already known to be an internal
 * path. Someone who hit a protected page before having an account should land
 * on it after creating one.
 */
export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const next = sanitizeNextPath(params.next);

  return (
    <AuthShell
      headline={
        <>
          You vibe-coded the product.
          <br />
          <span className="text-mint">Now vibe the business.</span>
        </>
      }
      intro="Create an account, connect a repository, and Vibe reads it once to work out how business-ready it is."
      assurances={["Changes land on their own branch", "Nothing merged without your approval"]}
    >
      <div className="flex flex-col gap-2">
        <h1 className="text-fg text-headline font-bold">Create account</h1>
        <p className="text-fg-muted text-sm">
          With Google, or an email address and password.
        </p>
      </div>

      <SignupForm next={next} />

      <p className="text-fg-muted text-sm">
        Already have an account?{" "}
        <Link href="/login" className="text-mint hover:text-mint-hover rounded-sm">
          Sign in
        </Link>
      </p>

      {/* The one place a legal link genuinely has to be: this is the moment
          someone agrees to something (UI-S1 §7, §8). */}
      <p className="text-fg-muted text-xs leading-relaxed">
        By creating an account you agree to the{" "}
        <Link href="/terms" className="text-fg-muted hover:text-fg-body underline underline-offset-4">
          terms
        </Link>{" "}
        and the{" "}
        <Link href="/privacy" className="text-fg-muted hover:text-fg-body underline underline-offset-4">
          privacy notice
        </Link>
        .
      </p>
    </AuthShell>
  );
}

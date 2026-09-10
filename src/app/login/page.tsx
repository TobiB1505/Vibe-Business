import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthHeading, AuthShell } from "@/components/layout/auth-shell";
import { authFailureMessage, parseFailureParam } from "@/modules/auth/errors";
import { sanitizeNextPath } from "@/modules/auth/redirects";
import { getSession } from "@/modules/auth/session";
import { LoginForm } from "./login-form";
import type { Metadata } from "next";
import { proseLinkClasses } from "@/components/ui/text-link";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to Vibe Business.",
};

/**
 * The sign-in screen.
 *
 * Two things happen server-side before anything renders, and both are on
 * purpose:
 *
 * 1. An already-authenticated visitor is redirected away, so nobody is asked
 *    to sign in twice. `src/lib/supabase/proxy.ts` normally catches this
 *    first; the check is repeated here because a route matcher is a
 *    configuration file, and this page should be correct on its own.
 * 2. `next` is sanitized once, here, and only the sanitized value reaches the
 *    client component. An untrusted redirect target never becomes part of a
 *    rendered form.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;
  const next = sanitizeNextPath(params.next);

  const session = await getSession();
  if (session) {
    redirect(next);
  }

  // The only thing an `?error=` parameter can do is select one of our own
  // sentences — `parseFailureParam` refuses anything outside the known set,
  // so a crafted link cannot put text on this screen.
  const error = params.error
    ? authFailureMessage(parseFailureParam(params.error), "sign_in")
    : null;

  return (
    <AuthShell>
      <AuthHeading title="Sign in">
        No account yet?{" "}
        <Link href="/signup" className={proseLinkClasses()}>
          Create one
        </Link>
      </AuthHeading>

      <LoginForm next={next} initialError={error} />
    </AuthShell>
  );
}

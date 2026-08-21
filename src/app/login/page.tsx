import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/layout/auth-shell";
import { authFailureMessage, parseFailureParam } from "@/modules/auth/errors";
import { sanitizeNextPath } from "@/modules/auth/redirects";
import { getSession } from "@/modules/auth/session";
import { LoginForm } from "./login-form";

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
    <AuthShell
      headline={
        <>
          You vibe-coded the product.
          <br />
          <span className="text-mint">Now vibe the business.</span>
        </>
      }
      intro="Sign in to see what Vibe found in your product and what it wants to do about it."
      // Both of these are properties of the system as built: a prepared change
      // is written to its own branch, and the branch you ship from moves only
      // on an explicit approval of one specific commit. Neither is a marketing
      // claim.
      //
      // Neither characterises the *grant*, deliberately. The App holds
      // `Contents: read and write` — execution creates a branch and a commit,
      // and an approved merge fast-forwards the default branch. Saying
      // "read-only" here was true until Sprint 11 and false afterwards, which
      // is exactly the failure a claim about a permission invites: the
      // permission changed and the sentence did not.
      assurances={["Changes land on their own branch", "Nothing merged without your approval"]}
    >
      <div className="flex flex-col gap-2">
        <h1 className="text-fg text-headline font-bold">Sign in</h1>
        <p className="text-fg-muted text-sm">
          With Google, or the email and password you signed up with.
        </p>
      </div>

      <LoginForm next={next} initialError={error} />

      <p className="text-fg-muted text-sm">
        No account yet?{" "}
        <Link href="/signup" className="text-mint hover:text-mint-hover rounded-sm">
          Create one
        </Link>
      </p>
    </AuthShell>
  );
}

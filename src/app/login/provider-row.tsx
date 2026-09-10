"use client";

import { GithubMark, GoogleMark } from "@/components/brand/provider-marks";
import { Button } from "@/components/ui/button";

/**
 * The identity providers, and the rule below them (UI-19, UI-20).
 *
 * ## Why one component for four screens
 *
 * Sign-in and sign-up offer the same providers and differ only in the verb —
 * *Continue* against *Sign up* — and they had two copies of the same markup
 * that were already drifting: one carried `data-testid="google-signin"`, the
 * other `google-signup`, and nothing kept the rest in step.
 *
 * ## Why each provider is its own form
 *
 * A provider submission hands off and never returns to this render; the
 * credentials form posts and stays. Sharing one form would let the email
 * field's `required` validation block a provider button — a browser behaviour
 * nobody would guess from the code. `busy` is passed in from the parent so any
 * submission disables all of them: a second click during a redirect must not
 * start a second OAuth flow.
 *
 * ## Why GitHub is no longer conditional
 *
 * UI-19 put it behind `VIBE_GITHUB_AUTH` because the provider was not enabled
 * in the Supabase project, and a button that fails on the provider's own error
 * page is worse than no button. It is enabled now, and Vibe runs on **one**
 * Supabase project (VB-011), so there is no deployment where the offer is true
 * and another where it is not. A flag with one possible value is a second thing
 * to keep in step for no remaining reason.
 *
 * ## Why the buttons stack rather than sit side by side
 *
 * Two half-width buttons put the mark and four words into 178px at 390px wide,
 * where the label wraps. Stacked, each provider is one line at every width, and
 * the pair still reads as one group because the credentials form is separated
 * from it by the rule.
 */
type Provider = {
  action: (formData: FormData) => void;
  pending: boolean;
  testId: string;
};

export function ProviderRow({
  next,
  busy,
  verb,
  google,
  github,
}: {
  next: string;
  busy: boolean;
  /** "Continue" on sign-in, "Sign up" on account creation. */
  verb: string;
  google: Provider;
  github: Provider;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3">
        <form action={google.action}>
          <input type="hidden" name="next" value={next} />
          <Button
            type="submit"
            variant="secondary"
            disabled={busy}
            className="w-full"
            data-testid={google.testId}
            busy={google.pending}
          >
            {google.pending ? (
              "Opening Google…"
            ) : (
              <>
                <GoogleMark />
                {`${verb} with Google`}
              </>
            )}
          </Button>
        </form>

        <form action={github.action}>
          <input type="hidden" name="next" value={next} />
          <Button
            type="submit"
            variant="secondary"
            disabled={busy}
            className="w-full"
            data-testid={github.testId}
            busy={github.pending}
          >
            {github.pending ? (
              "Opening GitHub…"
            ) : (
              <>
                <GithubMark />
                {`${verb} with GitHub`}
              </>
            )}
          </Button>
        </form>
      </div>

      <div className="flex items-center gap-3" aria-hidden>
        <span className="bg-line-2 h-px flex-1" />
        <span className="text-fg-meta text-caption">or</span>
        <span className="bg-line-2 h-px flex-1" />
      </div>
    </div>
  );
}

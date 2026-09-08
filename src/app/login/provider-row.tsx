"use client";

import { Button } from "@/components/ui/button";

/**
 * The identity providers, and the rule below them (UI-19).
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
  /** Null where the deployment has not configured GitHub — see `providers.ts`. */
  github: Provider | null;
}) {
  return (
    <div className="flex flex-col gap-4">
      {/*
        Side by side when there are two, full width when there is one. A lone
        provider stretched across a column reads as the primary action of the
        screen, which it is not — the credentials form below it is.
      */}
      <div className={github ? "grid grid-cols-2 gap-3" : "grid"}>
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
            {google.pending ? "Opening Google…" : `${verb} with Google`}
          </Button>
        </form>

        {github && (
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
              {github.pending ? "Opening GitHub…" : `${verb} with GitHub`}
            </Button>
          </form>
        )}
      </div>

      <div className="flex items-center gap-3" aria-hidden>
        <span className="bg-line-2 h-px flex-1" />
        <span className="text-fg-meta text-caption">or</span>
        <span className="bg-line-2 h-px flex-1" />
      </div>
    </div>
  );
}

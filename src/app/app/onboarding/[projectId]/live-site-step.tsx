"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/states";
import { beginUnderstandingAction, continueWithoutLiveSiteAction, type BeginUnderstandingState } from "./actions";

const URL_ERRORS: Record<string, string> = {
  empty: "Add the address, or tell Vibe there is no live site yet.",
  malformed: "That does not look like a valid web address.",
  insecure_scheme: "Use the public https:// address.",
  unsupported_scheme: "Use an https:// web address.",
  credentials_present: "Remove the username and password from the address.",
  missing_hostname: "That address is missing a domain name.",
  internal_hostname: "Vibe can only visit public websites.",
  unsafe_address: "That address points to a private network.",
  project_not_found: "Vibe could not find this project.",
  save_failed: "The address could not be saved. Try again.",
};

export function LiveSiteStep({
  projectId,
  currentUrl,
  liveScanFailed,
}: {
  projectId: string;
  currentUrl: string | null;
  liveScanFailed: boolean;
}) {
  const router = useRouter();
  const [choice, setChoice] = useState<"provided" | "no_live_site_yet">(
    "provided",
  );
  const begin = beginUnderstandingAction.bind(null, projectId);
  const [state, action, pending] = useActionState<BeginUnderstandingState, FormData>(begin, null);
  const withoutLive = continueWithoutLiveSiteAction.bind(null, projectId);
  const [continueState, withoutLiveAction, continuing] = useActionState<BeginUnderstandingState, FormData>(withoutLive, null);

  const error = state && !state.ok ? state : null;

  useEffect(() => {
    if (state?.ok || continueState?.ok) router.refresh();
  }, [continueState, router, state]);

  return (
    <div className="flex flex-col gap-6">
      {liveScanFailed && (
        <Notice tone="waiting" label="Vibe couldn't reach that site">
          Check the address and retry, or continue from your code. The saved address remains available to fix later.
        </Notice>
      )}

      <form action={action} className="flex flex-col gap-5">
        <label className="border-line-3 has-checked:border-mint/60 bg-surface-2 flex cursor-pointer gap-3 rounded-xl border p-4">
          <input
            type="radio"
            name="liveSiteChoice"
            value="provided"
            checked={choice === "provided"}
            onChange={() => setChoice("provided")}
            className="mt-1 accent-mint"
          />
          <span className="flex flex-1 flex-col gap-1">
            <span className="text-fg-body font-medium">My product is live</span>
            <span className="text-fg-muted text-sm">Vibe will compare what is built with what customers can reach.</span>
          </span>
        </label>

        {choice === "provided" && (
          <Field
            id="productionUrl"
            label="Live product address"
            hint="Public https:// address. Vibe never needs a login here."
            error={error?.step === "url" ? (URL_ERRORS[error.error] ?? "Check this address.") : undefined}
          >
            <Input
              id="productionUrl"
              name="productionUrl"
              type="url"
              defaultValue={currentUrl ?? ""}
              placeholder="https://your-product.com"
              required
              aria-describedby="productionUrl-hint productionUrl-error"
            />
          </Field>
        )}

        <label className="border-line-3 has-checked:border-mint/60 bg-surface-2 flex cursor-pointer gap-3 rounded-xl border p-4">
          <input
            type="radio"
            name="liveSiteChoice"
            value="no_live_site_yet"
            checked={choice === "no_live_site_yet"}
            onChange={() => setChoice("no_live_site_yet")}
            className="mt-1 accent-mint"
          />
          <span className="flex flex-1 flex-col gap-1">
            <span className="text-fg-body font-medium">I don&apos;t have a live site yet</span>
            <span className="text-fg-muted text-sm">That is useful context. Vibe will get to know the product from your code.</span>
          </span>
        </label>

        {error?.step === "repository" && (
          <Notice tone="problem" label="Vibe couldn't read the connected product">
            {error.error === "github_access_revoked"
              ? "GitHub access was removed. Reconnect GitHub, then try again."
              : "Your connection is safe. Try again; Vibe will resume from this project."}
          </Notice>
        )}
        {error?.step === "live" && !liveScanFailed && (
          <Notice tone="waiting" label="Vibe couldn't reach the live product">
            Correct the address and retry, or continue without the live product.
          </Notice>
        )}
        {error?.step === "understanding" && (
          <Notice tone="problem" label="Vibe couldn't start Product Understanding">
            Nothing was lost. Try again from this project.
          </Notice>
        )}

        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={pending || continuing} busy={pending}>
            {pending ? "Vibe is reading your product…" : "Let Vibe get to know it"}
          </Button>
          {(liveScanFailed || error?.step === "live") && (
            <Button
              formAction={withoutLiveAction}
              variant="secondary"
              disabled={pending || continuing}
              busy={continuing}
            >
              {continuing ? "Continuing…" : "Continue without live product"}
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}

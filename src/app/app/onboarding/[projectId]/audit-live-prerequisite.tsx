"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/states";
import { beginUnderstandingAction, type BeginUnderstandingState } from "./actions";

export function AuditLivePrerequisite({ projectId }: { projectId: string }) {
  const router = useRouter();
  const begin = beginUnderstandingAction.bind(null, projectId);
  const [state, action, pending] = useActionState<BeginUnderstandingState, FormData>(begin, null);
  const error = state && !state.ok ? state : null;
  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [router, state]);

  return (
    <Notice tone="waiting" label="One source is still needed for the Business Audit">
      <div className="flex flex-col gap-4">
        <p>
          Product Understanding can work from code alone. The current Audit contract also compares the public product, so it cannot start until that check succeeds.
        </p>
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="liveSiteChoice" value="provided" />
          <Field
            id="auditProductionUrl"
            label="Live product address"
            error={error?.step === "url" ? "Check that this is a public https:// address." : undefined}
          >
            <Input
              id="auditProductionUrl"
              name="productionUrl"
              type="url"
              placeholder="https://your-product.com"
              required
            />
          </Field>
          {error?.step === "live" && (
            <p className="text-amber text-sm">Vibe could not reach that site. Correct it or try again.</p>
          )}
          <div>
            <Button type="submit" disabled={pending}>
              {pending ? "Checking your live product…" : "Add live product and continue"}
            </Button>
          </div>
        </form>
      </div>
    </Notice>
  );
}

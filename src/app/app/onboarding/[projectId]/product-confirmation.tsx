"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input, inputClassName } from "@/components/ui/field";
import { Notice } from "@/components/ui/states";
import { Surface } from "@/components/ui/surface";
import { MAX_CORRECTION_LENGTH } from "@/modules/product-understanding/schema";
import {
  confirmProductAndStartAuditAction,
  correctProductAndStartAuditAction,
  type ConfirmAndAuditState,
} from "./actions";

export type ConfirmationValues = {
  name: string;
  shortDescription: string;
  understanding: string;
  mainPurpose: string;
  mainPromise: string;
  primaryAudience: string;
  problemSolved: string;
};

const FIELDS: { name: keyof ConfirmationValues; label: string; long?: boolean }[] = [
  { name: "name", label: "Product name" },
  { name: "shortDescription", label: "One-line description" },
  { name: "understanding", label: "What your product does", long: true },
  { name: "mainPurpose", label: "What it is for" },
  { name: "mainPromise", label: "The value it creates" },
  { name: "primaryAudience", label: "Who it is for" },
  { name: "problemSolved", label: "The problem it solves", long: true },
];

function Failure({ state }: { state: ConfirmAndAuditState }) {
  if (!state || state.ok) return null;
  if (state.error === "live_product_intelligence_missing") {
    return (
      <Notice tone="waiting" label="Product confirmed">
        Your Product Profile is safe. The current Business Audit still needs a successful live-product check, so Vibe will help you add one next.
      </Notice>
    );
  }
  return (
    <Notice tone="problem" label="Vibe couldn't start the Audit">
      Your confirmation is safe. You can retry without repeating Product Understanding.
    </Notice>
  );
}

export function ProductConfirmation({
  projectId,
  profileId,
  values,
}: {
  projectId: string;
  profileId: string;
  values: ConfirmationValues;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [confirming, startTransition] = useTransition();
  const [confirmState, setConfirmState] = useState<ConfirmAndAuditState>(null);
  const correct = correctProductAndStartAuditAction.bind(null, projectId, profileId);
  const [correctionState, correctionAction, saving] = useActionState<ConfirmAndAuditState, FormData>(
    correct,
    null,
  );

  useEffect(() => {
    if (correctionState?.ok) router.refresh();
  }, [correctionState, router]);

  if (!editing) {
    return (
      <div className="flex flex-col items-center gap-4">
        <div className="flex flex-wrap justify-center gap-3">
          <Button
            type="button"
            disabled={confirming}
            onClick={() =>
              startTransition(async () => {
                const result = await confirmProductAndStartAuditAction(projectId, profileId);
                setConfirmState(result);
                router.refresh();
              })
            }
          >
            {confirming ? "Starting your Audit…" : "Looks right"}
          </Button>
          <Button type="button" variant="secondary" onClick={() => setEditing(true)}>
            Something&apos;s off
          </Button>
        </div>
        <Failure state={confirmState} />
      </div>
    );
  }

  return (
    <Surface level="section" padding="lg" className="w-full">
      <form action={correctionAction} className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h3 className="text-fg text-lg font-semibold">Fix the meaning, not the evidence.</h3>
          <p className="text-fg-muted text-sm">
            Change only what Vibe misunderstood. Your words become the canonical Product Profile.
          </p>
        </div>
        {FIELDS.map((field) => (
          <Field key={field.name} id={field.name} label={field.label}>
            {field.long ? (
              <textarea
                id={field.name}
                name={field.name}
                rows={3}
                maxLength={MAX_CORRECTION_LENGTH}
                defaultValue={values[field.name]}
                className={inputClassName}
              />
            ) : (
              <Input
                id={field.name}
                name={field.name}
                maxLength={MAX_CORRECTION_LENGTH}
                defaultValue={values[field.name]}
              />
            )}
          </Field>
        ))}
        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={saving} busy={saving}>
            {saving ? "Saving and starting Audit…" : "Save and continue"}
          </Button>
          <Button type="button" variant="secondary" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
        <Failure state={correctionState} />
      </form>
    </Surface>
  );
}

import { notFound } from "next/navigation";
import { Surface } from "@/components/ui/surface";
import { Notice } from "@/components/ui/states";
import { MonoLabel } from "@/components/ui/typography";
import {
  EXECUTION_MODE_LABELS,
  EXECUTION_REASON_LABELS,
  EXECUTION_RISK_LABELS,
} from "@/modules/execution-contract/view";
import { preflightRefusalLabel } from "@/modules/coding-agent/view";
import { formatCreditsForDisplay } from "@/modules/credits/units";
import { isDogfoodEligibleProject, previewDogfoodStep } from "@/modules/coding-agent/website-preflight";
import { requireProjectAccess } from "@/modules/projects/workspace-context";
import { getDogfoodRunStatusAction } from "./actions";
import { RunPanel } from "./run-panel";
import { StatusView } from "./status-view";

/**
 * One step's dogfood preview and start control (EXECUTION CORE-4 website gate,
 * §5, §6, §7, §11).
 *
 * Two states, driven entirely by the `run` search param rather than by
 * component state — which is what makes a reload recover correctly (§18): no
 * `run` means "show the preflight and the button", a `run` means "show durable
 * status for that operation", and both are re-derived from the database on
 * every request.
 */
export default async function AgentDogfoodStepPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string; stepKey: string }>;
  searchParams: Promise<{ run?: string }>;
}) {
  const { projectId, stepKey } = await params;
  const { run } = await searchParams;
  const { supabase, userId } = await requireProjectAccess(projectId);

  if (!isDogfoodEligibleProject(projectId)) notFound();

  if (run) {
    const status = await getDogfoodRunStatusAction(projectId, run);
    if (!status) notFound();
    return (
      <div className="flex flex-col gap-6">
        <Header />
        <StatusView projectId={projectId} status={status} />
      </div>
    );
  }

  const preview = await previewDogfoodStep(supabase, { projectId, userId, stepKey });

  return (
    <div className="flex flex-col gap-6">
      <Header />

      {!preview.eligible ? (
        <Notice tone="waiting" label="not eligible">
          {preview.resolution ? (
            <>
              <p>{EXECUTION_REASON_LABELS[preview.resolution.reason]}</p>
              {preview.preflight && !preview.preflight.passed && (
                <ul className="mt-2 list-inside list-disc">
                  {preview.preflight.refusals.map((refusal) => (
                    <li key={refusal}>
                      {/* The specific admission answer where there is one —
                          "your code changed" and "no Agent price exists" are
                          not the same sentence. */}
                      {preflightRefusalLabel(refusal, preview.resolution!.admission)}
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <p>
              {preview.reason === "no_action_plan" && "This project has no Action Plan yet."}
              {preview.reason === "step_not_found" && "That step could not be found."}
              {preview.reason === "repository_not_connected" && "No repository is connected."}
              {preview.reason === "repository_snapshot_missing" &&
                "Vibe has never successfully read this repository."}
              {preview.reason === "plan_incomplete" && "This plan is missing information a run needs."}
              {preview.reason === "not_dogfood_eligible" && "This project isn't enabled for the dogfood."}
            </p>
          )}
        </Notice>
      ) : (
        <>
          <Surface level="section" padding="md" className="flex flex-col gap-3">
            <div>
              <MonoLabel>vibe will work on</MonoLabel>
              <p className="text-fg text-sm font-semibold">{preview.stepTitle}</p>
            </div>
            <div>
              <MonoLabel>done when</MonoLabel>
              <p className="text-fg-prose text-sm">{preview.preflight.doneWhen}</p>
            </div>
            <div className="flex flex-wrap gap-6">
              <Field label="execution">{EXECUTION_MODE_LABELS[preview.resolution.mode]}</Field>
              <Field label="risk">{EXECUTION_RISK_LABELS[preview.resolution.riskClass]}</Field>
              {preview.preflight.validation.supported && (
                <Field label="validation">{preview.preflight.validation.profile}</Field>
              )}
            </div>
            {preview.preflight.limits && (
              <div className="flex flex-wrap gap-6">
                <Field label="max turns">{String(preview.preflight.limits.maxTurns)}</Field>
                <Field label="max files changed">{String(preview.preflight.limits.maxChangedFiles)}</Field>
                {/*
                  This said `launch-v1-budget`.

                  The label read "max Credits" and the value was
                  `budgetPolicyVersion` — a policy identifier printed where a
                  customer amount belongs, on the one screen in the product
                  that starts an agent run. `maxCredits` is now projected
                  through the preflight, so the two fields below say the two
                  different things they always claimed to: what the run may
                  cost a customer, and what Vibe will pay a provider.
                */}
                <Field label="max Credits">
                  {preview.preflight.economics.maxCredits === null
                    ? "—"
                    : `${formatCreditsForDisplay(preview.preflight.economics.maxCredits)} Credits`}
                </Field>
                <Field label="budget policy">
                  {String(preview.preflight.limits.budgetPolicyVersion)}
                </Field>
                <Field label="provider ceiling">
                  {`$${preview.preflight.limits.maxProviderSpendUsd.toFixed(2)}`}
                </Field>
              </div>
            )}
            <p className="text-fg-muted text-xs">
              No merge or deployment will happen automatically. {preview.economics.disclosure}
            </p>
          </Surface>

          <RunPanel projectId={projectId} stepKey={stepKey} />
        </>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: string }) {
  return (
    <div>
      <MonoLabel>{label}</MonoLabel>
      <p className="text-fg-prose text-sm">{children}</p>
    </div>
  );
}

function Header() {
  return (
    <div className="flex flex-col gap-1">
      <MonoLabel>internal — core-4 dogfood</MonoLabel>
      <h1 className="text-fg text-title font-bold">Run with Vibe</h1>
    </div>
  );
}

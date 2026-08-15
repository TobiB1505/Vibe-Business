"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  MONETIZATION_MODELS,
  PRIMARY_GOALS,
  PRODUCT_SUMMARY_MAX_LENGTH,
  PROJECT_STAGES,
  type BusinessContext,
} from "@/modules/projects/business-context";
import type { SaveBusinessContextFailure } from "@/modules/projects/business-context-store";
import { saveBusinessContextAction, type BusinessContextActionState } from "./business-context-action";

/**
 * Business context form (Sprint 4 §2, §29).
 *
 * Five fields, one required. Nothing sensitive is requested — no revenue,
 * no financial data, no personal information.
 */

const ERROR_MESSAGES: Record<SaveBusinessContextFailure, string> = {
  product_summary_required: "Describe what your product does.",
  product_summary_too_short: "Add a little more detail — one clear sentence is enough.",
  product_summary_too_long: `Keep the description under ${PRODUCT_SUMMARY_MAX_LENGTH} characters.`,
  target_customer_too_long: "Keep the target customer description shorter.",
  invalid_stage: "Choose a valid stage.",
  invalid_monetization_model: "Choose a valid monetization model.",
  invalid_primary_goal: "Choose a valid goal.",
  project_not_found: "This project could not be found.",
  save_failed: "Your business context could not be saved. Try again in a moment.",
};

const STAGE_LABELS: Record<(typeof PROJECT_STAGES)[number], string> = {
  prototype: "Prototype — not launched yet",
  launched_no_users: "Launched — no users yet",
  active_users: "Has active users",
  paid_customers: "Has paying customers",
};

const MONETIZATION_LABELS: Record<(typeof MONETIZATION_MODELS)[number], string> = {
  none: "None",
  planned: "Planned, not built yet",
  free: "Free",
  subscription: "Subscription",
  one_time: "One-time purchase",
  usage_based: "Usage-based",
  marketplace: "Marketplace / commission",
  other: "Other",
};

const GOAL_LABELS: Record<(typeof PRIMARY_GOALS)[number], string> = {
  launch: "Launch",
  get_first_users: "Get first users",
  monetize: "Start monetizing",
  improve_conversion: "Improve conversion",
  improve_retention: "Improve retention",
  grow_revenue: "Grow revenue",
};

const inputClass =
  "w-full rounded-md border border-line-strong bg-field px-3 py-1.5 text-sm text-fg-body placeholder:text-fg-meta focus:border-mint/60 focus:ring-mint/10 focus:ring-4 focus:outline-none";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-fg-muted">{label}</span>
      {children}
    </label>
  );
}

const initialState: BusinessContextActionState = null;

export function BusinessContextForm({
  projectId,
  context,
}: {
  projectId: string;
  context: BusinessContext | null;
}) {
  const action = saveBusinessContextAction.bind(null, projectId);
  const [state, formAction, pending] = useActionState(action, initialState);
  const [editing, setEditing] = useState(context === null);

  if (!editing && context !== null) {
    return (
      <div className="space-y-2">
        <dl className="space-y-1 text-sm">
          <div className="flex gap-2">
            <dt className="w-32 shrink-0 text-fg-muted">Product</dt>
            <dd className="text-fg-prose">{context.productSummary}</dd>
          </div>
          {context.targetCustomer && (
            <div className="flex gap-2">
              <dt className="w-32 shrink-0 text-fg-muted">Customer</dt>
              <dd className="text-fg-prose">{context.targetCustomer}</dd>
            </div>
          )}
          {context.stage && (
            <div className="flex gap-2">
              <dt className="w-32 shrink-0 text-fg-muted">Stage</dt>
              <dd className="text-fg-prose">{STAGE_LABELS[context.stage]}</dd>
            </div>
          )}
          {context.monetizationModel && (
            <div className="flex gap-2">
              <dt className="w-32 shrink-0 text-fg-muted">Monetization</dt>
              <dd className="text-fg-prose">{MONETIZATION_LABELS[context.monetizationModel]}</dd>
            </div>
          )}
          {context.primaryGoal && (
            <div className="flex gap-2">
              <dt className="w-32 shrink-0 text-fg-muted">Goal</dt>
              <dd className="text-fg-prose">{GOAL_LABELS[context.primaryGoal]}</dd>
            </div>
          )}
        </dl>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-xs text-fg-muted underline underline-offset-2 hover:text-fg-prose"
        >
          Edit business context
        </button>
      </div>
    );
  }

  return (
    <form action={formAction} className="max-w-xl space-y-3">
      <Field label="What does your product do? (required)">
        <textarea
          name="productSummary"
          required
          rows={3}
          maxLength={PRODUCT_SUMMARY_MAX_LENGTH}
          defaultValue={context?.productSummary ?? ""}
          placeholder="One or two sentences describing the product in plain language."
          className={inputClass}
        />
      </Field>

      <Field label="Who is it for?">
        <input
          type="text"
          name="targetCustomer"
          defaultValue={context?.targetCustomer ?? ""}
          placeholder="e.g. solo founders who ship with AI tools"
          className={inputClass}
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Stage">
          <select name="stage" defaultValue={context?.stage ?? ""} className={inputClass}>
            <option value="">Not specified</option>
            {PROJECT_STAGES.map((stage) => (
              <option key={stage} value={stage}>
                {STAGE_LABELS[stage]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Monetization">
          <select
            name="monetizationModel"
            defaultValue={context?.monetizationModel ?? ""}
            className={inputClass}
          >
            <option value="">Not specified</option>
            {MONETIZATION_MODELS.map((model) => (
              <option key={model} value={model}>
                {MONETIZATION_LABELS[model]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Primary goal">
          <select name="primaryGoal" defaultValue={context?.primaryGoal ?? ""} className={inputClass}>
            <option value="">Not specified</option>
            {PRIMARY_GOALS.map((goal) => (
              <option key={goal} value={goal}>
                {GOAL_LABELS[goal]}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : context ? "Save business context" : "Complete business context"}
        </Button>
        {context !== null && (
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="text-xs text-fg-muted underline underline-offset-2 hover:text-fg-prose"
          >
            Cancel
          </button>
        )}
      </div>

      {state && !state.ok && <p className="text-sm text-amber">{ERROR_MESSAGES[state.error]}</p>}
    </form>
  );
}

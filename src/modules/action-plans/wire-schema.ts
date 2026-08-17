import { MAX_PLAN_STEPS, STEP_ACTORS, STEP_CHANGE_KINDS } from "./schema";

/**
 * The Anthropic **transport** representation of an Action Plan, and the
 * normalizer back into domain shape (CORE-2b §12, §15, §85).
 *
 * ## What is deliberately absent — read this before adding a field
 *
 * There is no property here, at any depth, for:
 *
 *   - a repository path, file name, directory or glob
 *   - a git ref, branch name, base branch or commit sha
 *   - a commit message
 *   - generated code, a patch, a diff or file contents
 *   - a capability id, an execution flag or a safety level
 *   - a permission, scope or merge target
 *
 * That is CLAUDE.md Rule 57 and §10 made **structural**. The guarantee is not
 * "the prompt asks the model not to", which a jailbroken or simply confused
 * response could defeat; it is that there is no field for the value to arrive
 * in, `additionalProperties: false` on every object, and a normalizer that
 * copies named fields rather than spreading whatever it received.
 *
 * `rule-57.test.ts` walks this schema recursively and fails on any property
 * name that looks like one of the above, so a future field cannot reopen the
 * channel by accident.
 *
 * ## Written to the structured-outputs subset
 *
 * Every object sets `additionalProperties: false` and lists all properties as
 * `required`; no numeric or string-length constraints are used, since those are
 * unsupported. Counts, caps and ordering are enforced in `validate.ts`.
 *
 * The step shape is declared **once**, inside a single array — the compiled
 * grammar limit that rejected Sprint 4's first audit schema outright applies
 * here too.
 */

const STEP_ITEM_SCHEMA = {
  type: "object",
  properties: {
    order: {
      type: "integer",
      description:
        "1-based position. Unique and contiguous across the array, no gaps and no ties. 1 is what happens first.",
    },
    title: {
      type: "string",
      description: "Short imperative phrase naming the changed state, e.g. 'Confirm the first customer segment'.",
    },
    description: {
      type: "string",
      description: "One to three sentences on what actually happens in this step.",
    },
    purpose: {
      type: "string",
      description:
        "What this changes for the business, and why the plan needs it. Not a restatement of the title.",
    },
    actor: {
      type: "string",
      enum: [...STEP_ACTORS],
      description:
        "Who has to act. Use founder_decision for a strategic choice Vibe must not make; founder_action for real-world work only a person can do; external_party when something outside the product must happen first.",
    },
    changeKind: {
      type: "string",
      enum: [...STEP_CHANGE_KINDS],
      description:
        "What kind of changed state this produces. product_change means the product itself ends up different — including wiring up analytics or an automated check. measurement means the outcome becomes observable without changing the product: a signal is defined, an existing one is read, or someone confirms a just-built thing behaves as intended.",
    },
    completionCriteria: {
      type: "string",
      description:
        "How we know this step is done, stated as an observable state of the world. Never 'the work is complete'.",
    },
    dependsOn: {
      type: "array",
      items: { type: "integer" },
      description:
        "Orders of steps that must finish before this one can start. Empty for a step that can begin immediately. Never reference this step's own order, and never form a loop.",
    },
    evidenceIds: {
      type: "array",
      items: { type: "string" },
      description:
        "Evidence ids from the pack this step materially relies on. Never invent one. At most 4. Empty is correct for a purely strategic decision.",
    },
  },
  required: [
    "order",
    "title",
    "description",
    "purpose",
    "actor",
    "changeKind",
    "completionCriteria",
    "dependsOn",
    "evidenceIds",
  ],
  additionalProperties: false,
};

export const ANTHROPIC_ACTION_PLAN_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    goal: {
      type: "string",
      description:
        "One concrete business-level goal for this Move. Specific enough to be wrong. Never 'improve the business'.",
    },
    whyNow: {
      type: "string",
      description:
        "Why this Move is the one being worked on now, carried from the audit's own reasoning. Do not invent a second justification.",
    },
    expectedOutcome: {
      type: "string",
      description: "The state of the business once every step has succeeded.",
    },
    addressesRootProblem: {
      type: "string",
      description:
        "How that outcome changes the source business problem specifically. If this cannot be written, the plan is solving the wrong thing.",
    },
    assumptions: {
      type: "array",
      items: { type: "string" },
      description:
        "What the plan proceeds on that is not established, and what remains genuinely open. At most 4. May be empty.",
    },
    steps: {
      type: "array",
      description: `The ordered path. Usually 3 to 5 meaningful business steps; never more than ${MAX_PLAN_STEPS}. Two is a valid plan for a simple Move. Do not pad.`,
      items: STEP_ITEM_SCHEMA,
    },
  },
  required: ["goal", "whyNow", "expectedOutcome", "addressesRootProblem", "assumptions", "steps"],
  additionalProperties: false,
};

/** Why a provider response could not be read as a plan at all. */
export type PlanWireNormalizationReason =
  | "not_an_object"
  | "steps_not_an_array"
  | "steps_empty"
  | "step_not_an_object";

export type WirePlanStep = {
  order: unknown;
  title: unknown;
  description: unknown;
  purpose: unknown;
  actor: unknown;
  changeKind: unknown;
  completionCriteria: unknown;
  dependsOn: unknown;
  evidenceIds: unknown;
};

export type WirePlan = {
  goal: unknown;
  whyNow: unknown;
  expectedOutcome: unknown;
  addressesRootProblem: unknown;
  assumptions: unknown;
  steps: WirePlanStep[];
};

export type NormalizePlanResult =
  | { ok: true; plan: WirePlan }
  | { ok: false; reason: PlanWireNormalizationReason };

/**
 * Transport → domain shape, before any business rule runs.
 *
 * Structural only: is this an object with a non-empty array of objects? Every
 * value question — valid enums, contiguous orders, real evidence ids, vague
 * completion criteria — belongs to `validate.ts`, which is the layer that
 * decides whether a *billed* response is usable.
 *
 * Note the field-by-field copy rather than a spread. It is what makes the
 * Rule 57 guarantee hold at runtime and not only in the JSON Schema: a response
 * carrying `branch`, `commitMessage` or `capability` loses them here, whatever
 * the provider did or did not enforce upstream.
 */
export function normalizeAnthropicActionPlanOutput(data: unknown): NormalizePlanResult {
  if (typeof data !== "object" || data === null) return { ok: false, reason: "not_an_object" };

  const raw = data as Record<string, unknown>;
  if (!Array.isArray(raw.steps)) return { ok: false, reason: "steps_not_an_array" };
  if (raw.steps.length === 0) return { ok: false, reason: "steps_empty" };

  const steps: WirePlanStep[] = [];
  for (const entry of raw.steps) {
    if (typeof entry !== "object" || entry === null) {
      return { ok: false, reason: "step_not_an_object" };
    }
    const step = entry as Record<string, unknown>;
    steps.push({
      order: step.order,
      title: step.title,
      description: step.description,
      purpose: step.purpose,
      actor: step.actor,
      changeKind: step.changeKind,
      completionCriteria: step.completionCriteria,
      dependsOn: step.dependsOn,
      evidenceIds: step.evidenceIds,
    });
  }

  return {
    ok: true,
    plan: {
      goal: raw.goal,
      whyNow: raw.whyNow,
      expectedOutcome: raw.expectedOutcome,
      addressesRootProblem: raw.addressesRootProblem,
      assumptions: raw.assumptions,
      steps,
    },
  };
}

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getLatestProfile } from "@/modules/product-understanding/store";
import { getFounderIntent } from "@/modules/projects/founder-intent-store";
import { buildProductSummary } from "@/modules/projects/product-summary";
import { FRESHNESS_LABELS, freshnessOf } from "@/modules/nova/briefing/freshness";
import { untrusted } from "../orchestrator/prompt";

/**
 * What the agent knows before it calls anything.
 *
 * ## Small on purpose
 *
 * The brief is identity and orientation, not evidence. It says what the product
 * is, what the founder is trying to do, and how fresh each reading is — and it
 * stops there. The audit, the Moves, the plan and the resolver answers all sit
 * behind tools, because the point of a tool is to fetch something *when it is
 * needed*: a brief that preloaded the audit would pay for the audit on every
 * turn, including the ones that never mention it, and would hand the model a
 * score it could quote without ever having read a tool result.
 *
 * ## No number, anywhere
 *
 * Freshness crosses as a bucket — "months ago", never "94 days" — for the
 * reason `nova/briefing/freshness.ts` states: a model's sentence is persisted
 * and read later, so a number inside it is a lie with a delay on it. And a
 * numeral in the brief would be a numeral the reply validator has to allow,
 * which would let the model write a figure it never read from a tool. The two
 * arguments meet at the same rule.
 *
 * ## It is customer content, and it is fenced (rule 42)
 *
 * Every value below comes from the founder's own product. None of it goes near
 * the system prompt; it arrives in the user turn inside an `<untrusted>` fence
 * that names its source, and the prompt's rules say what a fence means.
 */

export type AgentContextBrief = {
  /** The fenced block the model reads. */
  rendered: string;
  /** Numerals the brief carried, which is always none. Kept so the validator can say so. */
  allowedNumericFacts: readonly string[];
};

export async function buildAgentContextBrief(
  supabase: SupabaseClient,
  params: { projectId: string; projectName: string },
): Promise<AgentContextBrief> {
  const [profile, intent] = await Promise.all([
    getLatestProfile(supabase, params.projectId),
    getFounderIntent(supabase, params.projectId),
  ]);

  const summary = buildProductSummary({
    profile: profile?.profile ?? null,
    primaryGoal: intent.intent?.primaryGoal ?? null,
  });

  const understandingAge = freshnessOf(
    profile?.stored.completedAt ?? profile?.stored.createdAt ?? null,
    new Date(),
  );

  const lines = [
    `product_name: ${profile?.profile.identity.name.value ?? params.projectName}`,
    `product_description: ${summary.shortDescription ?? "(Vibe has not worked out what this product is yet)"}`,
    `what_it_is_for: ${summary.mainPurpose ?? "(unknown)"}`,
    `who_it_is_for: ${summary.primaryAudience ?? "(unknown)"}`,
    `founder_goal: ${summary.founderGoal ?? "(the founder has not said)"}`,
    `product_understanding: ${
      profile
        ? `read ${understandingAge ? FRESHNESS_LABELS[understandingAge] : "at an unknown time"}`
        : "none — Vibe has never read this product"
    }`,
  ];

  return {
    rendered: untrusted("context-brief", lines.join("\n")),
    allowedNumericFacts: [],
  };
}

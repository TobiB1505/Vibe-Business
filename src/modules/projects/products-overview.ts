import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProductProfile, ProfileCorrections } from "@/modules/product-understanding/schema";
import { sanitizeCorrections } from "@/modules/product-understanding/store";
import type { PrimaryGoal } from "./founder-intent";
import { getDashboardOverview } from "./dashboard";
import { buildProductSummary, type ProductOverviewItem } from "./product-summary";

type ProfileRow = { id: string; project_id: string; result: ProductProfile | null };
type CorrectionsRow = { project_id: string; corrections: unknown };
type IntentRow = { project_id: string; primary_goal: PrimaryGoal | null };

export type ProductsOverview = { products: ProductOverviewItem[] };

/**
 * The detailed account product index.
 *
 * The dashboard read model remains the source of score, Move and repository
 * state. Three bounded account-wide reads add only the Product Profile fields
 * this screen can display: one profile id per latest audit, one correction row
 * per project and one founder-intent row per project. Nothing is read inside a
 * project loop, and no provider or external service is contacted.
 */
export async function getProductsOverview(
  supabase: SupabaseClient,
  userId: string,
): Promise<ProductsOverview> {
  const { projects } = await getDashboardOverview(supabase, userId);
  if (projects.length === 0) return { products: [] };

  const projectIds = projects.map((project) => project.id);
  const profileIds = projects.flatMap((project) =>
    project.productProfileId ? [project.productProfileId] : [],
  );

  const [profiles, corrections, intents] = await Promise.all([
    profileIds.length > 0
      ? supabase
          .from("product_profiles")
          .select("id, project_id, result")
          .in("id", profileIds)
          .eq("status", "completed")
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("product_profile_corrections")
      .select("project_id, corrections")
      .in("project_id", projectIds),
    supabase
      .from("project_founder_intent")
      .select("project_id, primary_goal")
      .in("project_id", projectIds),
  ]);

  for (const result of [profiles, corrections, intents]) {
    if (result.error) throw result.error;
  }

  const profileById = new Map(
    ((profiles.data ?? []) as ProfileRow[]).map((row) => [row.id, row.result] as const),
  );
  const correctionsByProject = new Map<string, ProfileCorrections>(
    ((corrections.data ?? []) as CorrectionsRow[]).map((row) => [
      row.project_id,
      sanitizeCorrections(row.corrections),
    ]),
  );
  const goalByProject = new Map(
    ((intents.data ?? []) as IntentRow[]).map((row) => [row.project_id, row.primary_goal] as const),
  );

  return {
    products: projects.map((project) => ({
      ...project,
      ...buildProductSummary({
        profile: project.productProfileId
          ? (profileById.get(project.productProfileId) ?? null)
          : null,
        corrections: correctionsByProject.get(project.id),
        primaryGoal: goalByProject.get(project.id) ?? null,
      }),
    })),
  };
}

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { countLiveConnections } from "@/modules/projects/repository-connection";

export type AccountProfileOverview = {
  productCount: number | null;
  repositoryCount: number | null;
};

async function countProducts(supabase: SupabaseClient, userId: string): Promise<number | null> {
  const { count, error } = await supabase
    .from("projects")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);

  if (error) return null;
  return count ?? null;
}

/**
 * Two bounded account facts for the profile workspace summary.
 *
 * Unknown stays null rather than becoming zero: a failed read must not make a
 * founder's connected work appear to have disappeared.
 */
export async function getAccountProfileOverview(
  supabase: SupabaseClient,
  userId: string,
): Promise<AccountProfileOverview> {
  const [productCount, repositoryCount] = await Promise.all([
    countProducts(supabase, userId),
    countLiveConnections(supabase),
  ]);

  return { productCount, repositoryCount };
}

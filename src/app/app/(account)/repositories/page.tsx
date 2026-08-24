import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/modules/auth/session";
import { getGithubIdentity } from "@/modules/github/identity";
import { listConnectedRepositories } from "@/modules/projects/account-repositories";
import { RepositoriesIndex } from "./repositories-index";

export const metadata = { title: "Repositories" };

/**
 * What code Vibe is attached to (CORE-6).
 *
 * ## Why this is a page and not a line on every product card
 *
 * Because `owner/repo` on every card is the account dashboard borrowing the
 * project workspace's density: three cards, three repository strings, and none
 * of them is what a founder came to that screen to read. The fact is real and
 * occasionally exactly what you need — which is what a page is for.
 *
 * ## What every row states, and what it deliberately does not
 *
 * The repository, the product it belongs to, the branch Vibe treats as
 * default, whether it is private, and when it was connected. All of that was
 * captured at connection time and is stored.
 *
 * It does **not** say whether the installation is still accessible or whether
 * the default branch has since moved. Both are live questions with a network
 * call behind them, and answering them here would put one GitHub round trip
 * per repository on an index page. The workspace asks, freshly, at the point
 * where the answer gates something — which is the only place the answer can be
 * trusted anyway.
 *
 * "Default branch" is named rather than explained: it is the branch a merge
 * would fast-forward, and nothing on this page merges anything.
 */
export default async function RepositoriesPage() {
  const session = await requireSession("/app/repositories");
  const supabase = await createClient();

  const [repositories, github] = await Promise.all([
    listConnectedRepositories(supabase, session.userId),
    getGithubIdentity(supabase, session.userId),
  ]);

  return <RepositoriesIndex repositories={repositories} githubLogin={github?.githubLogin ?? null} />;
}

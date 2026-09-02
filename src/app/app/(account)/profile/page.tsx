import { createClient } from "@/lib/supabase/server";
import { buildAccountIdentity } from "@/modules/auth/identity-view";
import { getAccountProfileOverview } from "@/modules/auth/profile-overview";
import { requireSession } from "@/modules/auth/session";
import { getGithubIdentity } from "@/modules/github/identity";
import { ProfileView } from "./profile-view";

export const metadata = { title: "Account Profile" };

/**
 * Profile (CORE-6).
 *
 * ## What the page can say honestly
 *
 * The person still has only an email address and an optional connected GitHub
 * identity. The fuller composition adds two bounded workspace counts and links
 * to controls that already exist; it does not invent editable preferences or
 * security state the product cannot persist.
 *
 * ## What it deliberately does not offer
 *
 * A name field. Adding one is a real decision with real consequences — a new
 * column or `user_metadata`, a place it is validated, a place it is displayed
 * instead of the GitHub login — and it belongs in a change that intends it,
 * not smuggled in as page filler.
 */
export default async function ProfilePage() {
  const session = await requireSession("/app/profile");
  const supabase = await createClient();

  const [github, overview] = await Promise.all([
    getGithubIdentity(supabase, session.userId),
    getAccountProfileOverview(supabase, session.userId),
  ]);
  const identity = buildAccountIdentity({ email: session.email, github });

  return (
    <ProfileView
      identity={identity}
      email={session.email}
      githubLogin={github?.githubLogin ?? null}
      productCount={overview.productCount}
      repositoryCount={overview.repositoryCount}
    />
  );
}

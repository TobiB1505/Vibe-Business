import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/modules/auth/session";
import { getFounderName } from "@/modules/auth/founder-profile";
import { getGithubIdentity } from "@/modules/github/identity";
import { ProfileView } from "./profile-view";

export const metadata = { title: "Profile" };

/**
 * Profile (CORE-6).
 *
 * The page keeps what a page owns: the session, the reads. Everything on
 * screen is `ProfileView`, for the same reason `AccountHome` is a component —
 * the browser harness renders components rather than pages, because it has no
 * database and no session. A fixture that re-assembled this screen itself
 * would be testing a page that exists only in the fixture file.
 */
export default async function ProfilePage() {
  const session = await requireSession("/app/settings/profile");
  const supabase = await createClient();

  const [github, founderName] = await Promise.all([
    getGithubIdentity(supabase, session.userId),
    getFounderName(supabase, session.userId),
  ]);

  return <ProfileView email={session.email} github={github} founderName={founderName} />;
}

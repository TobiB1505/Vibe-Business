import Link from "next/link";
import { redirect } from "next/navigation";
import { buttonClasses } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface";
import { MonoLabel } from "@/components/ui/typography";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/modules/auth/session";
import { getOnboardingRouting } from "@/modules/onboarding/store";
import { OnboardingShell } from "./onboarding-shell";

export default async function NewProjectOnboardingPage() {
  const session = await requireSession();
  const supabase = await createClient();
  const { data: projects, error } = await supabase
    .from("projects")
    .select("id")
    .eq("user_id", session.userId)
    .order("created_at", { ascending: false });
  if (error) throw error;

  const projectIds = (projects ?? []).map((project) => project.id);
  const { resumableProjectId } = await getOnboardingRouting(supabase, projectIds);
  if (resumableProjectId) redirect(`/app/onboarding/${resumableProjectId}`);
  // Reached with no projects at all, so there is no exit to offer and none is
  // rendered — `canLeave` stays false.
  if (projectIds.length > 0) redirect("/app");

  return (
    <OnboardingShell email={session.email} state="connect_source">
      <section className="flex max-w-[52rem] flex-col gap-8 py-5 sm:py-12">
        <header className="flex flex-col gap-4">
          <MonoLabel>Connect</MonoLabel>
          <h1 className="text-fg max-w-[14ch] text-[2.75rem] leading-[1.02] font-semibold tracking-[-0.055em] text-balance sm:text-[4.5rem]">
            Show Vibe what you built.
          </h1>
          <p className="text-fg-prose max-w-[58ch] text-base leading-relaxed sm:text-lg">
            Vibe reads your product, works out the business around it, and tells you where to
            start. Connect the code you already built.
          </p>
        </header>

        {/* Says what the next click does before it happens (UI-S1 §17). The
            founder is about to be handed to GitHub's own screen, and being
            told that in advance is the difference between a hand-off and a
            surprise. It describes the choice they will make rather than
            characterising the permissions the App holds. */}
        <Surface level="card" padding="lg" className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-1.5">
            <h2 className="text-fg text-lg font-semibold">Connect your code</h2>
            <p className="text-fg-muted max-w-[44ch] text-sm">
              GitHub will ask which repositories Vibe may access. You choose — Vibe only ever sees
              the ones you pick, and you can change that in GitHub at any time.
            </p>
          </div>
          <Link href="/app/connect/github" className={buttonClasses()}>
            Connect GitHub
          </Link>
        </Surface>
      </section>
    </OnboardingShell>
  );
}

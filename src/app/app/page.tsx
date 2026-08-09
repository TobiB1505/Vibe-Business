import { PageShell } from "@/components/layout/page-shell";
import { Button } from "@/components/ui/button";

export default function AppHomePage() {
  return (
    <PageShell>
      <header>
        <p className="text-sm font-medium tracking-wide text-zinc-500 uppercase">Vibe Business</p>
      </header>
      <main className="flex flex-1 flex-col justify-center gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Your projects</h1>
        <p className="text-zinc-400">No projects connected yet.</p>
        <div>
          <Button disabled title="Not implemented yet — see docs/sprints/0000-application-bootstrap.md">
            Connect your first project
          </Button>
        </div>
      </main>
    </PageShell>
  );
}

import { PageShell } from "@/components/layout/page-shell";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <PageShell>
      <main className="flex max-w-sm flex-1 flex-col justify-center gap-6">
        <div className="space-y-2">
          <p className="text-sm font-medium tracking-wide text-zinc-500 uppercase">Vibe Business</p>
          <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
          <p className="text-sm text-zinc-400">We&apos;ll email you a magic link — no password needed.</p>
        </div>
        <LoginForm />
      </main>
    </PageShell>
  );
}

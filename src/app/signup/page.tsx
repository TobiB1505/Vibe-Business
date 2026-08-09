import Link from "next/link";
import { PageShell } from "@/components/layout/page-shell";
import { SignupForm } from "./signup-form";

export default function SignupPage() {
  return (
    <PageShell>
      <main className="flex max-w-sm flex-1 flex-col justify-center gap-6">
        <div className="space-y-2">
          <p className="text-sm font-medium tracking-wide text-zinc-500 uppercase">Vibe Business</p>
          <h1 className="text-2xl font-semibold tracking-tight">Create account</h1>
          <p className="text-sm text-zinc-400">For development. No elaborate onboarding.</p>
        </div>
        <SignupForm />
        <p className="text-sm text-zinc-500">
          Already have an account?{" "}
          <Link href="/login" className="text-zinc-300 underline underline-offset-2 hover:text-zinc-50">
            Sign in
          </Link>
        </p>
      </main>
    </PageShell>
  );
}

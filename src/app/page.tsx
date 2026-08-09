import Link from "next/link";
import { PageShell } from "@/components/layout/page-shell";
import { buttonClassName } from "@/components/ui/button";

export default function HomePage() {
  return (
    <PageShell>
      <main className="flex flex-1 flex-col justify-center gap-8">
        <div className="space-y-4">
          <p className="text-sm font-medium tracking-wide text-zinc-500 uppercase">Vibe Business</p>
          <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            You vibe-coded the product.
            <br />
            Now vibe the business.
          </h1>
        </div>
        <p className="max-w-lg text-lg text-zinc-400">
          Vibe Business is an early-stage platform exploring the business layer for AI-built
          products — the monetization, distribution, and conversion work that starts after a
          build already exists. It&apos;s in early development: the core loop described in{" "}
          <span className="text-zinc-300">PRODUCT.md</span> is not built yet.
        </p>
        <div>
          <Link href="/login" className={buttonClassName}>
            Get started
          </Link>
        </div>
      </main>
    </PageShell>
  );
}

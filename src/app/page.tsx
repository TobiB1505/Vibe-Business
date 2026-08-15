import Link from "next/link";
import { MarketingShell } from "@/components/layout/marketing-shell";
import { buttonClasses } from "@/components/ui/button";
import { MonoLabel } from "@/components/ui/typography";

export default function HomePage() {
  return (
    <MarketingShell>
      <section className="flex max-w-3xl flex-col gap-8 py-20 sm:py-28">
        <MonoLabel>The business layer for AI-built products</MonoLabel>

        <h1 className="text-fg text-display sm:text-hero font-bold text-balance">
          You vibe-coded the product.
          <br />
          <span className="text-mint">Now vibe the business.</span>
        </h1>

        {/* Unchanged in substance from the pre-UI-0 page: this says the core
            loop is not finished, and it keeps saying that until it is. A
            marketing shell is not a licence to start promising outcomes. */}
        <p className="text-fg-prose text-lead max-w-[62ch]">
          Vibe Business is an early-stage platform exploring the business layer for AI-built
          products — the monetization, distribution, and conversion work that starts after a build
          already exists. It&apos;s in early development: the core loop described in{" "}
          <span className="text-fg-body font-mono text-sm">PRODUCT.md</span> is not built yet.
        </p>

        <div className="flex flex-wrap items-center gap-4">
          <Link href="/login" className={buttonClasses()}>
            Get started
          </Link>
          <span className="text-fg-meta text-xs">Email and password · GitHub connects after</span>
        </div>
      </section>
    </MarketingShell>
  );
}

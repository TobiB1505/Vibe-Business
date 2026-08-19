import type { Metadata } from "next";
import Link from "next/link";
import { MarketingShell } from "@/components/layout/marketing-shell";
import { BusinessMapPreview } from "@/components/marketing/business-map-preview";
import { buttonClasses } from "@/components/ui/button";
import { MonoLabel } from "@/components/ui/typography";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

/**
 * The landing page (UI-S1 §3–§6).
 *
 * ## What changed, and why it had to
 *
 * The previous version told visitors, in its own words, that "the core loop
 * described in PRODUCT.md is not built yet", and sent "Get started" to
 * `/login`. Both were once accurate and neither is now: the loop this page
 * described as unbuilt is what the product does, and a stranger with no
 * account pressing the primary button was being asked to sign in.
 *
 * ## The claim discipline this page is under
 *
 * Every sentence here describes something a founder can actually make happen
 * today, in the order they would happen. What is deliberately not claimed:
 * revenue, traffic, rankings, deployment, or that Vibe writes arbitrary code on
 * its own. Vibe merges nothing without an explicit human approval of one exact
 * commit, so the page says that rather than "safe" or "secure", which are
 * adjectives rather than behaviours.
 *
 * Internal vocabulary — prepared changes, validation runs, operation runs,
 * contract versions — appears nowhere. A founder who shipped something with
 * Lovable or Claude Code has no reason to know any of it, and a landing page is
 * not where a product should teach its own schema.
 */

const STEPS = [
  {
    label: "01",
    title: "Show Vibe what you built",
    body: "Connect the repository behind your product, and the live address if it already has one. Vibe reads it once and tells you what it thinks you built — in your words, not a file listing.",
  },
  {
    label: "02",
    title: "See what matters next",
    body: "Vibe works through nine areas of the business around your product and says which one is holding it back right now, which can wait, and why it reached that conclusion.",
  },
  {
    label: "03",
    title: "Let Vibe help improve it",
    body: "For the improvements Vibe supports, it prepares the change on its own branch, checks it builds, and shows you the result. Nothing reaches your main branch until you approve it.",
  },
] as const;

const TRUST = [
  {
    title: "Your code stays your code",
    body: "Vibe reads your repository to understand the product. It never keeps a copy of it — only what it concluded, and where in the project it saw the evidence.",
  },
  {
    title: "Changes are prepared in the open",
    body: "Anything Vibe prepares goes onto its own branch, separate from the one you ship from. You see the change and what it is meant to do before anything else happens.",
  },
  {
    title: "You have the last word",
    body: "Your main branch is only ever updated after you approve one specific reviewed change — and Vibe rechecks that the repository has not moved before it writes.",
  },
] as const;

export default function HomePage() {
  return (
    <MarketingShell>
      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section className="flex max-w-3xl flex-col gap-7 py-16 sm:py-24">
        <MonoLabel>The business layer for AI-built products</MonoLabel>

        <h1 className="text-fg text-display sm:text-hero font-bold text-balance">
          You vibe-coded the product.
          <br />
          <span className="text-mint">Now vibe the business.</span>
        </h1>

        <p className="text-fg-prose text-lead max-w-[62ch]">
          You built the thing. Vibe works out the business around it — what your product actually
          is, what is holding it back, and what to do about it next. Then it helps you do it.
        </p>

        <div className="flex flex-wrap items-center gap-4">
          <Link href="/signup" className={buttonClasses()}>
            Get started
          </Link>
          <Link href="/login" className={buttonClasses({ variant: "secondary" })}>
            Sign in
          </Link>
        </div>

        <p className="text-fg-muted text-xs">
          Bring a repository you have already built. A live address helps, but is not required to
          begin.
        </p>
      </section>

      {/* ── How it works ─────────────────────────────────────────────── */}
      <section aria-labelledby="how-it-works" className="flex flex-col gap-8 border-line-1 border-t py-16 sm:py-20">
        <div className="flex flex-col gap-3">
          <MonoLabel>How it works</MonoLabel>
          <h2 id="how-it-works" className="text-fg text-headline sm:text-display max-w-[20ch] font-bold text-balance">
            Turn what you built into a business.
          </h2>
        </div>

        <ol className="grid gap-4 sm:grid-cols-3">
          {STEPS.map((step) => (
            <li
              key={step.label}
              className="border-line-2 bg-surface-2 rounded-panel flex flex-col gap-3 border p-5 sm:p-6"
            >
              <span className="text-mint font-mono text-[0.65625rem] tracking-[0.16em]">
                {step.label}
              </span>
              <h3 className="text-fg text-title font-semibold">{step.title}</h3>
              <p className="text-fg-prose text-sm leading-relaxed">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ── Product proof ────────────────────────────────────────────── */}
      <section
        aria-labelledby="product-proof"
        className="border-line-1 grid gap-8 border-t py-16 sm:py-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-center lg:gap-12"
      >
        <div className="flex flex-col gap-4">
          <MonoLabel>The business audit</MonoLabel>
          <h2 id="product-proof" className="text-fg text-headline sm:text-display max-w-[18ch] font-bold text-balance">
            See what is working and where to start.
          </h2>
          <p className="text-fg-prose max-w-[52ch] leading-relaxed">
            Vibe reads nine areas of your business — from who your product is for, to how anyone
            would find it, to whether you could tell if it worked. Each one gets a verdict in plain
            language, ordered by what matters now rather than what is easiest to say.
          </p>
          <p className="text-fg-muted max-w-[52ch] text-sm leading-relaxed">
            When Vibe cannot judge something, it says so and leaves it unscored. An area it could
            not see is never counted against you.
          </p>
        </div>

        <BusinessMapPreview />
      </section>

      {/* ── Trust ────────────────────────────────────────────────────── */}
      <section aria-labelledby="trust" className="border-line-1 flex flex-col gap-8 border-t py-16 sm:py-20">
        <div className="flex flex-col gap-3">
          <MonoLabel>What Vibe does with your project</MonoLabel>
          <h2 id="trust" className="text-fg text-headline sm:text-display max-w-[22ch] font-bold text-balance">
            Nothing lands on your main branch without you.
          </h2>
        </div>

        <ul className="grid gap-4 sm:grid-cols-3">
          {TRUST.map((item) => (
            <li key={item.title} className="flex flex-col gap-2">
              <h3 className="text-fg-body font-semibold">{item.title}</h3>
              <p className="text-fg-prose text-sm leading-relaxed">{item.body}</p>
            </li>
          ))}
        </ul>

        <p className="text-fg-muted text-xs">
          Read the <Link href="/privacy" className="text-fg-muted hover:text-fg-body underline underline-offset-4">privacy notice</Link>{" "}
          and{" "}
          <Link href="/terms" className="text-fg-muted hover:text-fg-body underline underline-offset-4">terms</Link>.
        </p>
      </section>

      {/* ── Close ────────────────────────────────────────────────────── */}
      <section className="border-line-1 flex flex-col items-start gap-6 border-t py-16 sm:py-20">
        <h2 className="text-fg text-headline sm:text-display max-w-[18ch] font-bold text-balance">
          Start with the product you already have.
        </h2>
        <Link href="/signup" className={buttonClasses()}>
          Get started
        </Link>
      </section>
    </MarketingShell>
  );
}

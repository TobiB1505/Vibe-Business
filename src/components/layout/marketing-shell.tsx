import Link from "next/link";
import type { ReactNode } from "react";
import { VibeLockup } from "@/components/brand/vibe-mark";
import { MarketingHeader } from "@/components/layout/marketing-header";
import { buttonClasses } from "@/components/ui/button";

/**
 * The public marketing shell (UI-0).
 *
 * A blurred nav that leaves on the way down and returns on the way up
 * (`MarketingHeader`), an ambient mint wash and a faint grid behind the
 * content, a quiet footer. The wash and grid are decorative and `aria-hidden`; the grid
 * is drawn with a gradient rather than an asset so it costs no request.
 *
 * The nav carries the two ways in. The footer carries the legal surfaces, which
 * exist as real routes as of UI-S1 — a product that asks for access to
 * someone's repository has to say what it does with it somewhere reachable.
 * Nothing here links to a route that does not exist. The trust page is still
 * absent. Pricing is a section of the landing page rather than a route, which
 * is why this links `/#pricing` — and why Vibe's own live analysis reported no
 * pricing surface on a page that was showing three prices.
 */
export function MarketingShell({ children }: { children: ReactNode }) {
  return (
    <div className="text-fg-body relative isolate min-h-dvh overflow-clip">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-64 left-1/2 -z-10 h-[56rem] w-[68rem] -translate-x-1/2 rounded-full"
        style={{
          background: "radial-gradient(closest-side, rgb(0 229 160 / 0.16), rgb(0 229 160 / 0))",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          backgroundImage:
            "linear-gradient(rgb(255 255 255 / 0.018) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255 / 0.018) 1px, transparent 1px)",
          backgroundSize: "80px 80px",
        }}
      />

      {/*
        The room the whole scroll happens in (UI-34).

        The hero stands on a lit field and each module step carries a pool of
        its own, but the stretches between them were flat black: a vertical
        profile down the left edge read 15–19 in the green channel through the
        hero, **12–13 for five hundred pixels** after it, then 21–28 at the
        first module. A page that goes dark between its lit places is not one
        atmosphere, it is three pictures with gaps.

        This is `fixed` rather than `absolute` on purpose. An absolute layer
        would have to span ten thousand pixels and place its light at
        percentages of a height that changes every time a block is added; a
        fixed one is the size of the window, so every scroll position has
        ground under it and nothing has to be re-tuned when the page grows.

        It is very low — the pools at the hero and at each step are what a
        reader actually notices. This only stops the floor from falling away
        between them.

        The pools are centred vertically and tall, because a fixed layer paints
        the same light at every scroll position: an off-centre one put an
        identical dark quarter at the foot of every screen, which reads as a
        vignette stuck to the window rather than as a room. Centred, the
        variation as you scroll comes from the step pools moving through it,
        which is the half that is supposed to move.
      */}
      <div
        aria-hidden
        className="landing-room pointer-events-none fixed inset-0 -z-10"
        style={{
          backgroundImage:
            "radial-gradient(ellipse 46% 78% at 4% 50%, rgb(0 229 160 / 0.075), transparent 74%), radial-gradient(ellipse 46% 78% at 96% 50%, rgb(0 229 160 / 0.06), transparent 74%)",
        }}
      />

      {/*
        Out of the way on the way down, back on the way up — the founder's
        note on the endless scroll. `MarketingHeader` owns the behaviour and
        the three obligations that come with it; the nav inside is unchanged
        and still renders on the server.
      */}
      <MarketingHeader>
        <nav className="mx-auto flex w-full max-w-[96rem] items-center gap-4 px-5 py-4 sm:px-10">
          <Link href="/" className="rounded-nav" aria-label="Vibe Business — home">
            <VibeLockup size={22} />
          </Link>
          <div className="ml-8 hidden items-center gap-7 lg:flex">
            {/*
              Five destinations, and every one of them is a section this page
              actually has (UI-34).

              *Product* pointed at the trust bento and *How it works* at the
              tab bar; both were taken apart when the walk absorbed what they
              said, and a link into a deleted id scrolls nowhere and reports
              nothing. `landing.spec.ts` walks these and fails on the first one
              that lands on no section.
            */}
            {[
              ["Nova", "/#nova"],
              ["Product", "/#scan"],
              ["How it works", "/#agent"],
              ["Business Brain", "/#brain"],
              ["Pricing", "/#pricing"],
            ].map(([label, href]) => (
              <Link
                key={href}
                href={href}
                className="text-fg-secondary hover:text-fg rounded-inline text-body font-medium transition-interactive"
              >
                {label}
              </Link>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2 sm:gap-4">
            <Link
              href="/login"
              className="text-fg-secondary hover:text-fg-body rounded-inline px-2 text-body transition-interactive"
            >
              Sign in
            </Link>
            <Link href="/signup" className={buttonClasses()}>
              Get started
            </Link>
          </div>
        </nav>
      </MarketingHeader>

      <main className="mx-auto w-full max-w-[96rem] px-5 sm:px-10">{children}</main>

      <footer className="border-line-1 mt-20 border-t">
        {/*
          One row of links, one line of identity, in that order at every width.
          The tagline had an `ml-auto` variant for phones, which on a 390px
          screen pushed itself between "Vibe Business" and "Privacy" and left
          the links wrapping around it.
        */}
        <div className="mx-auto flex w-full max-w-[96rem] flex-col gap-4 px-5 py-8 sm:px-10">
          <nav
            aria-label="Footer"
            className="flex flex-wrap items-center gap-x-6 gap-y-3 text-caption"
          >
            <span className="text-fg-muted font-mono">Vibe Business</span>
            {[
              ["Privacy", "/privacy"],
              ["Terms", "/terms"],
              ["Sign in", "/login"],
            ].map(([label, href]) => (
              <Link
                key={href}
                href={href}
                className="text-fg-muted hover:text-fg-body rounded-inline transition-interactive"
              >
                {label}
              </Link>
            ))}
          </nav>
          <p className="text-fg-muted text-caption">The business layer for AI-built products.</p>
        </div>
      </footer>
    </div>
  );
}

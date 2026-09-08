import type { ReactNode } from "react";
import { VibeLockup } from "@/components/brand/vibe-mark";

/**
 * The sign-in / sign-up shell (UI-0; redesigned UI-19, rebuilt UI-20).
 *
 * ## Why the split screen is gone
 *
 * UI-19 removed the left panel's headline, on the argument that nobody arrives
 * at `/login` undecided and a second pitch competes with the form. That was
 * right about the headline and wrong about what was left: a half-screen panel
 * carrying two short lines at its foot is a half-screen of nothing, and at 1440
 * that is roughly 700px of empty material beside the only thing on the page.
 *
 * Emptiness reads as balance when it is symmetric and as a hole when it is not.
 * So the screen is one centred column now — the shape every reference
 * implementation of this screen converges on, and the shape this content
 * actually has.
 *
 * ## Why there are no assurances on it either
 *
 * Two of them survived the panel — *changes land on their own branch*,
 * *nothing merged without your approval* — and moved under the form. Both are
 * true, and neither is what this screen is for: a person at `/login` is
 * getting in, and a person at `/signup` has already decided. The argument for
 * trusting Vibe with a repository belongs where that decision is actually
 * made — the landing page, and the connect screen that asks for the grant.
 * Restating it here made the column longer without making it more convincing.
 *
 * ## Why there is still no card
 *
 * The founder's call in UI-19, and it survives the change of layout: the fields
 * are wells with their own borders, and a box around the only content on the
 * page says "this part, not the rest" where there is no rest. The column is
 * held by its width and by the material behind it, not by a frame.
 */
export function AuthShell({ children }: { /** The heading and the form. */ children: ReactNode }) {
  return (
    <div className="text-fg-body relative flex min-h-dvh flex-col overflow-clip">
      {/*
        One wash behind the column rather than a panel beside it. Centred on
        the content, so the material is where the reader is looking.
      */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-56 left-1/2 size-[52rem] -translate-x-1/2 rounded-full"
        style={{
          background: "radial-gradient(closest-side, rgb(0 229 160 / 0.13), rgb(0 229 160 / 0))",
        }}
      />
      {/*
        The grain the rest of the product wears, so this screen is made of the
        same material as the one behind it rather than a flat field with a glow
        on it.
      */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.5]"
        style={{
          backgroundImage:
            "linear-gradient(rgb(255 255 255 / 0.016) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255 / 0.016) 1px, transparent 1px)",
          backgroundSize: "72px 72px",
        }}
      />

      {/*
        A `main` landmark, which these four screens did not have before UI-18.
        Measured then: `document.querySelector("main")` was null on all four.
      */}
      <main className="relative flex flex-1 items-center justify-center px-5 py-14 sm:px-8">
        <div className="flex w-full max-w-[24rem] flex-col gap-8">
          <VibeLockup />

          <div className="flex flex-col gap-7">{children}</div>
        </div>
      </main>

      {/*
        The tagline alone.

        Terms and Privacy were here too, and on `/signup` that made two links
        to the same document 200px apart — one of them inside the sentence
        that legally matters. A duplicate weakens the one that counts, and a
        row of legal links on a sign-in screen is furniture.
      */}
      <footer className="text-fg-meta relative px-5 pb-8 text-center font-mono text-caption">
        The business layer for AI-built products.
      </footer>
    </div>
  );
}

/**
 * The heading of an auth screen, and the way to the other one.
 *
 * ## Why the switch sits here rather than under the form
 *
 * Because it answers "am I on the right screen", and that question is asked
 * before the first field, not after the last. It was below the submit button:
 * a person who opened sign-in meaning to create an account read the heading,
 * filled in an email, filled in a password, and only then met the sentence
 * telling them they were in the wrong place.
 */
export function AuthHeading({
  title,
  children,
}: {
  title: string;
  /** The one sentence under it, carrying the way to the other screen. */
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-fg text-headline font-bold">{title}</h1>
      <p className="text-fg-muted text-body">{children}</p>
    </div>
  );
}

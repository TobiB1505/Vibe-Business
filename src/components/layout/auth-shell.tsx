import type { ReactNode } from "react";
import { VibeLockup } from "@/components/brand/vibe-mark";

/**
 * The sign-in / sign-up shell (UI-0, redesigned UI-19).
 *
 * Two halves on a wide screen: material on the left, the form on the right.
 * Below `lg` the left half collapses to the lockup alone and the form takes
 * the screen — on a phone, someone opening `/login` came to sign in, and
 * making them scroll past a value proposition to reach the password field is a
 * desktop composition imposed on a phone.
 *
 * ## Why the left panel stopped talking
 *
 * It carried a hero line — *"You vibe-coded the product. Now vibe the
 * business."* — and a paragraph of intro. Both are on the landing page, which
 * is where somebody who has not decided yet is standing. Nobody arrives at
 * `/login` undecided; they arrive to get in. A second pitch beside the form
 * competes with it for the one thing this screen is for.
 *
 * What is left is what a person deciding whether to hand over a repository
 * actually needs: the material, and two facts. *Changes land on their own
 * branch.* *Nothing merged without your approval.* Both are properties of the
 * system as built — rules 58, 67 and 71 — not claims about it.
 *
 * ## Why there is no card
 *
 * The form used to sit inside a raised `VibeCard`, in a column that is already
 * the only thing on its half of the screen. A card is a way of saying "this
 * part, not the rest"; where there is no rest, it is a box drawn around the
 * only content. The fields are wells with their own borders and the ground is
 * the ground.
 *
 * The mockups' drifting mint glow is present as a static radial wash. The
 * animation belongs to the motion sprint; the shape it animates is here so
 * that sprint is a change of one declaration.
 */
export function AuthShell({
  assurances,
  children,
}: {
  /**
   * Short factual guarantees, on the panel.
   *
   * Each must be something the system actually does — this is the screen where
   * a stranger decides whether to trust Vibe with a repository, and a sentence
   * here that the implementation does not enforce is the worst possible place
   * for one. Omitted on recovery screens, where the subject is the account
   * rather than the product.
   */
  assurances?: string[];
  /** The form column. */
  children: ReactNode;
}) {
  return (
    <div className="text-fg-body grid min-h-dvh lg:grid-cols-2">
      <div className="border-line-1 relative hidden flex-col justify-between overflow-clip border-r p-14 lg:flex">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-44 -left-32 size-[46rem] rounded-full"
          style={{
            background: "radial-gradient(closest-side, rgb(0 229 160 / 0.15), rgb(0 229 160 / 0))",
          }}
        />
        {/*
          The grain the rest of the product wears, so this screen is made of
          the same material as the one behind it rather than a flat field with
          a glow on it.
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
        <div className="relative">
          <VibeLockup />
        </div>

        {/*
          Anchored to the foot rather than centred in the half.

          Two lines floating in the middle of a tall empty panel read as
          content that lost its container. At the bottom, with the tagline
          under them, they read as a footing — and the emptiness above becomes
          the material, which is what it is for.
        */}
        <div className="relative flex flex-col gap-8">
          {assurances && assurances.length > 0 && (
            <ul className="text-fg-prose flex flex-col gap-4 text-lead">
              {assurances.map((assurance) => (
                <li key={assurance} className="flex items-center gap-3.5">
                  <span
                    aria-hidden
                    className="bg-mint-tint border-mint-line text-mint flex size-6 shrink-0 items-center justify-center rounded-full border text-meta"
                  >
                    ✓
                  </span>
                  {assurance}
                </li>
              ))}
            </ul>
          )}

          <p className="text-fg-muted font-mono text-caption">
            The business layer for AI-built products.
          </p>
        </div>
      </div>

      {/*
        A `main` landmark, which these four screens did not have.

        Measured before UI-18: `document.querySelector("main")` was null on
        `/login`, `/signup`, `/forgot-password` and `/reset-password`. The panel
        beside this one is material that disappears below `lg`; this column is
        the page, so it is what a reader skipping to the content should land on.
      */}
      <main className="flex items-center justify-center px-5 py-12 sm:px-10">
        <div className="flex w-full max-w-[24rem] flex-col gap-7">
          <div className="lg:hidden">
            <VibeLockup />
          </div>
          {children}
        </div>
      </main>
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

import { LandingStep } from "@/components/marketing/landing-step";
import { Reveal } from "@/components/marketing/reveal";
import { MonoLabel } from "@/components/ui/typography";
import { cn } from "@/lib/utils/cn";
import { isSensitivePath } from "@/modules/repository-intelligence/path-policy";

/**
 * The boundary, drawn (UI-34).
 *
 * ## The seventh shape
 *
 * Two tiles, a staircase, a narrowing, a passage, a thread, a ladder — and now
 * a **line with things crossing it**. The block's subject is a boundary, so the
 * picture is one: your repository on the left, Vibe on the right, and a rule
 * between them that some things cross as a sentence and others do not cross at
 * all.
 *
 * It is the objection every other block postpones. A product that asks for
 * access to the repository somebody's company is built on has to answer *what
 * do you keep* before it answers anything else, and the honest answer is
 * unusually good: conclusions and the paths that justify them, and nothing else
 * (rule 26).
 *
 * ## The policy decides the sides, not this file
 *
 * `isSensitivePath` is the product's own rule, and it runs here. A page that
 * listed "we never read .env" would be a promise; a page that asks the function
 * which side each path falls on is showing the mechanism, and it cannot drift
 * from the product because it *is* the product. Widen the policy and this block
 * moves a row across on its own.
 *
 * The distinction the policy carries is worth the block on its own: observing
 * that a sensitive path **exists** is fine and useful — a repository with a
 * `.env.production` is telling you something — and retrieving its content is
 * forbidden outright (rule 28).
 *
 * ## What the right-hand column may say
 *
 * Sentences, never contents. Vibe stores derived intelligence plus the evidence
 * paths that justify it: never source files, README bodies, raw manifests,
 * lockfiles or configs (rule 26), and from the web side never HTML, page text,
 * cookies or query strings (rule 37). The examples on the right are all of the
 * first kind, and the README row exists to say the difference out loud.
 */

/**
 * Five real paths, and what Vibe ends up holding about each.
 *
 * `arrives` is `null` where the policy refuses the content — the row stops at
 * the line, and the reason beside it is the policy's own distinction rather
 * than a softer paraphrase of it.
 */
const CROSSINGS: { path: string; arrives: string | null; refusal?: string }[] = [
  { path: "src/app/page.tsx", arrives: "A Next.js application, 14 routes, one of them public." },
  { path: "package.json", arrives: "Payments are a dependency here — nothing charges yet." },
  { path: "README.md", arrives: "What the product says it is for. The path, never the text." },
  {
    path: ".env.local",
    arrives: null,
    refusal: "That this file exists is a fact about your product. What is in it is not Vibe's.",
  },
  {
    path: "certs/private.key",
    arrives: null,
    refusal: "Refused on the name, before anything gets as far as asking for the bytes.",
  },
];

export function LandingBoundary() {
  return (
    <LandingStep index="07" id="boundary" labelledBy="boundary-heading" className="py-20 sm:py-28">
      <Reveal from="up">
        <div className="flex flex-col gap-5">
          <MonoLabel className="text-mint">The boundary</MonoLabel>
          <h2
            id="boundary-heading"
            className="text-fg max-w-[24ch] text-[clamp(2rem,3.6vw,3rem)] leading-[1.06] font-bold tracking-[-0.045em] text-balance"
          >
            Vibe reads your repository. It never keeps a copy of it.
          </h2>
          <p className="text-fg-prose max-w-[58ch] leading-relaxed">
            Files are read through GitHub into memory, under a budget, and what survives the reading
            is a sentence. No clone, no checkout and no working tree of your repository ever exists
            inside Vibe — the sandbox that runs your code clones it itself, and is destroyed with
            it.
          </p>
        </div>
      </Reveal>

      {/*
        The line, and what crosses it. Three columns at `lg`: the path, the
        boundary itself, and the sentence that arrives — or, for a path the
        policy refuses, nothing arriving and the reason standing on the left
        side of the rule where the refusal happens.
      */}
      <ul className="mt-16 flex flex-col gap-px sm:mt-20">
        {CROSSINGS.map(({ path, arrives, refusal }, index) => {
          // The product's own policy, asked at render time rather than
          // transcribed into a promise.
          const refused = isSensitivePath(path);

          return (
            <li key={path}>
              <Reveal from="up" delay={Math.min(index, 3) * 0.05}>
                <div className="grid items-center gap-x-6 gap-y-2 py-4 lg:grid-cols-[minmax(0,14rem)_3rem_minmax(0,1fr)]">
                  <p
                    className={cn(
                      "font-mono text-ui",
                      refused
                        ? "text-fg-muted line-through decoration-line-strong"
                        : "text-fg-body",
                    )}
                  >
                    {path}
                  </p>

                  {/*
                    The crossing. An arrow where a sentence gets through and a
                    stop where nothing does — drawn, and `aria-hidden`, because
                    the words either side already carry it.
                  */}
                  <span
                    aria-hidden
                    className="relative hidden h-full items-center justify-center lg:flex"
                  >
                    {/* The boundary itself. Drawn per row rather than once
                        behind the list, so it survives a row being added,
                        removed or reordered — and the rows sit a pixel apart,
                        which reads as one line. */}
                    <span className="bg-line-strong absolute inset-y-[-1rem] left-1/2 w-px" />
                    <span
                      className={cn(
                        "bg-app relative rounded-full px-1.5 font-mono text-body",
                        refused ? "text-fg-disabled" : "text-mint",
                      )}
                    >
                      {refused ? "⊣" : "→"}
                    </span>
                  </span>

                  {arrives ? (
                    <p className="text-fg-body text-body leading-relaxed">{arrives}</p>
                  ) : (
                    <p className="text-fg-muted text-body leading-relaxed">
                      <span className="text-fg-secondary">Never opened.</span> {refusal}
                    </p>
                  )}
                </div>
              </Reveal>
            </li>
          );
        })}
      </ul>

      <Reveal from="up" delay={0.1} className="mt-12">
        <div className="border-line-2 grid gap-8 border-t pt-8 sm:grid-cols-2 lg:gap-16">
          <div className="flex flex-col gap-2">
            <MonoLabel className="text-mint">Kept</MonoLabel>
            <p className="text-fg-body leading-relaxed">
              What Vibe concluded, and the evidence paths that justify it — so you can open the file
              it read and check the sentence against it.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <MonoLabel className="text-fg-meta">Never kept</MonoLabel>
            <p className="text-fg-muted leading-relaxed">
              Your source, your README&apos;s text, your manifests, lockfiles and configs. From your
              live site: no HTML, no page text, no cookies, and no query strings — those carry
              tokens and email addresses often enough that the whole string is refused.
            </p>
          </div>
        </div>
      </Reveal>
    </LandingStep>
  );
}

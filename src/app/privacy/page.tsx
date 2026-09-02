import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, LegalSection } from "@/components/marketing/legal-page";

export const metadata: Metadata = {
  title: "Privacy",
  description: "What Vibe Business reads, what it keeps, and what it does not.",
};

/**
 * The privacy notice (UI-S1 §7, §27).
 *
 * Every factual claim below is a behaviour the codebase enforces, and each one
 * is here because it is enforced rather than because it reads well:
 *
 * - "never keeps a copy of your repository" — CLAUDE.md rule 26, which permits
 *   derived intelligence plus evidence paths and nothing else.
 * - "never reads the contents of secret files" — rule 28. Their existence may
 *   be observed; their contents are never fetched.
 * - "never keeps the page itself" — rule 37, which excludes HTML, body text,
 *   cookies and query strings from anything persisted.
 * - "never asks for or stores the model's reasoning" — rule 43.
 * - "never stores what was sent to or returned by the model" — rule 47.
 * - "not present once you are signed in" — [ADR 0041](docs/decisions/0041-marketing-attribution-pixel.md),
 *   which renders the Meta Pixel on public paths only and on production only.
 *
 * The retention periods in "How long Vibe keeps things" are the constants in
 * [`modules/retention/periods.ts`](../../modules/retention/periods.ts), and
 * `retention-disclosure.test.ts` fails if the two disagree. That guard is the
 * point rather than a formality: **a published period that nothing honours is a
 * false statement, which is worse than the silence it replaced** — so the two
 * classes a daily sweep enforces are stated as facts, and the two it does not
 * are stated as what is kept rather than as a promise to delete.
 *
 * What is deliberately absent: a legal basis table, a subprocessor list with
 * contract dates, and any certification. None of those exist yet, and a privacy
 * notice that invents them is worse than one that admits the gap.
 */
export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy"
      updated="2 September 2026"
      summary="Vibe reads your project to work out what you built and how business-ready it is. It keeps what it concluded and where it saw the evidence — not your code, and not the pages it visited."
      pending={[
        "The name and registered address of the company operating Vibe Business",
        "A contact address for privacy questions and data requests",
        "An automatic deletion of billing records at the end of the statutory period — today they are kept, and nothing removes them when it ends",
        "The legal basis for processing, and the transfer mechanism for data handled outside your region",
        "A reviewed list of subprocessors and the agreements covering them",
        "Consent for advertising cookies where the law requires asking first, and a way to decline",
      ]}
    >
      <LegalSection heading="What Vibe collects about you">
        <ul>
          <li>
            <strong className="text-fg-body">Your account.</strong> An email address, and either a
            password or the fact that you signed in with Google. Authentication is handled by
            Supabase on Vibe&apos;s behalf.
          </li>
          <li>
            <strong className="text-fg-body">What you tell Vibe.</strong> The repository you
            connect, the live address you give it if you have one, corrections you make to what
            Vibe concluded, and answers to questions Vibe asks during an audit.
          </li>
          <li>
            <strong className="text-fg-body">A record of what happened.</strong> Which analyses ran,
            when, whether they succeeded, and how much AI processing they used. This is what makes
            the product auditable to you.
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="Your repository">
        <p>
          When you connect a repository, Vibe reads its file structure and a small number of
          project files in order to work out what the product is. It does not keep a copy. What is
          stored is what Vibe concluded, plus the paths where it saw the evidence for each
          conclusion — so you can check its reasoning without Vibe holding your source code.
        </p>
        <p>
          Vibe never reads the contents of files that hold secrets — environment files, keys,
          certificates and credential files. It may notice that such a file exists, because that is
          itself a fact about the project, but it does not open it.
        </p>
        <p>
          Vibe never runs your code as part of understanding it. When a change needs to be checked,
          that happens in an isolated, throwaway environment that carries none of your credentials
          and none of Vibe&apos;s.
        </p>
      </LegalSection>

      <LegalSection heading="Your live product">
        <p>
          If you give Vibe a public address, it makes ordinary web requests to it — the same kind a
          visitor&apos;s browser makes — and looks only at pages on that same site. It does not sign
          in, does not run the page&apos;s scripts, and does not follow links to other domains.
        </p>
        <p>
          Vibe does not keep the pages it fetched. No HTML, no page source, no full page text, no
          cookies, and no query strings — which routinely carry tokens and email addresses. What is
          stored is what Vibe concluded and a short label for where it saw it.
        </p>
      </LegalSection>

      <LegalSection heading="AI processing">
        <p>
          Vibe uses a third-party AI provider (currently Anthropic) to turn the evidence it gathered
          into conclusions. The evidence Vibe assembled is sent to that provider for the length of
          the request. The model is given no tools, no web access and no access to your repository
          or to Vibe&apos;s database — it only ever sees the bounded evidence Vibe put in front of
          it.
        </p>
        <p>
          Vibe does not request, store or display the model&apos;s internal reasoning. It stores the
          validated conclusion, a short explanation, and references to the evidence behind it. The
          record of usage keeps token counts and cost — never the text sent to the model, and never
          the text it returned.
        </p>
      </LegalSection>

      <LegalSection heading="Services Vibe relies on">
        <p>
          Running Vibe involves other companies. As things currently stand these are Supabase
          (database and sign-in), Vercel (hosting and change checking), Anthropic (AI processing),
          GitHub (reading the repository you connect), Sentry (error monitoring, configured not to
          send identifying data), and Meta (advertising measurement on Vibe&apos;s public pages).
          This list will be reviewed and formalised before public launch.
        </p>
      </LegalSection>

      <LegalSection heading="Advertising measurement">
        <p>
          Vibe advertises, and its public pages — this one, the home page, sign-in and sign-up —
          carry Meta&apos;s pixel so that a visit can be attributed to the ad that produced it. It
          reports that a page was viewed, and the address of that page. Nothing is passed to it
          about you: not your email address, not your account, not what you connected.
        </p>
        <p>
          It is not present once you are signed in. Everything under your dashboard is outside its
          reach entirely — the tag is not loaded there — so the projects you work on are never part
          of what Meta sees. It also runs only on the live product, never on development or preview
          builds.
        </p>
      </LegalSection>

      <LegalSection heading="How long Vibe keeps things">
        <p>
          Different records are kept for different lengths of time, because they answer different
          questions.
        </p>
        <ul>
          <li>
            <strong className="text-fg-body">The step-by-step log of a run</strong> — every action
            an analysis or an agent took while it was working — is kept for{" "}
            <strong className="text-fg-body">90 days</strong> and then deleted. A job inside Vibe&apos;s
            database removes expired records once a day.
          </li>
          <li>
            <strong className="text-fg-body">The record of what happened</strong> — which analyses
            ran, when, and whether they succeeded — is kept for{" "}
            <strong className="text-fg-body">18 months</strong>, so that a question asked late still
            has a year of history behind it. Removed by the same daily job.
          </li>
          <li>
            <strong className="text-fg-body">Billing and payment records</strong> are kept for as
            long as the law requires — under German commercial and tax law that is{" "}
            <strong className="text-fg-body">up to ten years</strong>. Vibe cannot delete these on
            request, and does not delete them when you close your account: it removes your identity
            from them instead, so the figures survive and your name does not.
          </li>
          <li>
            <strong className="text-fg-body">What Vibe concluded about your product</strong> — your
            audits, analyses and plans — is kept for as long as the project exists, and goes when
            you delete the project or your account. It is not kept on a timer, because an analysis
            that is a year old is still the most recent thing Vibe knows about a project nobody has
            re-run.
          </li>
        </ul>
        <p>
          You can delete your account from{" "}
          <strong className="text-fg-body">Settings</strong> inside Vibe. That removes your sign-in,
          your projects and what Vibe concluded about them. Three things it does not do, and the
          screen says all three before you confirm: it does not uninstall the Vibe GitHub App, which
          you remove yourself in your GitHub settings; a subscription is cancelled immediately with
          no refund of the time already paid for; and the billing records above stay, without your
          name on them.
        </p>
      </LegalSection>

      <LegalSection heading="Your choices">
        <p>
          You choose which repositories Vibe can see, through GitHub&apos;s own installation screen,
          and you can change or remove that access at any time from your GitHub settings. You can
          disconnect a repository from a project inside Vibe. Giving Vibe a live address is
          optional — Vibe can work from your code alone.
        </p>
        <p>
          For anything else, including deleting your account and what Vibe holds about it, the
          contact address is one of the items still to be added above. Until it exists, ask through
          whichever channel you are already in touch with us on.
        </p>
      </LegalSection>

      <LegalSection heading="Changes to this notice">
        <p>
          This notice will change as the product does. The date at the top is when it last changed.
          See also the{" "}
          <Link href="/terms" className="text-mint hover:text-mint-hover">
            terms
          </Link>
          .
        </p>
      </LegalSection>
    </LegalPage>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, LegalSection } from "@/components/marketing/legal-page";

export const metadata: Metadata = {
  title: "Terms — Vibe Business",
  description: "The terms you agree to when you use Vibe Business.",
  alternates: { canonical: "/terms" },
};

/**
 * The terms of service (UI-S1 §7, §27).
 *
 * Conservative on purpose. The clauses that carry weight are the ones about
 * what Vibe does to a repository, and each states a rule the system enforces
 * rather than a promise it makes:
 *
 * - changes land on isolated branches, never the default one (rule 58);
 * - the default branch moves only after a human approves one exact reviewed
 *   commit, and only by fast-forward to it (rules 67, 71);
 * - "merged" means the branch was moved and read back — never deployed, and
 *   moving it can still trigger the customer's own CI/CD (rule 74).
 *
 * The last of those is why the deployment paragraph is worded as a warning
 * rather than a disclaimer. Telling someone "Vibe does not deploy" and letting
 * them discover their own pipeline does would be technically true and
 * practically a lie.
 */
export default function TermsPage() {
  return (
    <LegalPage
      title="Terms"
      updated="17 August 2026"
      summary="Vibe analyses the product you connect and can prepare improvements to it. You decide what happens to your code — nothing reaches the branch you ship from unless you approve it."
      pending={[
        "The name and registered address of the company providing the service",
        "Which country's law governs these terms and where disputes are handled",
        "Pricing, billing and refund terms once the product is paid for",
        "Notice periods for changes to the service or to these terms",
        "A support contact and any response commitments",
      ]}
    >
      <LegalSection heading="What this service is">
        <p>
          Vibe Business analyses a software product you already built, assesses how business-ready
          it is, suggests what to improve first, and — for the kinds of improvement it supports —
          prepares those changes for you to review.
        </p>
        <p>
          It is early-stage software. Features change, and some analyses may be unavailable or
          incomplete depending on what evidence your project provides. Vibe tells you when it could
          not assess something rather than guessing.
        </p>
      </LegalSection>

      <LegalSection heading="Your account and your project">
        <p>You are responsible for:</p>
        <ul>
          <li>keeping your sign-in details to yourself;</li>
          <li>
            only connecting repositories you own, or that you are authorised by their owner to
            connect;
          </li>
          <li>
            only giving Vibe a live address for a product you are entitled to have analysed.
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="What Vibe will and will not do to your code">
        <ul>
          <li>
            Anything Vibe prepares is written to its own separate branch. Vibe never writes to the
            branch you ship from without an approval.
          </li>
          <li>
            The branch you ship from is only updated after you approve one specific reviewed
            change, and only if the repository has not moved since — if it has, Vibe stops and tells
            you rather than merging around the difference.
          </li>
          <li>
            Vibe never rewrites history, never force-updates a branch, and never deletes one.
          </li>
          <li>
            Vibe does not deploy your product. But updating the branch you ship from may start your
            own deployment pipeline, if you have one. That consequence is yours, and Vibe says so
            before you approve.
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="Advice, not guarantees">
        <p>
          What Vibe concludes about your business is analysis, not a promise about outcomes. Vibe
          does not guarantee revenue, traffic, search rankings, customers, or that following its
          suggestions will improve any of them. Decisions about your product remain yours, and you
          are expected to review a change before approving it.
        </p>
        <p>
          Checks that a prepared change builds and passes your project&apos;s own commands are
          evidence that those commands succeeded in an isolated environment. They are not a
          statement that the change is correct, safe, or ready for your customers.
        </p>
      </LegalSection>

      <LegalSection heading="Acceptable use">
        <p>
          Do not use Vibe to analyse products you have no right to, to attempt to reach systems you
          do not control, or to work around the approval steps described above. Vibe may suspend
          access where it reasonably believes this is happening.
        </p>
      </LegalSection>

      <LegalSection heading="Availability and liability">
        <p>
          The service is provided as it is, without warranty, and may be unavailable, interrupted or
          changed. To the fullest extent the applicable law allows, Vibe Business is not liable for
          indirect or consequential loss arising from your use of it. The precise limits, and the
          law that applies to them, are among the items still to be completed above.
        </p>
      </LegalSection>

      <LegalSection heading="Ending it">
        <p>
          You can stop using Vibe at any time, remove its access from your GitHub settings, and
          disconnect repositories from inside the product. We may end or suspend access where these
          terms are broken.
        </p>
      </LegalSection>

      <LegalSection heading="Changes">
        <p>
          These terms will change as the product does. The date at the top is when they last
          changed. See also the{" "}
          <Link href="/privacy" className="text-mint hover:text-mint-hover">
            privacy notice
          </Link>
          .
        </p>
      </LegalSection>
    </LegalPage>
  );
}

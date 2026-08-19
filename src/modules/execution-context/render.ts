import {
  BRIEF_BUDGET,
  type ContextFact,
  type ExecutionBrief,
  type FactSource,
  type FileCandidate,
} from "./brief";

/**
 * The Execution Brief as prompt text — and the byte budget that bounds it.
 *
 * ## Why rendering is its own file
 *
 * The compiler decides *what is true and relevant*. This decides *what is worth
 * paying for*. They are different questions with different failure modes: the
 * compiler's is selecting the wrong facts, this one's is spending more on the
 * brief than the exploration it replaces. Separating them means the byte
 * ceiling can be tightened without touching selection, and selection can be
 * improved without re-deriving the ceiling.
 *
 * ## The trust boundary (PART J, Rule 25, Rule 42)
 *
 * Everything rendered here is derived from a customer's repository, plan or
 * recorded answers. None of it was authored by Vibe, so none of it may reach a
 * system prompt, and all of it is wrapped by the caller in a labelled untrusted
 * fence. The structure carries its share of the load too: a fact renders as a
 * subject, a bounded value and a provenance tag, so a sentence arriving in a
 * repository file cannot present itself here as a heading, a rule or a task.
 *
 * The brief is a *starting point*, and the text says so in Vibe's own words in
 * the system prompt — never inside the fence, where a repository could have
 * written it.
 */

/** Short enough to identify a commit, long enough not to collide. */
const SHORT_SHA = 12;

const SOURCE_LABELS: Record<FactSource, string> = {
  repository_scan: "repo scan",
  product_profile: "product profile",
  live_product_scan: "live scan",
  execution_spec: "execution spec",
};

const SUBJECT_LABELS: Record<string, string> = {
  framework: "framework",
  router: "routing",
  runtime: "runtime",
  package_manager: "package manager",
  check_command: "checks",
  public_surface: "public pages",
  authenticated_surface: "authenticated area",
  auth_boundary: "authentication",
  route_group: "structure",
  api_location: "api",
  business_surface: "surface",
  product_capability: "product does",
};

const REASON_LABELS: Record<FileCandidate["reason"], string> = {
  business_surface_evidence: "Vibe's analysis cites this for this surface",
  route_source: "route file matching this step",
  layout: "layout, where site-wide concerns live here",
};

function renderFact(fact: ContextFact): string {
  const label = SUBJECT_LABELS[fact.subject] ?? fact.subject;
  const provenance = `[${SOURCE_LABELS[fact.source]}, ${fact.confidence}]`;
  const evidence =
    fact.evidence.length > 0
      ? ` — seen in ${fact.evidence.map((item) => item.path).join(", ")}`
      : "";
  return `- ${label}: ${fact.value} ${provenance}${evidence}`;
}

function renderCandidate(candidate: FileCandidate): string {
  const note = candidate.note ? ` (${candidate.note})` : "";
  return `- ${candidate.path}${note} — ${REASON_LABELS[candidate.reason]} [${candidate.confidence}]`;
}

export type RenderedBrief = {
  /** The fence body. The caller labels and wraps it. */
  text: string;
  bytes: number;
  factsRendered: number;
  /**
   * Of those, how many came from the repository scan.
   *
   * Separate because it is the number that decides whether the agent is told to
   * *start from* the briefing. A brief whose only surviving facts are the
   * spec's own framework list and package manager describes no tree, and
   * instructing an agent to start from it would be instructing it not to look
   * around on the strength of something that says nothing about where anything
   * is.
   */
  repositoryFactsRendered: number;
  candidatesRendered: number;
  /** Left out by selection *and* by this byte budget, together. */
  factsOmitted: number;
  candidatesOmitted: number;
};

/**
 * Renders a brief under a hard byte ceiling.
 *
 * Lines are added in the compiler's rank order and stop when the budget runs
 * out, so what survives a squeeze is what ranked highest — and what did not is
 * counted rather than dropped silently. A bounded selection presented as the
 * whole of what is known is how a reader comes to believe Vibe knows less than
 * it does, and a model is a reader.
 *
 * The freshness line is written before anything is measured, because it is the
 * one line that must never be the one cut: a brief that lost its "this describes
 * a different commit" warning is worse than no brief.
 */
export function renderExecutionBrief(brief: ExecutionBrief): RenderedBrief {
  const head: string[] = [];

  if (brief.freshness.state === "fresh") {
    head.push(
      `Vibe analysed this repository at commit ${brief.freshness.executionSha.slice(0, SHORT_SHA)},`,
      "which is the commit your working copy is checked out at. Paths below were real then.",
    );
  } else if (brief.freshness.state === "stale") {
    head.push(
      "Vibe's repository analysis was taken at a different commit than the one you are working",
      "against, so nothing derived from it is included: a path that has moved is worse than no",
      "path. Find your way around by reading the repository.",
    );
  } else {
    head.push(
      "Vibe has no repository analysis for this commit, so nothing below is derived from one.",
      "Find your way around by reading the repository.",
    );
  }

  if (brief.live.origin) {
    head.push(
      "",
      `The product appears to be deployed at ${brief.live.origin}. Whether what is deployed`,
      "matches this commit is not known — treat it as background, not as the code you are editing.",
    );
  }

  const tailBudget = 200; // room for the truncation note, if one is needed
  let budget = BRIEF_BUDGET.maxRenderedBytes - Buffer.byteLength(head.join("\n"), "utf8") - tailBudget;

  const factLines: string[] = [];
  let factsRendered = 0;
  let repositoryFactsRendered = 0;
  for (const fact of brief.facts) {
    const line = renderFact(fact);
    const cost = Buffer.byteLength(`${line}\n`, "utf8");
    if (cost > budget) break;
    budget -= cost;
    factLines.push(line);
    factsRendered += 1;
    if (fact.source === "repository_scan") repositoryFactsRendered += 1;
  }

  const candidateLines: string[] = [];
  let candidatesRendered = 0;
  for (const candidate of brief.fileCandidates) {
    const line = renderCandidate(candidate);
    const cost = Buffer.byteLength(`${line}\n`, "utf8");
    if (cost > budget) break;
    budget -= cost;
    candidateLines.push(line);
    candidatesRendered += 1;
  }

  const factsOmitted = brief.truncated.factsOmitted + (brief.facts.length - factsRendered);
  const candidatesOmitted =
    brief.truncated.candidatesOmitted + (brief.fileCandidates.length - candidatesRendered);

  const sections: string[] = [...head];

  if (factLines.length > 0) {
    sections.push("", "What Vibe already established:", ...factLines);
  }

  if (candidateLines.length > 0) {
    sections.push(
      "",
      "Files Vibe's analysis points at for this step (a starting point, not the answer):",
      ...candidateLines,
    );
  }

  if (brief.likelyIrrelevantAreas.length > 0 && budget > 120) {
    sections.push(
      "",
      `Probably not involved in this step: ${brief.likelyIrrelevantAreas.join(", ")}.`,
    );
  }

  if (factsOmitted > 0 || candidatesOmitted > 0) {
    sections.push(
      "",
      `Vibe knows more than this: ${factsOmitted} further fact(s) and ${candidatesOmitted} ` +
        "further file(s) were left out to keep this short.",
    );
  }

  const text = sections.join("\n").trim();

  return {
    text,
    bytes: Buffer.byteLength(text, "utf8"),
    factsRendered,
    repositoryFactsRendered,
    candidatesRendered,
    factsOmitted,
    candidatesOmitted,
  };
}

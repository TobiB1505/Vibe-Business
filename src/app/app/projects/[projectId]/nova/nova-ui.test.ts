import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * What Nova Home may and may not put on a screen.
 *
 * ## Why these are source assertions
 *
 * The project has no React rendering harness, and the rules being checked are
 * about what the markup is *allowed to contain* rather than about what a tree
 * computes. `command-center-ui.test.ts` set the precedent, and its own comment
 * notes the cost: it has to strip comments to avoid matching its reasoning.
 * Same technique here.
 *
 * The behavioural half — that waiting never reads as working, that one control
 * dominates, that a price is carried before the click — is asserted over
 * values in `home-view.test.ts`, where it belongs.
 */

const NOVA_DIR = join(process.cwd(), "src/app/app/projects/[projectId]/nova");

/** Comments state what the code must not do, and would match every rule. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const FILES = readdirSync(NOVA_DIR)
  .filter((name) => name.endsWith(".tsx") || name.endsWith(".ts"))
  .filter((name) => !name.endsWith(".test.ts"))
  .map((name) => ({ name, body: stripComments(readFileSync(join(NOVA_DIR, name), "utf8")) }));

const component = (name: string) => FILES.find((file) => file.name === name)?.body ?? "";

/**
 * The render blocks, which live beside the components rather than beside the
 * screen.
 *
 * Home imports them through the barrel now, so the decisions they encode —
 * which frame a composed surface gives up, which chrome a gate drops — are
 * asserted where they are made rather than where they used to be pasted.
 */
const block = (name: string) =>
  stripComments(readFileSync(join(process.cwd(), "src/components/nova/blocks", name), "utf8"));

describe("Nova Home", () => {
  it("has the components this slice is made of", () => {
    for (const name of [
      "nova-home.tsx",
      "nova-focus-thread.tsx",
      "nova-rail.tsx",
      "nova-header-live.tsx",
    ]) {
      expect(component(name), name).not.toBe("");
    }
  });

  describe("money", () => {
    it("never states a currency", () => {
      for (const { name, body } of FILES) {
        // `USD` word-bounded and case-sensitive: `statusDot` contains "usD".
        expect(body, name).not.toMatch(/\$\d|\bUSD\b|\bdollars?\b/);
      }
    });

    it("renders a price through the one component that resolves it", () => {
      /*
       * `CostDisclosure` resolves a retail kind to a figure, and it is the
       * only thing that does. No screen formats Credits by hand.
       *
       * Where it renders moved: it used to be a line above the button, and it
       * is now inside the control, because `study-move` chose the design where
       * cost and action are one object. `ActionBlock` stays for the
       * consequence disclosure.
       */
      expect(component("nova-home.tsx")).toContain("<ActionBlock");
      for (const { name, body } of FILES) {
        expect(body, name).not.toContain("Credits`");
        expect(body, name).not.toMatch(/formatCredits/);
      }
    });

    it("carries the price on the control, and only there", () => {
      /*
       * One commitment, one object. `ActionBlock` would render a second copy
       * of the same figure above the same button if it were given `operation`
       * as well, which is the two-objects-for-one-decision shape the Move was
       * chosen to end.
       */
      const home = component("nova-home.tsx");
      expect(home).toMatch(/<NovaServerActionControl[\s\S]*?operation=\{meta\.price\}/);
      expect(home).not.toMatch(/<ActionBlock\s+operation=/);
    });

    it("never hides the price behind the consequence disclosure", () => {
      // Nova passes `operation` for the price and `consequence` for the prose
      // — never the price as the prose. A price a founder has to expand to see
      // is a price disclosed after the decision.
      const home = component("nova-home.tsx");
      expect(home).toContain("operation={meta.price}");
      expect(home).not.toMatch(/consequence=\{[^}]*price/);
    });

    /*
     * The chosen Move, not the filled mint block every earlier study drew.
     * `study-move` compared three in all four states and B won on the ground
     * that emphasis should come from luminance rather than from area of
     * accent — which is the chosen direction's own sentence.
     */
    it("presses through the Move rather than a generic button", () => {
      const control = component("nova-control.tsx");
      expect(control).toContain("NovaMoveButton");
      expect(control).toContain("NovaMoveLink");
      expect(control).not.toMatch(/<Button\b|buttonClasses\(/);
    });
  });

  describe("progress", () => {
    it("shows no percentage, bar or step counter", () => {
      for (const { name, body } of FILES) {
        expect(body, name).not.toMatch(/\d+\s*%/);
        expect(body, name).not.toMatch(/progress(bar|Bar)|role="progressbar"/);
        expect(body, name).not.toMatch(/\bstep \d+ of\b/i);
      }
    });

    it("never sets Nova's mark by hand", () => {
      /*
       * The mark is the one element on this page that can *look* like
       * activity. Every caller takes its state from `novaPresenceState`; a
       * literal would be a component asserting work nobody observed.
       */
      for (const { name, body } of FILES) {
        expect(body, name).not.toMatch(/state=["'](working|listening|settled|idle)["']/);
      }
      expect(component("nova-home.tsx")).toContain("novaPresenceState(");
    });

    it("keeps continuous motion out of everything but the mark", () => {
      // The aperture owns its own loops and pauses them on a hidden tab. No
      // Nova surface adds a second continuous animation beside it.
      for (const { name, body } of FILES) {
        expect(body, name).not.toMatch(/animate-(pulse|spin|bounce|ping)/);
      }
    });

    it("bounds the entrance and lets reduced motion skip it", () => {
      const rise = component("nova-rise.tsx");
      expect(rise).toContain("useReducedMotion");
      // The finished state renders immediately rather than animating to it.
      expect(rise).toMatch(/if \(reduceMotion\) return/);

      const delays = [...component("nova-home.tsx").matchAll(/delay=\{([\d.]+)\}/g)].map((m) =>
        Number(m[1]),
      );
      expect(delays.length).toBeGreaterThan(0);
      // Nothing readable waits longer than the reveal budget.
      expect(Math.max(...delays)).toBeLessThanOrEqual(0.4);
    });
  });

  describe("evidence", () => {
    it("never renders a raw evidence id", () => {
      // Citations arrive already resolved; the id is dropped in the reader.
      for (const { name, body } of FILES) {
        expect(body, name).not.toMatch(/evidenceIds|\.evidence\[\d\]\.id\b/);
      }
    });

    /*
     * Home used to resolve citations itself, for a finding card it rendered
     * under the business score. Both are gone: the score belongs to Business
     * Health and the audit's own blocker is inside the audit block, which is
     * the shipped component and resolves its own evidence.
     *
     * So the assertion inverts. Home holds no evidence resolver of its own,
     * because a second one is how two surfaces come to describe one id
     * differently.
     */
    it("resolves no evidence itself", () => {
      for (const { name, body } of FILES) {
        expect(body, name).not.toContain("describeEvidenceId");
      }
    });

    /**
     * The bug this was written for.
     *
     * Every product-profile field is an `Attributed<T>` — `{ value,
     * confidence, sources, evidence }` — so reaching into the stored document
     * for `identity.category` hands React an object to render, and the enum
     * inside it (`developer_tool`) is a machine token no founder should read.
     * Both faults come from the same move: parsing a domain document in a
     * surface instead of asking the module that owns its words.
     */
    it("takes display values from a module's view boundary, never from a stored document", () => {
      const reader = component("nova-home-data.ts");

      expect(reader).toContain("buildHeadline");
      // No walking into a profile or audit document for something to print.
      expect(reader).not.toMatch(/result\??\.\s*identity/);
      expect(reader).not.toMatch(/\.\s*identity\s*\??\.\s*\w+\s*\??\.\s*value/);
    });

    it("puts the conclusion above the evidence, never the other way round", () => {
      const finding = readFileSync(
        join(process.cwd(), "src/components/system/finding-card.tsx"),
        "utf8",
      );
      const title = finding.indexOf("{title}");
      const citations = finding.indexOf("<CitationCount");
      expect(title).toBeGreaterThan(-1);
      expect(citations).toBeGreaterThan(title);
    });
  });

  describe("hierarchy", () => {
    /*
     * This used to assert that exactly one file raised a `VibeCard`, which was
     * the Focus Card. Home is a thread now: what leads is a bubble, and what
     * Vibe made is a render block. Neither is a raised card, and the rule the
     * old assertion protected — one primary object per view — is now held by
     * there being one primary *moment*, which `deriveNovaFocus` decides.
     *
     * So the check inverts. A `VibeCard` reappearing on Home would be the old
     * shape growing back beside the new one.
     */
    it("raises no card, because the thread has no tiles", () => {
      const raised = FILES.filter((file) => /<VibeCard/.test(file.body));
      expect(raised.map((file) => file.name)).toEqual([]);
    });

    /*
     * The three objects, and the rule between them: nothing executable goes
     * inside a bubble. A bubble shows that Nova is *saying* something; a
     * control is something the founder does, and one object cannot be both.
     */
    it("keeps every control outside the bubble", () => {
      const thread = component("nova-focus-thread.tsx");
      expect(thread).toContain("<NovaBubble");
      // The control is a prop rendered in its own slot, never a child.
      expect(thread).not.toMatch(/<NovaBubble[^>]*>\s*\{control\}/);
    });

    it("gives the attention stack no controls of its own", () => {
      const stack = component("attention-stack.tsx");
      expect(stack).not.toMatch(/<Button|<form|ActionBlock|CostDisclosure/);
    });

    /*
     * Two columns, not a grid of tiles, and the distinction is the whole
     * point. The rail is the work and the thread is the conversation; they are
     * different *kinds* of thing at different widths, which is why one is
     * fixed at 300px and the other takes what is left.
     *
     * A symmetric grid is the shape the audit found and this design replaced:
     * six equal doors on arrival, with nothing saying which to open. So the
     * check is that no equal-column grid appears, rather than that no grid
     * does.
     */
    it("is a rail and a thread, never a grid of equal tiles", () => {
      const home = component("nova-home.tsx");
      /*
       * The two columns are `NovaRoom`'s now. Home composes the room rather
       * than drawing its own — the track was `[300px_1fr]` here and
       * `[300px_minmax(0,1fr)]` in setup, which is a seam a founder crosses.
       * `nova-room.test.ts` sweeps for a screen that goes back to drawing it.
       */
      expect(home).toContain("<NovaRoom");
      expect(home).not.toMatch(/grid-cols-[2-9]\b/);
      expect(home).not.toMatch(/grid-cols-(?:repeat|\[repeat)/);
    });

    /*
     * The status row is chrome and stays while the thread scrolls, which is
     * what `sticky top-0` on it is for. A sticky element can only stick within
     * its own containing block, so a wrapper that hugs it — an entrance
     * animation, say — is a wrapper with no room to stick in, and the header
     * leaves with the thread. It shipped that way once.
     */
    it("does not wrap the sticky header in anything that hugs it", () => {
      const home = component("nova-home.tsx");
      expect(home).toMatch(/<NovaHeaderLive/);
      expect(home).not.toMatch(/<NovaRise[^>]*>\s*<NovaHeaderLive/);
    });

    /*
     * And the rail goes second on a phone — asserted in `nova-room.test.ts`,
     * because the order moved into the room along with the grid and every
     * screen inherits it rather than repeating it.
     */

    it("has no chat input anywhere", () => {
      for (const { name, body } of FILES) {
        expect(body, name).not.toMatch(/<textarea|type="text"|placeholder=/);
      }
    });
  });

  /**
   * A block is chosen by the registry, never at the call site.
   *
   * `BLOCK_FOR_MOMENT` is total over every moment the domain can raise, so a
   * new one fails the build until somebody decides what a founder sees. A
   * screen that picked its own block would be a second answer to that
   * question, and the two would disagree the first time either moved.
   */
  describe("the blocks", () => {
    it("asks the registry which block a moment gets", () => {
      const home = component("nova-home.tsx");
      expect(home).toContain("BLOCK_FOR_MOMENT");
      expect(home).toContain("<AuditBlock");
      expect(home).toContain("<MoveBlock");
    });

    /**
     * One frame, one heading, on the block a founder answers in.
     *
     * The thread drew `NovaRenderBlock` with `tone="waiting"` and the card
     * drew its own amber `Surface` inside it — two amber borders around one
     * question — under a label saying "Needs your answer" above a pill saying
     * "Needs your decision". Three statements of one fact.
     *
     * `presentation="block"` is the same move the Product Scan and the file
     * list already make: the composed surface drops its own frame because the
     * render block is the frame.
     */
    it("answers inside one frame rather than two", () => {
      expect(block("ask.tsx")).toMatch(/<FounderInputCard[\s\S]*?presentation="block"/);
      /* The panel would be a fourth heading. It still owns the Agent route,
         where it is a page-scale object rather than a heading inside somebody
         else's frame. */
      for (const { name, body } of FILES) {
        expect(body, name).not.toContain("AgentQuestionPanel");
      }
      expect(block("ask.tsx")).not.toContain("AgentQuestionPanel");
    });

    /**
     * One answer to "what does a founder see for this kind".
     *
     * `blocks/` held wrappers that made these decisions and nothing imported
     * them, while Home wrote its own copy of each a level lower. The lab drew
     * the wrappers; production drew the copy; nothing compared them. Home goes
     * through the barrel now, so there is one of each.
     */
    /**
     * A second true thing is said, and is not a second thing to do.
     *
     * `buildNovaHomeView` has ranked and capped `secondary` since this route
     * existed and Home discarded it, so a founder with three things pending
     * saw one. They are bubbles in the quiet register now — no controls and no
     * prices, which is the rule that keeps them from rebuilding the wall of
     * equally weighted choices the ranking exists to replace.
     */
    it("says the other moments without offering them", () => {
      const home = component("nova-home.tsx");
      const thread = component("nova-focus-thread.tsx");

      expect(home).toContain("data.view.secondary");
      expect(thread).toContain("speechBubbles");
      /* Rendered as asides, and the control slot is a different branch — an
         aside that grew a button would be the stack of cards coming back. */
      expect(thread).toMatch(/asideBubbles\.map[\s\S]*?<NovaBubble key=\{bubble\.key\} aside/);
    });

    it("mounts the blocks rather than a second copy of their decisions", () => {
      const home = component("nova-home.tsx");

      expect(home).toContain('from "@/components/nova/blocks"');
      for (const composed of ["<ReviewBlock", "<AskBlock", "<WorkspaceAskBlock"]) {
        expect(home, composed).toContain(composed);
      }
      /* The pieces those wrappers compose, reached for directly. */
      expect(home).not.toMatch(/<ChangeGates|<FounderInputCard|<AgentWorkspaceChoice\b/);
    });

    /*
     * How long a run has been stopped waiting is the one thing this surface
     * could not say, and it costs no read — the request has been in hand since
     * the ranking put it first. Computed on the server, because a relative
     * time read on the client would disagree with the markup around it.
     */
    it("says how long the run has been waiting", () => {
      const home = component("nova-home.tsx");
      expect(home).toMatch(/waitingSince=\{formatElapsedShort\(data\.question\.createdAt/);
    });

    /*
     * The run's block belongs to the *run* rather than to the moment, and the
     * other registry picks it. This used to be the progress checklist and
     * nothing else, so twelve of the fifteen operation types ran behind a
     * blank column.
     */
    it("asks the registry which block a running operation gets", () => {
      const home = component("nova-home.tsx");
      expect(home).toContain("BLOCK_FOR_OPERATION");
      expect(home).toContain("<ProgressBlock");
      expect(home).toContain("<ScanBlock");
      /* The agent's block is the Agent's own build stage now, streamed. The
         polling file list is still in it — as the boundary's fallback and as
         its activity column — and it is mounted by `nova-agent-stage.tsx`
         rather than here. */
      expect(home).toContain("<NovaAgentStage");
      expect(component("nova-agent-stage.tsx")).toContain("<AgentBuildStage");
      expect(component("nova-agent-stage.tsx")).toContain("<NovaAgentLive");
      /* Cheap by construction: naming a change is what makes the workspace
         read sign images and preflight a merge against GitHub. */
      expect(component("nova-agent-stage.tsx")).toContain("selectedPreparedChangeId: null");
      /* And never in front of Home's first paint. */
      expect(component("nova-agent-stage.tsx")).toContain("<Suspense");
    });

    /*
     * The agent's file list is the one composed block whose component does not
     * poll for itself — the Product Scan does, which is why mounting it made
     * it live for free. Rendering `AgentWorking` straight into the thread would
     * draw the server render's list, hold it still, and pulse at it.
     */
    /*
     * The stage history is this tab's observation, never a read. `stage` is a
     * column the executor overwrites, so a surface that claimed to replay the
     * sequence would be inventing one — which is the whole argument the
     * dissolving lines rest on.
     */
    it("shows only the stages it watched happen", () => {
      const live = component("nova-agent-live.tsx");
      expect(live).toContain("<NovaDissolving");
      expect(live).toContain("initialStage");
      /* Newest first, appended only on a change: a poll answering the same
         stage repeatedly must not stack copies of one line. */
      expect(live).toMatch(/seen\[0\] === result\.activity\.stage/);
    });

    it("does not mount the agent's record without a reading behind it", () => {
      const home = component("nova-home.tsx");
      expect(home).not.toContain("<AgentWorking");
      expect(component("nova-agent-live.tsx")).toContain("useOperationPoll");
    });

    /*
     * One owner for "the run ended". The header polls the operation and
     * refreshes the route, because a run finishing is what makes the ranking
     * stale — a second component refreshing on the same fact would be two
     * answers to a question that has one.
     */
    it("leaves the settling refresh to the header", () => {
      expect(component("nova-agent-live.tsx")).not.toContain("router.refresh");
      expect(component("nova-header-live.tsx")).toContain("router.refresh");
    });

    /*
     * The stage list comes from `progressSequenceFor` by way of
     * `novaWorkingEntry`. A screen free to pass either one is a screen free to
     * draw the planning rows while an opportunity run is going.
     */
    it("never names a progress sequence at a call site", () => {
      for (const { name, body } of FILES) {
        expect(body, name).not.toMatch(/sequence=\{"(action_planning|opportunity_generation)"\}/);
      }
      expect(component("nova-home.tsx")).toContain("working.sequence");
    });

    /*
     * The thread frames blocks and chooses none. Both registries are read
     * where the data is, which is what keeps the thread renderable from a
     * study with fixtures.
     */
    it("leaves the choice of block out of the thread", () => {
      const thread = component("nova-focus-thread.tsx");
      expect(thread).not.toContain("BLOCK_FOR_OPERATION");
      expect(thread).not.toMatch(/<ProgressBlock|<ScanBlock|<AuditBlock|<MoveBlock/);
    });

    /*
     * A scan that is still running has written no profile, so there is no
     * reading to put under it. Carrying an earlier one in would show a founder
     * last week's answer beneath a live progress line.
     */
    it("shows no reading under a scan that is still running", () => {
      expect(component("nova-home.tsx")).toContain("presentation={null}");
    });
  });

  /**
   * The decision travels whole, or not at all.
   *
   * A merge button on Home would be the failure rules 67-71 describe: a yes
   * bound to one commit, pressed against whatever is current.
   *
   * ## What changed under this, and what did not
   *
   * It used to be `ChangeGates` that made mounting safe, by bringing the whole
   * sequence — validation, preview, review, approval, merge, outcome — each
   * reachable only through the one above it. The block mounts the Agent's own
   * three stage screens now, because `ChangeGates` is the surface the Agent
   * workspace replaced and the thread was the last place still drawing it.
   *
   * The guarantee did not change and is if anything sharper: which screen a
   * change gets is `AGENT_STAGE_FOR_CHANGE`, total over `ChangeStage`, so a
   * change that has not passed its checks cannot be shown a decision — and the
   * decision itself arrives as `AgentReviewDecision`, the canonical pair the
   * Agent route mounts. Reaching past that for the merge panel, or for the
   * merge action, is still how it would be lost one import at a time.
   */
  describe("the change gates", () => {
    it("mounts the Agent's own stages rather than a panel out of the middle", () => {
      const review = block("review.tsx");

      for (const stage of ["<AgentValidateStage", "<AgentPreviewStage", "<AgentMergeStage"]) {
        expect(review, stage).toContain(stage);
      }
      /* The thread says the change's status sentence above the block, so each
         stage drops its own narrative column. */
      expect(review).toContain('presentation="block"');
      /* And the stage is read from the change, never from the moment: the
         candidate kind cannot tell `review_required` from `awaiting_approval`. */
      expect(review).toContain("agentStageForChange(change.progress.stage)");
      /* The canonical pair, not its halves. */
      expect(review).toContain("<AgentReviewDecision");

      for (const body of [review, component("nova-home.tsx")]) {
        expect(body).not.toMatch(/<MergePanel|<ApprovalPanel|merge-panel|approval-panel/);
      }
    });

    it("never calls the merge action itself", () => {
      for (const { name, body } of FILES) {
        expect(body, name).not.toMatch(/mergeApprovedChangeAction|startMerge/);
      }
    });
  });

  describe("honest absence", () => {
    /*
     * Home used to render the business score, and these two assertions were
     * about the shapes it had to keep honest: never a zero standing in for
     * "nothing was measurable", and a never-audited project distinct from an
     * unscored one. Home renders no score at all now — Business Health owns
     * the reading — so the strongest thing to check here is that it did not
     * grow one back, in prose or in a figure.
     *
     * Rule 44 itself is enforced where the number lives, and is tested there.
     */
    it("states no score of its own", () => {
      for (const { name, body } of FILES) {
        expect(body, name).not.toMatch(/scoreDisplay|<HealthScore|overall\.score/);
      }
    });

    /*
     * The thread's version of the same refusal. `deriveNovaFocus` decides what
     * leads, and every sentence it produces comes from the feed's table — so a
     * template literal building one here would be Home writing copy the domain
     * did not.
     */
    it("writes none of Nova's sentences itself", () => {
      const thread = component("nova-focus-thread.tsx");
      expect(thread).toContain("entry.message");
      expect(thread).not.toMatch(/`[^`]*\$\{entry\.(kind|tier)\}/);
    });

    it("offers no control when there is nothing to do", () => {
      // `control` is optional on the thread and omitted for the settled case.
      expect(component("nova-home.tsx")).toContain('control.kind === "none"');
    });
  });

  describe("status", () => {
    it("takes every word from the shared vocabulary", () => {
      for (const name of ["nova-focus-thread.tsx", "nova-home.tsx"]) {
        expect(component(name), name).toMatch(/statusFor(OperationPhase|FocusTier|Candidate)/);
      }
    });

    it("never depends on colour alone", () => {
      /*
       * The one dot left on this screen is the header's, and it is
       * `aria-hidden` with the state's word beside it — the header takes both
       * as one `status` object, so a tone cannot arrive without the sentence
       * that explains it.
       */
      const header = component("nova-header-live.tsx");
      expect(header).toMatch(/word:|resting/);
      expect(header).toContain("stageLabel");
    });
  });
});

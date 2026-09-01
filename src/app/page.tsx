import Link from "next/link";
import { VibeMark } from "@/components/brand/vibe-mark";
import { MarketingShell } from "@/components/layout/marketing-shell";
import { LandingBusinessBrain } from "@/components/marketing/landing-business-brain";
import { buttonClasses } from "@/components/ui/button";
import {
  ActionPlanIcon,
  AgentIcon,
  ArrowRightIcon,
  BranchIcon,
  BusinessHealthIcon,
  CheckIcon,
  CodeIcon,
  GlobeIcon,
  LockIcon,
  ProductsIcon,
  RocketIcon,
  TargetIcon,
} from "@/components/ui/dashboard-icons";
import { MonoLabel } from "@/components/ui/typography";
import { listPlans, WELCOME_CREDIT_UNITS } from "@/modules/billing/catalog";
import { formatCreditsForDisplay } from "@/modules/credits/units";

const FLOW = [
  {
    title: "Understand",
    body: "Vibe reads your repository and public product without keeping a copy of your code.",
    label: "Product intelligence",
    icon: ProductsIcon,
  },
  {
    title: "Diagnose",
    body: "Nine business areas turn scattered product signals into one grounded assessment.",
    label: "Business Brain",
    icon: BusinessHealthIcon,
  },
  {
    title: "Prioritize",
    body: "The most important business problem becomes the next move, with the reason attached.",
    label: "Opportunity",
    icon: TargetIcon,
  },
  {
    title: "Plan",
    body: "Vibe breaks the move into concrete steps and makes ownership and dependencies visible.",
    label: "Action Plan",
    icon: ActionPlanIcon,
  },
  {
    title: "Execute",
    body: "Supported changes are prepared on an isolated branch and validated before review.",
    label: "AI Agent",
    icon: AgentIcon,
  },
  {
    title: "Measure",
    body: "After delivery, Vibe checks what became observable without claiming what it cannot prove.",
    label: "Outcome",
    icon: RocketIcon,
  },
] as const;

const PRODUCT_SIGNALS = [
  ["Repository", "Structure, capabilities and business surfaces", CodeIcon],
  ["Live product", "Public pages, positioning and conversion paths", GlobeIcon],
  ["Founder intent", "Audience, goals and context only you can provide", TargetIcon],
] as const;

const AGENT_STAGES = [
  ["Understand", "Goal and live premises checked"],
  ["Build", "Change prepared in an isolated workspace"],
  ["Validate", "Project checks run independently"],
  ["Preview", "Current and proposed result made comparable"],
  ["Review", "One exact commit waits for your decision"],
] as const;

const PLAN_FEATURES: Record<string, string[]> = {
  free: ["100 Welcome Credits", "No recurring monthly grant", "Start with one product"],
  builder: [
    "1,000 Credits each paid month",
    "Credits tracked in one ledger",
    "Add extra Credits when needed",
  ],
  pro: [
    "3,000 Credits each paid month",
    "Credits tracked in one ledger",
    "Add extra Credits when needed",
  ],
};

function GithubIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="currentColor">
      <path d="M12 2C6.48 2 2 6.58 2 12.23c0 4.52 2.87 8.35 6.84 9.71.5.1.68-.22.68-.49v-1.91c-2.78.62-3.37-1.37-3.37-1.37-.45-1.19-1.11-1.5-1.11-1.5-.91-.63.07-.62.07-.62 1 .08 1.53 1.05 1.53 1.05.89 1.57 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.37-2.22-.26-4.56-1.14-4.56-5.07 0-1.12.39-2.03 1.03-2.74-.1-.26-.45-1.3.1-2.7 0 0 .84-.28 2.75 1.05A9.3 9.3 0 0 1 12 6.79a9.3 9.3 0 0 1 2.5.35c1.91-1.33 2.75-1.05 2.75-1.05.55 1.4.2 2.44.1 2.7.64.71 1.03 1.62 1.03 2.74 0 3.94-2.34 4.8-4.57 5.06.36.32.68.94.68 1.9v2.96c0 .27.18.59.69.49A10.25 10.25 0 0 0 22 12.23C22 6.58 17.52 2 12 2Z" />
    </svg>
  );
}

export default function HomePage() {
  const plans = listPlans();

  return (
    <MarketingShell>
      <section
        id="top"
        className="relative grid gap-12 py-16 sm:py-24 xl:grid-cols-[minmax(25rem,0.78fr)_minmax(42rem,1.22fr)] xl:items-center xl:gap-8"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-32 -left-40 -z-10 size-[42rem] rounded-full bg-[radial-gradient(circle,rgb(0_229_160/0.1),transparent_66%)] blur-3xl"
        />

        <div className="flex flex-col items-start gap-7">
          <span className="text-fg-prose inline-flex items-center gap-2 rounded-full border border-line-strong bg-surface-2 px-3.5 py-2 font-mono text-[0.65rem] font-semibold tracking-[0.16em] uppercase">
            <span aria-hidden="true" className="text-mint">
              ✦
            </span>
            AI business co-founder
          </span>

          <h1 className="text-fg max-w-[12ch] text-[clamp(2.75rem,5vw,4.5rem)] leading-[1.02] font-bold tracking-[-0.055em] text-balance">
            You built the product. Now build <span className="text-mint">the business.</span>
          </h1>

          <p className="text-fg-prose max-w-[54ch] text-lg leading-relaxed">
            Vibe Business understands what you built, finds what is holding the business back,
            prioritizes what to do next, and helps you execute it with AI.
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <Link href="/signup" className={`${buttonClasses()} px-6 py-4 text-base`}>
              <GithubIcon />
              Start with your GitHub repo
              <ArrowRightIcon size={17} />
            </Link>
            <Link
              href="#how"
              className={`${buttonClasses({ variant: "secondary" })} px-6 py-4 text-base`}
            >
              See how it works
            </Link>
          </div>

          <ul className="text-fg-muted flex flex-wrap gap-x-6 gap-y-3 text-xs">
            <li className="flex items-center gap-2">
              <CheckIcon size={15} /> No credit card to start
            </li>
            <li className="flex items-center gap-2">
              <BranchIcon size={15} /> Your approval before merge
            </li>
            <li className="flex items-center gap-2">
              <LockIcon size={15} /> No stored copy of your code
            </li>
          </ul>

          <div className="mt-3 flex flex-col gap-3">
            <MonoLabel>Built for products made with</MonoLabel>
            <div className="text-fg-secondary flex flex-wrap gap-x-6 gap-y-2 text-sm font-semibold">
              {["Cursor", "Replit", "Lovable", "Bolt", "Claude Code", "Codex"].map((tool) => (
                <span key={tool}>{tool}</span>
              ))}
            </div>
          </div>
        </div>

        <LandingBusinessBrain />
      </section>

      <div className="border-line-1 flex flex-col items-center gap-5 border-y py-7">
        <MonoLabel>Works with your stack</MonoLabel>
        <div className="flex flex-wrap justify-center gap-2.5">
          {["GitHub", "Next.js", "Stripe", "Vercel", "Supabase"].map((tool) => (
            <span
              key={tool}
              className="border-line-2 bg-surface-2 text-fg-secondary rounded-nav border px-4 py-2 text-sm font-medium"
            >
              {tool}
            </span>
          ))}
          <span className="border-line-1 text-fg-muted rounded-nav border px-4 py-2 text-sm">
            + more
          </span>
        </div>
      </div>

      <section id="how" aria-labelledby="how-heading" className="scroll-mt-24 py-20 sm:py-28">
        <div className="grid gap-10 xl:grid-cols-[20rem_minmax(0,1fr)] xl:gap-16">
          <div className="flex flex-col items-start gap-5">
            <MonoLabel className="text-mint">How Vibe turns code into progress</MonoLabel>
            <h2
              id="how-heading"
              className="text-fg text-[clamp(2.25rem,4vw,3.5rem)] leading-[1.04] font-bold tracking-[-0.045em] text-balance"
            >
              From code to business. <span className="text-mint">Vibe</span> every step.
            </h2>
            <p className="text-fg-prose leading-relaxed">
              One continuous path from product understanding to a reviewed, measurable change.
            </p>
          </div>

          <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {FLOW.map((step, index) => {
              const Icon = step.icon;
              return (
                <li
                  key={step.title}
                  className="border-line-2 bg-surface-2 rounded-panel flex min-h-56 flex-col items-start gap-4 border p-5"
                >
                  <div className="flex w-full items-center justify-between">
                    <span className="text-mint flex size-11 items-center justify-center rounded-xl border border-mint-line bg-mint-tint">
                      <Icon size={20} />
                    </span>
                    <span className="text-mint font-mono text-xs">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                  </div>
                  <div className="flex flex-col gap-2">
                    <h3 className="text-fg text-lg font-semibold">{step.title}</h3>
                    <p className="text-fg-secondary text-sm leading-relaxed">{step.body}</p>
                  </div>
                  <span className="text-fg-muted mt-auto rounded-full border border-line-2 bg-surface-3 px-3 py-1.5 text-xs">
                    {step.label}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      </section>

      <section
        id="product"
        aria-labelledby="product-heading"
        className="border-line-1 scroll-mt-24 border-t py-20 sm:py-28"
      >
        <div className="grid gap-10 lg:grid-cols-[minmax(18rem,0.72fr)_minmax(0,1.28fr)] lg:items-center lg:gap-16">
          <div className="flex flex-col gap-5">
            <MonoLabel className="text-mint">Starts with understanding</MonoLabel>
            <h2
              id="product-heading"
              className="text-fg text-[clamp(2.25rem,4vw,3.5rem)] leading-[1.04] font-bold tracking-[-0.045em] text-balance"
            >
              Vibe learns what you have actually built.
            </h2>
            <p className="text-fg-prose max-w-[48ch] leading-relaxed">
              Repository evidence, the public product and your own intent stay separate and
              traceable. Vibe turns them into a product picture without asking you to recreate the
              work in a form.
            </p>
            <ul className="mt-2 flex flex-col gap-4">
              {PRODUCT_SIGNALS.map(([title, body, Icon]) => (
                <li key={title} className="flex gap-4">
                  <span className="text-mint mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl border border-mint-line bg-mint-tint">
                    <Icon size={18} />
                  </span>
                  <span>
                    <span className="text-fg block font-semibold">{title}</span>
                    <span className="text-fg-secondary mt-1 block text-sm leading-relaxed">
                      {body}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="border-line-2 bg-surface-2 rounded-card overflow-hidden border shadow-card">
            <div className="border-line-2 flex flex-wrap items-start justify-between gap-4 border-b px-5 py-5 sm:px-7">
              <div>
                <h3 className="text-fg text-xl font-semibold">Product understanding</h3>
                <p className="text-fg-secondary mt-1 text-sm">
                  A bounded, evidence-backed picture of what already exists.
                </p>
              </div>
              <span className="text-mint rounded-full border border-mint-line bg-mint-tint px-3 py-1.5 text-xs font-semibold">
                Ready for review
              </span>
            </div>
            <div className="grid gap-px bg-line-1 sm:grid-cols-3">
              {PRODUCT_SIGNALS.map(([title, body, Icon]) => (
                <div key={title} className="bg-surface-2 p-5 sm:p-6">
                  <Icon className="text-mint" size={20} />
                  <p className="text-fg mt-5 font-semibold">{title}</p>
                  <p className="text-fg-secondary mt-2 text-sm leading-relaxed">{body}</p>
                </div>
              ))}
            </div>
            <div className="bg-app/40 flex flex-wrap items-center justify-between gap-4 px-5 py-4 sm:px-7">
              <span className="text-fg-muted text-xs">Raw source files are not persisted.</span>
              <span className="text-fg-secondary flex items-center gap-2 text-xs">
                <LockIcon size={14} /> Evidence paths remain traceable
              </span>
            </div>
          </div>
        </div>
      </section>

      <section
        id="brain"
        aria-labelledby="brain-heading"
        className="border-line-1 scroll-mt-24 border-t py-20 sm:py-28"
      >
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.72fr)] lg:items-center lg:gap-16">
          <div className="flex flex-col gap-5">
            <MonoLabel className="text-mint">Business Brain</MonoLabel>
            <h2
              id="brain-heading"
              className="text-fg max-w-[16ch] text-[clamp(2.25rem,4vw,3.5rem)] leading-[1.04] font-bold tracking-[-0.045em] text-balance"
            >
              See your business as a <span className="text-mint">system.</span>
            </h2>
            <p className="text-fg-prose max-w-[58ch] leading-relaxed">
              Nine business areas reveal what is healthy, what is blocked, and what matters now.
              Missing evidence stays unscored rather than becoming a bad result.
            </p>
          </div>
          <div className="border-coral-line bg-coral-tint/30 rounded-card border p-6 sm:p-8">
            <MonoLabel className="text-coral">What matters now</MonoLabel>
            <h3 className="text-fg mt-5 text-2xl font-semibold tracking-[-0.03em]">
              One prioritized move, not another report.
            </h3>
            <p className="text-fg-secondary mt-3 leading-relaxed">
              Vibe ties every recommendation back to the evidence that produced it, then turns the
              selected opportunity into an action plan.
            </p>
            <Link
              href="/signup"
              className={`${buttonClasses({ variant: "secondary" })} mt-6 w-full justify-between`}
            >
              Build your Business Brain <ArrowRightIcon size={16} />
            </Link>
          </div>
        </div>
      </section>

      <section
        id="agent"
        aria-labelledby="agent-heading"
        className="border-line-1 scroll-mt-24 border-t py-20 sm:py-28"
      >
        <div className="grid gap-10 lg:grid-cols-[minmax(18rem,0.7fr)_minmax(0,1.3fr)] lg:items-center lg:gap-16">
          <div className="flex flex-col gap-5">
            <MonoLabel className="text-mint">AI agent execution</MonoLabel>
            <h2
              id="agent-heading"
              className="text-fg text-[clamp(2.25rem,4vw,3.5rem)] leading-[1.04] font-bold tracking-[-0.045em] text-balance"
            >
              Turn decisions into <span className="text-mint">real progress.</span>
            </h2>
            <p className="text-fg-prose max-w-[48ch] leading-relaxed">
              For supported product changes, Vibe prepares the work in isolation, validates it
              independently and gives you the exact result to review.
            </p>
            <div className="border-line-2 bg-surface-2 rounded-panel flex items-center gap-4 border p-4">
              <span className="text-mint flex size-11 shrink-0 items-center justify-center rounded-xl border border-mint-line bg-mint-tint">
                <LockIcon size={19} />
              </span>
              <div>
                <p className="text-fg font-semibold">Built for control</p>
                <p className="text-fg-secondary mt-1 text-sm">
                  No change reaches the default branch without approval.
                </p>
              </div>
            </div>
          </div>

          <div className="border-line-2 bg-surface-2 rounded-card overflow-hidden border shadow-card">
            <div className="border-line-2 flex items-center justify-between gap-4 border-b px-5 py-4 sm:px-7">
              <div className="flex items-center gap-3">
                <span className="text-mint flex size-9 items-center justify-center rounded-xl bg-mint-tint">
                  <AgentIcon size={18} />
                </span>
                <span className="text-fg font-semibold">AI Agent</span>
              </div>
              <span className="text-mint flex items-center gap-2 text-xs">
                <span className="size-1.5 rounded-full bg-mint" /> Prepared for review
              </span>
            </div>
            <div className="grid sm:grid-cols-[13rem_minmax(0,1fr)]">
              <ol className="border-line-2 flex flex-col border-b p-5 sm:border-r sm:border-b-0 sm:p-6">
                {AGENT_STAGES.map(([title, detail], index) => (
                  <li key={title} className="relative flex gap-3 pb-6 last:pb-0">
                    {index < AGENT_STAGES.length - 1 && (
                      <span
                        aria-hidden="true"
                        className="bg-mint-line absolute top-7 bottom-0 left-3 w-px"
                      />
                    )}
                    <span className="border-mint-line bg-app text-mint relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full border font-mono text-[0.65rem]">
                      {index + 1}
                    </span>
                    <span>
                      <span className="text-fg-body block text-sm font-semibold">{title}</span>
                      <span className="text-fg-muted mt-1 block text-xs leading-relaxed sm:hidden">
                        {detail}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
              <div className="flex flex-col gap-3 p-5 sm:p-6">
                <MonoLabel>What each stage proves</MonoLabel>
                {AGENT_STAGES.map(([title, detail]) => (
                  <div
                    key={title}
                    className="border-line-1 bg-app/50 rounded-nav flex items-start gap-3 border p-3.5"
                  >
                    <CheckIcon className="text-mint mt-0.5 shrink-0" size={15} />
                    <p className="text-fg-secondary text-sm leading-relaxed">
                      <span className="text-fg-body font-semibold">{title}:</span> {detail}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section
        id="pricing"
        aria-labelledby="pricing-heading"
        className="border-line-1 scroll-mt-24 border-t py-20 sm:py-28"
      >
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-5 text-center">
          <MonoLabel className="text-mint">Simple plans</MonoLabel>
          <h2
            id="pricing-heading"
            className="text-fg text-[clamp(2.25rem,4vw,3.5rem)] leading-[1.04] font-bold tracking-[-0.045em] text-balance"
          >
            Start free. Add capacity when the work grows.
          </h2>
          <p className="text-fg-prose max-w-[60ch] leading-relaxed">
            Plans use Vibe Credits for AI work. Paid plans add a fresh Credit grant after each
            successfully paid month.
          </p>
        </div>

        <div className="mt-12 grid gap-4 lg:grid-cols-3">
          {plans.map((plan) => {
            const featured = plan.key === "builder";
            const credits = formatCreditsForDisplay(
              plan.key === "free" ? WELCOME_CREDIT_UNITS : plan.monthlyCreditUnits,
            );

            return (
              <article
                key={plan.key}
                className={`rounded-card flex flex-col border p-6 sm:p-7 ${
                  featured
                    ? "border-mint-line bg-mint-tint/35 shadow-mint"
                    : "border-line-2 bg-surface-2"
                }`}
              >
                <div className="flex items-center justify-between gap-4">
                  <h3 className="text-fg text-xl font-semibold">{plan.name}</h3>
                  {featured && (
                    <span className="text-mint rounded-full border border-mint-line bg-mint-tint px-3 py-1 text-xs font-semibold">
                      For active builders
                    </span>
                  )}
                </div>
                <p className="text-fg mt-7 text-4xl font-bold tracking-[-0.05em]">
                  {plan.priceCents === 0 ? "€0" : `€${plan.priceCents / 100}`}
                  <span className="text-fg-muted ml-2 text-sm font-normal tracking-normal">
                    / month
                  </span>
                </p>
                <p className="text-fg-secondary mt-3 text-sm">
                  {credits} {plan.key === "free" ? "Welcome Credits once" : "Credits each paid month"}
                </p>
                <ul className="my-7 flex flex-col gap-3">
                  {PLAN_FEATURES[plan.key]?.map((feature) => (
                    <li key={feature} className="text-fg-body flex items-start gap-3 text-sm">
                      <CheckIcon className="text-mint mt-0.5 shrink-0" size={15} />
                      {feature}
                    </li>
                  ))}
                </ul>
                <Link
                  href="/signup"
                  className={`${buttonClasses({
                    variant: featured ? "primary" : "secondary",
                  })} mt-auto w-full`}
                >
                  Start with {plan.name} <ArrowRightIcon size={15} />
                </Link>
              </article>
            );
          })}
        </div>
      </section>

      <section className="border-line-2 bg-surface-2 rounded-card relative mb-8 overflow-hidden border px-6 py-14 sm:px-12 sm:py-16">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 -left-24 size-80 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgb(0_229_160/0.16),transparent_68%)]"
        />
        <div className="relative grid gap-10 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-center">
          <span className="business-brain-core flex size-28 items-center justify-center rounded-full">
            <VibeMark size={46} />
          </span>
          <div>
            <h2 className="text-fg text-[clamp(2rem,4vw,3.25rem)] leading-[1.04] font-bold tracking-[-0.045em]">
              From product to business, together.
            </h2>
            <p className="text-fg-prose mt-3 max-w-[52ch] leading-relaxed">
              Bring the product you already built. Vibe will show you what matters next.
            </p>
          </div>
          <Link href="/signup" className={`${buttonClasses()} px-6 py-4 text-base`}>
            Start for free <ArrowRightIcon size={17} />
          </Link>
        </div>
      </section>
    </MarketingShell>
  );
}

# docs

What each directory holds, and which question it answers.

| | |
|---|---|
| [decisions/](decisions/README.md) | **Why the architecture is the way it is.** One ADR per decision, numbered and immutable. The source of truth for any decision it records; [ARCHITECTURE.md](../ARCHITECTURE.md) indexes them but never replaces them. |
| [sprints/](sprints/README.md) | **What was built, and what it cost.** One record per sprint, written after the work, including what the sprint failed to prove. Never edited to match the present. |
| [ROADMAP.md](ROADMAP.md) | **What is known to be missing.** Gaps that cite evidence, in the order they are worth closing. Not a plan and not a promise. |
| [business/](business/README.md) | **What the product costs to run and what it might be worth.** Measured unit economics, credit economics, pricing analysis. |
| [audits/](audits/) | **Dated reviews of the product as it existed on one commit.** UX, intelligence architecture, economics architecture. |
| [setup/](setup/github-app.md) | **One-time environment setup.** GitHub App, Supabase Auth, Sentry. Operational: following one of these must produce a working environment. |
| [deployment/](deployment/environment.md) | **How URLs resolve** across development, preview and production. |
| [PROJECT_HISTORY_AND_LEARNINGS.md](PROJECT_HISTORY_AND_LEARNINGS.md) | **How the product got here.** The narrative, in German, with the durable principles each phase produced. |

## Which of these must be true right now

Records — `sprints/`, `decisions/`, `audits/`, and the history — describe what was true when they were written, and are corrected only when they were wrong at the time, in the open.

Current-state documents — [README.md](../README.md), [PRODUCT.md](../PRODUCT.md), [ARCHITECTURE.md](../ARCHITECTURE.md), [CLAUDE.md](../CLAUDE.md), `setup/`, [ROADMAP.md](ROADMAP.md) and every `src/modules/*/README.md` — describe the system as it is at HEAD, and a false sentence in one of them is a defect. See [ADR 0039](decisions/0039-documentation-currency.md); the structural half is asserted by `src/lib/docs/documentation-currency.test.ts`.

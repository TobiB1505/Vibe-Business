/**
 * Wait, and hold the process while waiting.
 *
 * Four files had written this same line — a crawl's politeness delay, a
 * compare-and-swap backoff, a provider poll, and the default a bounded fetch
 * uses between retries. Identical, and none of them wrong; there was simply no
 * shared place, so each grew its own.
 *
 * ## The one that is not this, and must never be replaced by it
 *
 * `import { sleep } from "workflow"` is a different function with the same
 * name and the opposite cost model. It **suspends a durable workflow**: the
 * step returns, the function stops being billed, and the platform resumes the
 * run later. This one holds the process open for the whole duration.
 *
 * Swapping them is not a type error and produces no failing test. Using
 * Workflow's inside an ordinary function does nothing useful; using this one
 * inside a `"use workflow"` body keeps a Node function alive through every
 * poll of a run that may last twenty-five minutes, which is a real invoice for
 * time spent doing nothing. `agent-execution/workflow.ts` says the same thing
 * from the other side, and that pair of comments is the whole defence — the
 * two functions are indistinguishable at a call site.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

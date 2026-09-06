import { SkeletonBlock } from "@/components/ui/skeleton";

/**
 * Shown while the console resolves its reads (PERF-015).
 *
 * This route is operator-only, which is the reason the existing exemption in
 * `loading-coverage.test.ts` covers the dogfood screens — but that exemption's
 * reason is that those pages render from the route segment alone, and this one
 * does not: it issues seven queries before its first byte. So it gets a real
 * first frame rather than the exemption.
 *
 * The heading is rendered rather than skeletonised, the same way every other
 * route here does it: it is static, so the page keeps its identity from the
 * first frame and nothing moves when the panels land. The blocks reserve the
 * feed column and the three stacked panels beside it, in the proportions the
 * loaded console uses.
 */
export default function Loading() {
  return (
    <main className="mx-auto max-w-[1180px] px-8 py-10">
      <div className="border-b border-line-2 pb-4">
        <h1 className="text-[22px] font-semibold tracking-tight text-fg">Internal console</h1>
        <p className="mt-1 text-[13px] text-fg-muted">Read-only. No action here writes anything.</p>
      </div>

      <div role="status" aria-label="Loading" className="mt-6 grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        <SkeletonBlock className="h-[560px] w-full" />
        <div className="grid gap-4">
          <SkeletonBlock className="h-40 w-full" />
          <SkeletonBlock className="h-36 w-full" />
          <SkeletonBlock className="h-36 w-full" />
        </div>
      </div>
    </main>
  );
}

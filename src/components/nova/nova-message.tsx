import { Surface } from "@/components/ui/surface";
import { cn } from "@/lib/utils/cn";
import type { NovaEntry } from "@/modules/nova/feed";

/**
 * One thing Nova says.
 *
 * The component holds no copy of its own. Every word comes from the entry, and
 * the entry's words come from `feed.ts`'s table — which is what makes the
 * language rules testable as values rather than as markup. A sentence written
 * here would be the one sentence no test sweeps.
 *
 * Two weights, matching the two things a feed entry can be: what needs the
 * founder now, and what is also true. An aside is quieter rather than smaller,
 * because it is not less true — it is just not the thing to do next.
 */
export function NovaMessage({ entry }: { entry: Extract<NovaEntry, { kind: "nova.message" }> }) {
  if (entry.emphasis === "aside") {
    return (
      <p className="text-fg-meta text-ui" data-testid="nova-aside">
        {entry.text}
      </p>
    );
  }

  return (
    <Surface level="panel" padding="lg" data-testid="nova-message">
      <p className={cn("text-fg text-[1.25rem] leading-snug font-medium tracking-[-0.02em]")}>
        {entry.text}
      </p>
    </Surface>
  );
}

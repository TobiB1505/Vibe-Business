import type { ValidationSummary } from "@/modules/validation/view";

const STEP_LABELS: Record<string, string> = {
  install: "dependencies",
  typecheck: "types",
  lint: "lint",
  test: "tests",
  build: "the production build",
};

/**
 * How much of the profile ran, and why (audit R32).
 *
 * A check list with three of seven rows marked skipped invites one question,
 * and the depth is the answer to it. Shown together for that reason: "Fast"
 * alone reads as a corner cut, and "low-risk presentational change" is what
 * makes it a decision rather than an omission.
 *
 * Absent for a run validated before depth existed. Those ran the whole set, and
 * labelling them now would be relabelling history — the same rule the
 * validation panel already applies.
 */
export function ValidationDepthNote({ depth }: { depth: ValidationSummary["depth"] }) {
  if (!depth) return null;

  const skipped = depth.notRun.map((step) => STEP_LABELS[step] ?? step);

  return (
    <p
      className="text-fg-muted max-w-[62ch] text-ui leading-relaxed"
      data-testid="validation-depth-note"
    >
      <span className="text-fg-secondary">{depth.label} checks</span> — {depth.reason}.
      {skipped.length > 0 && (
        <>
          {" "}
          Vibe did not run {listOf(skipped)} for this change.
        </>
      )}
    </p>
  );
}

/** "a, b and c" — an Oxford-free list, because this is a sentence. */
function listOf(items: readonly string[]): string {
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

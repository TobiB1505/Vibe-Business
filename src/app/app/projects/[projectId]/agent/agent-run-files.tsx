import { Disclosure } from "@/components/ui/disclosure";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { cn } from "@/lib/utils/cn";
import type { LiveFile, LiveFileKind } from "@/modules/coding-agent/observability/live-view";

/**
 * Every file a run touched, and what happened to each (audit R28).
 *
 * ## Why this is not the activity feed
 *
 * The feed answers "what happened, in order" and repeats a path once per
 * event. This answers "what did this run touch", once per file, which is the
 * question a founder asks while a change is being built and the one the
 * timeline could not answer without being read end to end.
 *
 * ## `withheldBy` is the reason this exists
 *
 * A path the agent tried to write and policy refused was previously not on
 * screen at all: the change simply did not contain it, and the founder had no
 * way to tell "the agent did not touch this" from "the agent was not allowed
 * to". Naming the policy makes the second one visible, and a refusal is a fact
 * about the run rather than an error — so it is a state, not a warning.
 *
 * The counts and the paths are Vibe's own observation of the workspace, never
 * the agent's account of itself (CLAUDE.md rule 77).
 */

const KIND_TONE: Record<LiveFileKind, StatusTone> = {
  generated: "success",
  observed: "neutral",
  candidate: "neutral",
};

const KIND_WORD: Record<LiveFileKind, string> = {
  generated: "Changed",
  observed: "Read",
  candidate: "Offered",
};

export function AgentRunFiles({
  files,
  limit = 8,
  title = "Files in this run",
}: {
  files: readonly LiveFile[];
  limit?: number;
  title?: string;
}) {
  if (files.length === 0) return null;

  const withheld = files.filter((file) => file.withheldBy !== null);
  const rest = files.filter((file) => file.withheldBy === null);

  /*
   * Withheld first, whatever the order they arrived in. It is the half a
   * founder cannot discover any other way, and burying it under thirty read
   * paths would be hiding it behind a scroll rather than behind a label.
   */
  const ordered = [...withheld, ...rest];
  const shown = ordered.slice(0, limit);
  const remaining = ordered.length - shown.length;

  return (
    <section className="flex flex-col gap-3" aria-label={title} data-testid="agent-run-files">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-fg text-ui font-semibold">{title}</h3>
        <p className="text-fg-meta text-ui tabular-nums">
          {files.length === 1 ? "1 file" : `${files.length} files`}
          {withheld.length > 0 && ` · ${withheld.length} withheld`}
        </p>
      </div>

      <ul className="flex flex-col gap-1.5">
        {shown.map((file) => (
          <FileRow key={`${file.kind}:${file.path}`} file={file} />
        ))}
      </ul>

      {remaining > 0 && (
        <Disclosure label={`${remaining} more`}>
          <ul className="flex flex-col gap-1.5">
            {ordered.slice(limit).map((file) => (
              <FileRow key={`${file.kind}:${file.path}`} file={file} />
            ))}
          </ul>
        </Disclosure>
      )}
    </section>
  );
}

function FileRow({ file }: { file: LiveFile }) {
  const refused = file.withheldBy !== null;

  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span
        className={cn(
          "min-w-0 font-mono text-meta break-all",
          refused ? "text-fg-muted line-through" : "text-fg-body",
        )}
      >
        {file.path}
      </span>
      {refused ? (
        <StatusPill tone="waiting">Not allowed</StatusPill>
      ) : (
        <StatusPill tone={KIND_TONE[file.kind]}>{KIND_WORD[file.kind]}</StatusPill>
      )}
      {refused && <span className="text-fg-meta text-ui">{file.withheldBy}</span>}
      {file.detail && !refused && <span className="text-fg-meta text-ui">{file.detail}</span>}
    </li>
  );
}

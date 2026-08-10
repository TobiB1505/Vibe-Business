"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import type { SetProductionUrlFailure } from "@/modules/projects/production-url";
import { setProductionUrlAction, type ProductionUrlActionState } from "./production-url-action";

/**
 * Production URL configuration (Sprint 3 §3, §30).
 *
 * Every rejection gets a specific, actionable message. "Invalid URL"
 * would leave a user guessing why `http://` or `localhost` was refused,
 * when the real answer is a deliberate policy they can act on.
 */
const ERROR_MESSAGES: Record<SetProductionUrlFailure, string> = {
  empty: "Enter the address of your live website.",
  malformed: "That does not look like a valid web address.",
  insecure_scheme: "Only https:// addresses are supported. Your live site needs a valid certificate.",
  unsupported_scheme: "Only https:// web addresses are supported.",
  credentials_present: "Remove the username and password from the address.",
  missing_hostname: "That address is missing a domain name.",
  internal_hostname: "Only public websites can be inspected — local and internal addresses are not supported.",
  unsafe_address: "That address points to a private network and cannot be inspected.",
  project_not_found: "This project could not be found.",
  save_failed: "The address could not be saved. Try again in a moment.",
};

const initialState: ProductionUrlActionState = null;

export function ProductionUrlForm({
  projectId,
  currentUrl,
}: {
  projectId: string;
  currentUrl: string | null;
}) {
  const action = setProductionUrlAction.bind(null, projectId);
  const [state, formAction, pending] = useActionState(action, initialState);
  const [editing, setEditing] = useState(currentUrl === null);

  if (!editing && currentUrl !== null) {
    return (
      <div className="flex items-baseline gap-3">
        <a
          href={currentUrl}
          target="_blank"
          rel="noreferrer nofollow"
          className="text-sm text-zinc-200 underline underline-offset-2 hover:text-zinc-50"
        >
          {currentUrl}
        </a>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-300"
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <form action={formAction} className="flex flex-wrap items-center gap-2">
        <input
          type="url"
          name="productionUrl"
          defaultValue={currentUrl ?? ""}
          placeholder="https://example.com"
          required
          className="min-w-64 flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
        />
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : currentUrl ? "Save" : "Add production URL"}
        </Button>
        {currentUrl !== null && (
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-300"
          >
            Cancel
          </button>
        )}
      </form>

      {state && !state.ok && <p className="text-sm text-amber-400">{ERROR_MESSAGES[state.error]}</p>}
    </div>
  );
}

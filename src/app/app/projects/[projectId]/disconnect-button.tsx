"use client";

import { disconnectProjectAction } from "./actions";

/** Native `confirm()` — explicit confirmation (Sprint 1 §11) without a new dependency. */
export function DisconnectButton({ projectId }: { projectId: string }) {
  const action = disconnectProjectAction.bind(null, projectId);

  return (
    <form
      action={action}
      onSubmit={(event) => {
        const confirmed = window.confirm(
          "Disconnect this project? Vibe Business will stop tracking this repository. This does not uninstall the GitHub App or change your repository.",
        );
        if (!confirmed) {
          event.preventDefault();
        }
      }}
    >
      <button type="submit" className="text-sm text-red-400 underline underline-offset-2 hover:text-red-300">
        Disconnect project
      </button>
    </form>
  );
}

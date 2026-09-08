"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils/format-datetime";
import { ACCEPT_ALL, REJECT_ALL } from "@/modules/consent/categories";
import { ConsentPreferences, useDraftChoices } from "./consent-preferences";
import { useConsent } from "./use-consent";

/**
 * Cookies, in Settings → General (UI-23).
 *
 * The same panel the banner opens, in the place a person goes when they have
 * changed their mind. A banner that cannot be reopened is a decision made
 * once and for ever, which is not consent — withdrawal has to be as easy as
 * giving, and "as easy" means a page you can find rather than a link in a
 * footer that reopens a modal.
 *
 * ## Why it says when the decision was made
 *
 * Because that is the one fact a person cannot reconstruct and the one that
 * tells them whether what they are looking at is theirs. It is read from the
 * cookie they already have; nothing about it is sent anywhere.
 */
export function CookieSettings() {
  const { choices, record, save } = useConsent();
  const [draft, setDraft] = useDraftChoices(choices);
  const [saved, setSaved] = useState(false);

  const dirty =
    draft.preferences !== choices.preferences ||
    draft.analytics !== choices.analytics ||
    draft.marketing !== choices.marketing;

  function apply(next: typeof draft) {
    save(next);
    setDraft(next);
    setSaved(true);
  }

  return (
    <div className="flex flex-col gap-5" data-testid="cookie-settings">
      <ConsentPreferences value={draft} onChange={setDraft} />

      <div className="border-line-2 flex flex-wrap items-center gap-3 border-t pt-5">
        <Button
          disabled={!dirty}
          onClick={() => apply(draft)}
          data-testid="cookie-save"
        >
          Save choices
        </Button>
        <Button variant="secondary" onClick={() => apply(REJECT_ALL)}>
          Reject all
        </Button>
        <Button variant="secondary" onClick={() => apply(ACCEPT_ALL)}>
          Accept all
        </Button>

        {/*
          A status region rather than a toast: the change has already happened
          when this appears, and a message that flies past is a confirmation
          somebody can miss. `record` is `undefined` until the cookie is read,
          `null` when nothing was ever decided.
        */}
        <p role="status" className="text-fg-muted text-caption">
          {saved
            ? "Saved. Nothing switched off will load again — reload to clear what is already running."
            : record
              ? `Last changed ${formatDate(new Date(record.decidedAt * 1000).toISOString()) ?? "recently"}`
              : record === null
                ? "Not decided yet"
                : ""}
        </p>
      </div>
    </div>
  );
}

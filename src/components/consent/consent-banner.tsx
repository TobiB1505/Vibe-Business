"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface";
import { ACCEPT_ALL, REJECT_ALL } from "@/modules/consent/categories";
import { proseLinkClasses } from "@/components/ui/text-link";
import { ConsentPreferences, useDraftChoices } from "./consent-preferences";
import { useConsent } from "./use-consent";

/**
 * The question, asked once (UI-23).
 *
 * ## Why "Reject all" is a real button beside "Accept all"
 *
 * Because refusing has to be exactly as easy as agreeing. Every reference
 * banner in the registries puts a filled *Accept all* next to a quiet
 * *Customize*, which puts refusal two clicks and a reading behind acceptance —
 * that is the dark pattern German and French regulators have repeatedly fined,
 * and it is the one thing about a consent banner that is not a matter of
 * taste. Both answers are one click, in the same row, in the same weight.
 *
 * "Choose" is third because it is the longer path, not because it is the way
 * to say no.
 *
 * ## Why nothing is pre-ticked
 *
 * The draft starts from what is stored, and nothing is stored, so everything
 * optional starts off. Consent is an action; a pre-ticked box is a record of
 * an action nobody took.
 *
 * ## Why it does not trap focus or block the page
 *
 * It is a `complementary` landmark at the foot of the page, not a modal. A
 * banner that blocks the product until it is answered makes "agree" the fast
 * way out, which is coercion with a stylesheet. A visitor can read the privacy
 * notice — linked from inside it — decide later, and use the site meanwhile
 * with everything optional off, which is what refusing means anyway.
 */
export function ConsentBanner() {
  const { undecided, choices, save } = useConsent();
  const [choosing, setChoosing] = useState(false);
  const [draft, setDraft] = useDraftChoices(choices);

  if (!undecided) return null;

  return (
    <div
      role="complementary"
      aria-labelledby="consent-heading"
      data-testid="consent-banner"
      /*
        `pointer-events-none` on the strip, restored on the card.

        Without it this is a full-width invisible barrier across the foot of
        every page in the product: the wrapper spans the viewport, so a click
        anywhere near the bottom — a button, a link, a disclosure — lands on
        the banner's empty margin instead. Measured: 29 browser tests failed
        the moment the banner was mounted globally, on screens that have
        nothing to do with cookies.
      */
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-4 sm:px-6 sm:pb-6"
    >
      {/*
        `Surface level="card"`, not the card classes by hand.

        Written by hand first, and it rendered **transparent** over the landing
        page: `.vibe-surface-card` carries only the backdrop blur, and the fill
        comes from the level — so the hero type showed straight through the
        panel a visitor is meant to read before deciding. A raised card rather
        than a scrim on purpose: the page behind stays readable, which is the
        point of not being a modal.

        `max-h` with its own scroll, because expanded this is four categories
        with their gates listed and it must not grow past the viewport on a
        laptop.
      */}
      <Surface
        level="card"
        padding="none"
        className="pointer-events-auto flex max-h-[80vh] w-full max-w-[46rem] flex-col gap-4 overflow-y-auto p-5 shadow-panel sm:p-6"
      >
        <div className="flex flex-col gap-3">
          <h2 id="consent-heading" className="text-fg text-ui font-semibold">
            Cookies, and who else sees this page
          </h2>
          <p className="text-fg-muted max-w-[68ch] text-caption leading-relaxed">
            Vibe needs one cookie to keep you signed in. Everything else — remembering which
            product you last opened, page-view counts, and the advertising tag that tells Meta
            which advert worked — is off until you say otherwise.{" "}
            <Link href="/privacy" className={proseLinkClasses()}>
              What Vibe stores
            </Link>
            .
          </p>
        </div>

        {choosing && (
          <ConsentPreferences
            value={draft}
            onChange={setDraft}
            className="border-line-2 border-y py-4"
          />
        )}

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {choosing ? (
            <>
              <Button onClick={() => save(draft)} data-testid="consent-save">
                Save choices
              </Button>
              <Button
                variant="secondary"
                onClick={() => setChoosing(false)}
                data-testid="consent-back"
              >
                Back
              </Button>
            </>
          ) : (
            <>
              {/*
                Same size, same row, one click each. The order puts the
                refusal first because it is the state the page is already in —
                the button that changes nothing should not be the loud one.
              */}
              <Button
                variant="secondary"
                onClick={() => save(REJECT_ALL)}
                data-testid="consent-reject"
              >
                Reject all
              </Button>
              <Button
                variant="secondary"
                onClick={() => save(ACCEPT_ALL)}
                data-testid="consent-accept"
              >
                Accept all
              </Button>
              {/*
                Quieter than the two answers, and deliberately so: it is the
                longer path, not the way to say no. Refusing is the button
                beside "Accept all", in the same weight.
              */}
              <Button
                variant="ghost"
                onClick={() => setChoosing(true)}
                data-testid="consent-choose"
                className="sm:ml-auto"
              >
                Choose
              </Button>
            </>
          )}
        </div>
      </Surface>
    </div>
  );
}

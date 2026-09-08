"use client";

import { LiveViewDialog } from "@/app/app/projects/[projectId]/deep-scan-panel";

/**
 * The sign-in dialog, mounted directly in the states it cannot otherwise reach.
 *
 * A client component and not a few lines in the fixture page, because the page
 * is a server component and `LiveViewDialog` takes callbacks — functions do not
 * cross that boundary, and the first attempt at this rendered Vibe's own error
 * page instead of the dialog. Which is itself the point: the states below had
 * no browser coverage at all, and a countdown and a closing check both shipped
 * without ever appearing on screen.
 */
export function DeepScanDialogFixture({
  sealing = false,
  expired = false,
  /**
   * A live view URL, for the states that are *about* the picture.
   *
   * Most of these scenarios are about the dialog around the picture, so the
   * default is none. But "the browser is closed" is a claim about the picture
   * itself — it was rendered over one that kept scrolling — and that can only
   * be checked where a canvas would otherwise be mounted. The socket goes
   * nowhere; the element is what the test is about.
   */
  liveViewUrl = null,
}: {
  sealing?: boolean;
  expired?: boolean;
  liveViewUrl?: string | null;
}) {
  const noop = () => {};

  return (
    <LiveViewDialog
      liveViewUrl={liveViewUrl}
      stage="ready"
      error={null}
      busy={sealing}
      unreachable={false}
      frame={{ w: 1920, h: 1200 }}
      signIn={{ signedIn: false, startsInSeconds: null, postpone: noop }}
      sealing={sealing}
      analysing={sealing}
      expired={expired}
      progress={sealing ? { pagesInspected: 14, maxPages: 25 } : null}
      onCancel={noop}
      onAnalyze={noop}
      onConnected={noop}
      onPainted={noop}
      onRetryView={noop}
      onUnavailable={noop}
      onSealed={noop}
      onLoginExpired={noop}
    />
  );
}

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
export function DeepScanDialogFixture({ sealing }: { sealing: boolean }) {
  const noop = () => {};

  return (
    <LiveViewDialog
      // No live view: the fixture is about the dialog around the picture, and
      // a socket to nowhere would only add a reconnect ladder to the test.
      liveViewUrl={null}
      stage="ready"
      error={null}
      busy={sealing}
      unreachable={false}
      frame={{ w: 1920, h: 1200 }}
      signIn={{ signedIn: false, startsInSeconds: null, postpone: noop }}
      sealing={sealing}
      analysing={sealing}
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

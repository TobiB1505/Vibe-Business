import { SkeletonBlock } from "@/components/ui/skeleton";
import { NovaRoom } from "@/components/nova/nova-room";
import { OnboardingShell } from "../onboarding-shell";

/**
 * The first frame of a project's onboarding (PERF-015).
 *
 * The longest read chain in the application sits behind this address, and it
 * is the screen a founder sees before they have any reason to trust that the
 * product works.
 *
 * ## Why it composes `NovaRoom`
 *
 * Because it was a different screen from the one it precedes. It painted a
 * single fifty-two-rem column with a poster-height heading skeleton and one
 * block under it — the shape of the page setup used to be — while the page it
 * waits for is a status row, a work column and a thread. The founder's first
 * frame was a layout that then vanished, which is precisely the failure
 * `OnboardingShell`'s own docblock warns about two files away: the wait
 * rendering a different frame from the page it is waiting for.
 *
 * So it reserves the room's geometry from the room itself. The grid, the
 * column widths and the phone ordering cannot drift from the page, because
 * they are not written here.
 *
 * ## Why it asserts nothing
 *
 * Which state this project is in is exactly what the page is still finding
 * out, so nothing here claims one: no setup list with a step ringed, no
 * presence, no sentence. The rail is its own surface with two quiet bars in
 * it, and the thread is its floor with two more. A skeleton that guessed
 * *Understand* and resolved to *Connect* would be the loading frame telling a
 * founder something the product had not read yet.
 *
 * The mark is deliberately absent too. `NovaPresence` takes a state, every
 * state it takes is a claim, and there is no honest one to pass before the
 * first read returns.
 *
 * ## The one screen this is not a preview of
 *
 * The opening. A founder meeting Nova for the first time gets an empty stage
 * and a mark assembling on it, and no skeleton describes that. It happens once
 * per project and every other load is the room, so the room is what this
 * reserves — a brief neutral frame before the stage is no worse than the
 * poster that used to sit here, and better for every load after the first.
 */
export default function Loading() {
  return (
    <OnboardingShell email={null} state={null}>
      <div role="status" aria-label="Loading">
        <NovaRoom
          /*
            The row's height, reserved rather than imitated. Drawing a mark, a
            name and a status line here would be a second copy of
            `NovaThreadHeader` that nothing keeps in step with the real one.
          */
          header={<SkeletonBlock className="h-[4.4rem] w-full" />}
          rail={
            <div className="border-line-2 bg-surface-1 rounded-panel flex flex-col gap-4 border p-5">
              <SkeletonBlock className="h-2.5 w-20 rounded-full" />
              <SkeletonBlock className="h-2.5 w-32 rounded-full" />
            </div>
          }
        >
          <div className="flex flex-col gap-3">
            <SkeletonBlock className="h-2.5 w-2/3 rounded-full" />
            <SkeletonBlock className="h-2.5 w-1/2 rounded-full" />
          </div>
        </NovaRoom>
      </div>
    </OnboardingShell>
  );
}

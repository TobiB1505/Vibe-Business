import { NovaMessage } from "@/components/nova/nova-message";
import type { NovaVoiceRead } from "@/modules/nova/voice/store";

/**
 * Nova's sentence about the Move she would start with, above the Moves.
 *
 * The same component shape as `NovaAuditVoice`, and deliberately not a shared
 * one: the two differ only in which read they are handed, and a single
 * component taking a slot would invite a `switch` that eventually renders one
 * slot differently from another. Two four-line components cost less than that.
 *
 * It chooses between nothing — `read.message` is whichever of the model's
 * words or the deterministic template the store resolved, and a component that
 * could tell them apart would come to treat one as better than the other.
 * `data-nova-voice-source` reports which path ran, for a test, never for a
 * difference on screen.
 */
export function NovaMoveVoice({ read }: { read: NovaVoiceRead }) {
  return (
    <div data-testid="nova-move-voice" data-nova-voice-source={read.source}>
      <NovaMessage
        entry={{
          kind: "nova.message",
          id: "move-voice",
          text: read.message,
          emphasis: "primary",
        }}
      />
    </div>
  );
}

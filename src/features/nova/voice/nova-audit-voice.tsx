import { NovaMessage } from "@/components/nova/nova-message";
import type { NovaVoiceRead } from "@/modules/nova/voice/store";

/**
 * Nova's sentence about this audit, above the audit.
 *
 * ## It holds no copy and makes no call
 *
 * Both branches of `NovaVoiceRead` are already resolved by the time this
 * renders: `voice` carries a message a model wrote and `checks.ts` accepted,
 * `template` carries the deterministic sentence `buildNovaAuditTemplate`
 * produces from the same entry. This component chooses between nothing — it
 * renders `read.message`, which is whichever of the two the store resolved.
 *
 * A component that could tell the difference would eventually be tempted to
 * treat one as better than the other, and the whole claim of the tier is that
 * a founder who only ever sees the template has lost a rephrasing and nothing
 * else. The source is exposed as a data attribute for the same reason a test
 * needs it — to prove which path ran — never to change what is drawn.
 *
 * ## Why it reuses `NovaMessage`
 *
 * Because Nova's voice should look like Nova's voice. `NovaMessage` holds no
 * prose of its own and takes its words from an entry, which is what keeps the
 * product's language rules assertable as values rather than as markup.
 */
export function NovaAuditVoice({ read }: { read: NovaVoiceRead }) {
  return (
    <div data-testid="nova-audit-voice" data-nova-voice-source={read.source}>
      <NovaMessage
        entry={{
          kind: "nova.message",
          id: "audit-voice",
          text: read.message,
          emphasis: "primary",
        }}
      />
    </div>
  );
}

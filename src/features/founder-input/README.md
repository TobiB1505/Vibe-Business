# Founder input

One question Vibe needs answered, and the answer. `FounderInputCard` renders a
`FounderInputRequest` and takes the resolving action as a prop rather than
binding one — which is why the Agent, the Action Plan and Nova's thread can all
mount it without any of them owning it.

It moved out of `src/components/founder-input/` by
[ADR 0109](../../../docs/decisions/0109-nova-first-application-shell.md) Slice 1:
it is the whole view of one canonical object, which makes it a domain view
rather than a primitive. It already carries
`presentation?: "card" | "workspace" | "block"`, so it is the
`founder_input` artifact the workspace registry names in Slice 4 without
needing a second copy.

The domain behind it is [`src/modules/founder-input/`](../../modules/founder-input/README.md),
and the bounded free text a founder types here — at most 1,200 characters,
behind a secret guard — is the precedent ADR 0109 §5 reuses for the composer.

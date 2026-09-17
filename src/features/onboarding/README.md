# Onboarding

The commands behind the setup flow: the scan, the profile confirmation, the
first audit, the first Move, and the decision that setup is finished. The screens
are under `src/app/app/onboarding/`, where the flow's shell and its beats live.

```
commands/onboarding-actions.ts   every step of the flow, as commands
```

Completion is decided on the server from records reconciled by
`getProjectOnboarding`, never from anything the browser sent — `canCompleteOnboarding`
is the predicate, shared with the screen so the button and the action cannot
disagree. `contract.test.ts` in `src/modules/onboarding/` pins that, and pins
that the flow lets go: once a founder has finished setup once, an unfinished
second project is an offer rather than a destination.

The free-versus-charged decision still lives inside these actions rather than in
the module. Named here rather than left to be found: it is orchestration a
feature may hold, and the slice that gives onboarding a surface of its own is
where it would move.

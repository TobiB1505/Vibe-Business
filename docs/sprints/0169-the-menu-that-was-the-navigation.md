# 0169 — The menu that was the navigation

**Date:** 2026-09-07
**Decision:** none new. A consequence of [ADR 0104](../decisions/0104-the-account-level-is-settings.md), which gave three of this menu's four items a rail of their own.

## The founder's instruction

> „Damit kannst du auch das menü beim profil wegmachen und nur noch den avatar mit namen anzeigen […] bei klick auf avatar und name als das feld geht wie üblich die Profil Seite auf"

## What the menu held, and what was left of it

Four items: **Profile**, **Account settings**, **Billing** and **Sign out**. Sprint 0168 turned the first three into rows in the Settings rail — so the disclosure at the foot of the rail opened to reveal the navigation standing next to it, and a founder had to open it to find that out. Two clicks to reach a page that was one click away.

So the identity becomes what it looks like: an avatar, a name, and a link to the page about that identity.

## The half that needed care

**Sign out was the only item with no other home**, and deleting a disclosure is exactly how a capability leaves a product without anybody noticing. It moved to Settings → General, which is the page about this account, and it sits above the delete section looking nothing like it — leaving is reversible, and a control that reads as destructive when it is not is its own kind of lie.

That is the assertion worth having, and it is written as a property rather than as a path: *something* in `src/` must render a `signOut` form, and Settings → General must be one of them. A test that only checked the component would have passed on a product nobody could sign out of.

**The palette switch stayed in the rail footer.** It has to be reachable from every screen — that is its whole purpose, since each screen in the redesign has to be checked in both palettes — and the footer is the only chrome both shells share. It is now one fewer click on every one of those checks, because there is nothing to open first.

## And then it inverted

The card kept the menu's bordered panel, which made it the one bordered thing at the foot of a rail of borderless rows — it read as a block of content rather than as the last row of the navigation. So the field arrives on hover instead of sitting there.

That looks like it contradicts `IconButton`, which argues at length that a bare mark with a fill arriving on hover is not a control on a phone: there is no hover there, so the resting state is the only state a finger ever sees. **That argument is about a control whose container is its whole affordance.** An icon alone says nothing about being pressable; an avatar and a name say who they are at rest, and every other row in this rail is exactly this shape. Touch still gets an answer — `active:` is a visible step past hover.

The border is `transparent` rather than absent, so it holds its pixel and nothing on the rail moves when it becomes visible. Measured: resting fill and border both `rgba(…, 0)`, hover `rgba(255 255 255 / 0.035)` and `rgba(255 255 255 / 0.13)`, box height and position identical across the two.

And the field is around the *identity*, not around the rail. Full width left roughly half of it empty past the subtitle, which reads as a large surface with a person in the corner rather than as a control wrapped around a name: 215px of field for 121px of content. `w-fit` with `max-w-full` hugs the content and still stops at the rail — a long name measures exactly the rail width and truncates rather than overflowing it. Every claim here is mutation-tested in both the unit guard and the browser one.

## Two small things measured rather than assumed

The link's accessible name is **"Tobi Founder"**, read from the rendered ARIA tree. The avatar carries `aria-hidden` inside the card: `Avatar`'s own label exists for the places it stands alone, and here it would have announced the same name twice before reaching the word that says where the link goes.

`account-menu.tsx` became `account-card.tsx` and the test id followed. A component that is no longer a menu should not be found by searching for one — the same rule this repository applies to a size that stops being the size it is named after.

## The name itself

The founder noted that the stored display name lives on another branch. Nothing here anticipates it: the card reads `identity.displayName` exactly as the menu did, so whatever that branch feeds into `buildAccountIdentity` arrives here without this file changing.

Unit 8,824 · browser 582 · lint 0/0.

# Porting a third-party component into Vibe

Run every item. Most pasted components fail four or five of these, and two fail
silently.

## Compile-blocking

- [ ] **Imports.** No `clsx`, `cva`, `tailwind-merge`, `lucide-react`,
      `@radix-ui/*`. None is a dependency. Replace `cn` with
      `@/lib/utils/cn`, and hand-author icons in the style of
      `src/components/ui/dashboard-icons.tsx`.
- [ ] **`framer-motion` → `motion/react`.** The package here is `motion` v13.
- [ ] **Server/client.** Add `"use client"` only if state, effects or handlers
      require it, and put it on the leaf — not on a page.

## Silent failures — the expensive ones

- [ ] **`cn` does not merge Tailwind conflicts.** `src/lib/utils/cn.ts` is a
      filtered join. A component whose API is "pass `className` to override the
      base" is broken here and looks fine. Restructure it so the base class is
      conditional, or fix the variant at the call site.
- [ ] **Light-theme assumptions.** Most catalogue components assume a light
      ground. `bg-white`, `text-black`, `border-gray-200`, `shadow-lg` and
      `dark:` variants all have to go. Vibe is a single dark ground: surfaces are
      white at low alpha, and a solid grey reads as a hole.

## Tokens

- [ ] Every colour is a Vibe token. No `text-[#…]`, no `bg-white/5`, no
      `gray-*`/`zinc-*`/`slate-*`.
- [ ] `mint` only for brand, primary action and active state. `amber` for
      waiting/partial. `coral` for failure/gap. A colour means the domain
      produced that state.
- [ ] Radius from `rounded-nav|well|panel|card|field|full`.
- [ ] Type from `text-hero|display|headline|title|lead|ui|label|caption|meta`.
- [ ] Shadow from `shadow-card|panel|mint|dot-*`.

## Accessibility

- [ ] Keyboard reachable, in a sensible order.
- [ ] Visible focus: `focus-visible:ring-2 focus-visible:ring-mint`.
- [ ] Correct role, accessible name, and state (`aria-selected`,
      `aria-expanded`, `aria-disabled`).
- [ ] A disabled control says **why** — see `TabDefinition.unavailable` in
      `src/components/ui/tabs.tsx` for the pattern.
- [ ] 4.5:1 on text against `--color-surface-4`.
- [ ] Decorative layers are `aria-hidden`.

## Motion

- [ ] `prefers-reduced-motion` removes transforms, continuous movement and
      pulsing — and leaves every piece of content present at first paint.
- [ ] Continuous motion pauses on a hidden tab (`useDocumentVisible`).
- [ ] Geometry reserved before the first event. A `min-h` that the short states
      clear is a floor, not a reservation — measure the **tallest** state.
- [ ] Transform and opacity only where possible.

## Truthfulness

- [ ] No fabricated number, percentage, count, logo, avatar, testimonial or
      chart. Catalogue components are full of `+20.1% from last month` — that is
      exactly what this product may not ship.
- [ ] No progress fraction the backend cannot measure.
- [ ] No success state before success exists.
- [ ] Missing data renders an explicit absent state, never a zero.

## Responsive

- [ ] No horizontal overflow at 390px.
- [ ] Wide content scrolls inside its own `overflow-x-auto` container.
- [ ] Identity (repository, branch, price) survives every breakpoint.

## Last question

Does the surface still read as **Vibe**, or as a catalogue component in Vibe's
colours? If the second, the port is not finished.

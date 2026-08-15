# Brand assets

Canonical Vibe Business marks. These files are the source; do not paste a copy
of one of them inline into a component, and do not recolour one by editing a
duplicate — reach for the variant that already exists.

| File | Use |
|---|---|
| `vibe-mark.svg` | The mark on the dark app frame (`--color-app`). Fixed colours. |
| `vibe-mark-on-light.svg` | The same mark on a light background — the left stroke goes near-black and the mint darkens to `--color-mint-deep` for contrast. |
| `vibe-mark-mono.svg` | Single-colour mark drawn with `currentColor`. Use when the mark must take the colour of its surroundings (print, a tinted panel, a monochrome context). |
| `vibe-lockup.svg` | Mark plus wordmark, for contexts that take a flat image rather than markup. In the app itself the lockup is composed by `<VibeLockup />` so the wordmark uses the real loaded typeface. |
| `vibe-credit.svg` | One Vibe Credit. |
| `vibe-credit-stack.svg` | Multiple credits / a balance. |
| `favicon.svg` | Browser tab icon. Also copied to `src/app/icon.svg`, which is what Next.js actually serves — keep the two in sync. |
| `favicon-credit.svg` | Tab icon variant for credit-related surfaces. |

In application code, prefer `src/components/brand/vibe-mark.tsx` over an
`<img>` tag: it picks the right variant, sizes the mark, and keeps the
accessible name correct for decorative vs. meaningful uses.

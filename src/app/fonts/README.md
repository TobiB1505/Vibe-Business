# Self-hosted fonts

The interface uses the native UI font stack from `globals.css`. The bundled
`woff2` files provide JetBrains Mono for technical output, split by writing
system. The former Space Grotesk files are retained only so older branches can
be checked out without re-downloading assets; the current application does not
load them.

## Why they are committed

`next/font/google` fetches fonts from `fonts.gstatic.com` **during
`next build`**, which makes every build depend on a third party being
reachable at that moment. That is not theoretical — a CI run failed with

```
Module not found: Can't resolve '@vercel/turbopack-next/internal/font/google/font'
  src: url(@vercel/turbopack-next/internal/font/google/font?{"url":"https://fonts.gs…
```

after the font *CSS* arrived but the font *binaries* did not, while the same
commit built successfully on a parallel runner seconds later. Committing the
files removes the dependency: the build is now deterministic and works
offline.

## Provenance

Each file was taken verbatim from the `next/font/google` build output of
commit `49cd39c` — the last commit that fetched them from Google. They are
therefore the exact bytes the application was already serving: same typeface,
same variable-axis instancing, same subsetting. Nothing was re-generated,
re-subsetted or substituted.

| Family | Subset | File | Bytes |
|---|---|---|---|
| Space Grotesk | latin | `space-grotesk-latin.woff2` | 22,320 |
| Space Grotesk | latin-ext | `space-grotesk-latin-ext.woff2` | 18,924 |
| Space Grotesk | vietnamese | `space-grotesk-vietnamese.woff2` | 6,772 |
| JetBrains Mono | latin | `jetbrains-mono-latin.woff2` | 31,340 |
| JetBrains Mono | latin-ext | `jetbrains-mono-latin-ext.woff2` | 11,596 |
| JetBrains Mono | cyrillic | `jetbrains-mono-cyrillic.woff2` | 8,892 |
| JetBrains Mono | cyrillic-ext | `jetbrains-mono-cyrillic-ext.woff2` | 1,664 |
| JetBrains Mono | greek | `jetbrains-mono-greek.woff2` | 6,800 |
| JetBrains Mono | vietnamese | `jetbrains-mono-vietnamese.woff2` | 5,872 |

JetBrains Mono is a variable font. The design system uses weights 400–700,
which is the axis span declared in `../fonts.ts`; the browser interpolates
within it, so there is no file per weight.

Only the JetBrains Mono `latin` file is preloaded. The others are fetched when
a page contains a character from their range.

## Licence

Both families are under the **SIL Open Font License 1.1**, which permits
redistribution of the font files. The upstream licence texts are committed
alongside them:

- `OFL-Space-Grotesk.txt` — Copyright 2020 The Space Grotesk Project Authors
- `OFL-JetBrains-Mono.txt` — Copyright 2020 The JetBrains Mono Project Authors

## Updating

There is no automated step, and deliberately so: a script that re-downloads
fonts at build time would reintroduce the dependency this exists to remove.
To take a newer version of a typeface, fetch it, replace the file, and check
the rendered result — then record what changed here.

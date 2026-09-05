---
name: 21st.dev
description: Search 21st.dev's catalogue of React/Tailwind components and full page templates through its MCP for interaction patterns, high-end cards, unusual layouts, AI interfaces, progress experiences and motion ideas. Use when designing a significant new surface, or when Vibe's existing presentation may be materially weaker than what exists in the catalogue. Requires API_KEY_21ST.
---

# 21st.dev

Read [ui-design-system](../ui-design-system/SKILL.md) and
[component-sourcing](../component-sourcing/SKILL.md) first.

`DESIGN.md` names this an **active design resource**, not a last resort: search it
broadly when designing a significant new surface.

## Access

MCP `21st` — `https://21st.dev/api/mcp`, header `x-api-key: ${API_KEY_21ST}`.
Without the key the server is unreachable and this skill degrades to nothing;
say so rather than guessing at components.

## Search properly

The catalogue has **components and full templates**, and they are different
result sets. Searching components only and concluding the catalogue is thin is a
mistake this repository has already made once — the correction was explicit user
feedback.

- Search several phrasings and both types.
- Look at previews at full resolution, not at names.
- Retrieve implementations for real candidates.

## Credits

`get_component` retrievals and `generate` are metered. **Do not generate paid
variants or spend credits unless explicitly asked.** Check `get_usage` when
budget matters. Prefer search and previews, and spend a retrieval only on a
component you have already decided is a candidate.

## Classify, then port

Every finding gets `DESIGN.md`'s label — **REUSE / ADAPT / HEAVILY ADAPT /
INSPIRE / REJECT** — and you report the rejections too.

Then [adaptation.md](../component-sourcing/adaptation.md), every item. Catalogue
components are the worst offenders for fabricated data: revenue figures, customer
logos, "5,000+ users", star ratings. **None of that may ship here**, and it is
often the thing making the preview look good. The replacement is real product
surfaces on stated example data — see `src/components/marketing/landing-flow.tsx`.

## Do not

- Judge the catalogue from two previews.
- Copy a template wholesale into a page.
- Keep a fabricated number, logo or testimonial.
- Spend credits without being asked.

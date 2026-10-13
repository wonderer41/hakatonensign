# 02 · Design

Direction: **liquid glass over a Monet "Water Lilies" palette-knife painting, with sharp edges.** Dark mode only. Calm pond colors, lilac for actions, pink for Hermes, hairline light edges, zero border radius.

All values below come from the approved mockup (`design/reference/Layout.dc.html`). Copy them exactly; do not round to a framework scale.

## Color tokens

Put these in `:root` as CSS custom properties (and in the Tailwind 4 `@theme` block).

| Token | Hex | Use |
|---|---|---|
| `--pond` | `#0E1A1F` | Page ground; base of all glass tints |
| `--deep-water` | `#1F4E5A` | Background masses |
| `--lily-pad` | `#4F7A4B` | Background, pad accents |
| `--lilac` | `#9C8FD0` | **Primary buttons**, progress fill, selected dots, "now" marker, Hermes work blocks |
| `--lilac-text` | `#C9C0F0` | Lilac text on dark (chips, links, Schedule button text) |
| `--lily-pink` | `#E59AB5` | Hermes identity (label, chat bubble border), issue numbers |
| `--reflection` | `#E8C77A` | Eyebrows, Seerr accent, 30–60m gaps |
| `--ink-light` | `#D8E2DC` | Panel hairlines, hard offset shadows, segmented control "on" |
| `--text-strong` | `#F1F4EF` | Headings, titles |
| `--text` | `#D5DDD8` | Body |
| `--text-muted` | `#A9B7B1` | Meta, labels, timestamps |
| `--text-done` | `#7E8C87` | Checked checklist items, past markers |
| `--green` | `#8CC79A` | Pipeline accent, gaps < 30m |
| `--amber` | `#F0B35A` | Broken / alerts, overlap label |
| `--stock-up` | `#4CD787` | Stock gains (with `▲ +`) |
| `--stock-down` | `#FF7A7A` | Stock losses (with `▼ −`) |
| `--on-lilac` | `#120E22` | Text on lilac buttons |

Source colors (legend squares, timeline markers): github `#F1F4EF`, hermes `#E59AB5`, gmail `#9C8FD0`, seerr `#E8C77A`, pipeline `#8CC79A`.

## Typography

Google Fonts: `Cormorant` (500, 600, 700, italic 500/600), `Archivo` (400, 500, 600), `JetBrains Mono` (400, 500, 600). Use `next/font/google` so they self-host.

| Role | Font | Size / weight |
|---|---|---|
| Page title "Today" | Cormorant | `clamp(44px, 6vw, 72px)` / 600, line-height .95, tracking −0.015em |
| Section titles (Timeline, Working on) | Cormorant | 36–40px / 600 |
| Rail titles (Broken, Waiting on you) | Cormorant | 30px / 600 |
| Daily message | Cormorant italic | `clamp(28px, 3.4vw, 40px)` / 600 |
| Gmail group counts | Cormorant | 44px / 600 |
| Body, titles in lists | Archivo | 15–17px / 400–600 |
| Eyebrows, meta, times, numbers, chips | JetBrains Mono | 11–13px; eyebrow uppercase, tracking .16em |
| Timeline times | JetBrains Mono | 17px / 600 |

Cormorant is for headings only; it gets thin and hard to read under ~18px. Body text stays Archivo. Add `-webkit-font-smoothing: antialiased; text-rendering: geometricPrecision` on `body`.

## Surfaces

**Glass panel** (banner, Working on, Waiting on you):
```css
background: rgba(14, 26, 31, 0.5);
backdrop-filter: blur(20px) saturate(150%);
-webkit-backdrop-filter: blur(20px) saturate(150%);
border: 1px solid #D8E2DC;
border-radius: 0;
box-shadow: inset 0 1px 0 rgba(255,255,255,.45), 0 30px 60px rgba(4,10,12,.5);
```
**Inner card:** `rgba(8,18,22,.35–.62)` fill, `1px solid rgba(216,226,220,.35)` border (full `#D8E2DC` when a card is open).
**Broken panel:** `rgba(240,179,90,.12)` fill, `1px solid #F0B35A`.
**Bubbles** (Hermes chat, Seerr): `rgba(12,22,27,.92–.94)` + blur 16px, `1px solid` lilac (Hermes) or `#E8C77A` (Seerr), hard shadow `6px 6px 0 rgba(156,143,208,.45)` / `rgba(232,199,122,.4)`, a 16px square rotated 45° as the tail.

**No rounded corners anywhere.** Sharp edges are part of the identity.

## Components

- **Primary button:** lilac fill, `--on-lilac` text 14px/600, `1px solid #D8E2DC`, **hard offset shadow `4px 4px 0 #D8E2DC`**, min-height 44px, padding 0 18px.
- **Secondary button:** `rgba(14,26,31,.85)` fill, light text, same border, shadow `4px 4px 0 rgba(216,226,220,.55)`.
- **Alert button:** transparent-dark fill, amber text and border, shadow `3px 3px 0 #F0B35A`.
- **Icon button:** 44×44, border, `3px 3px 0 rgba(216,226,220,.55)`; icons are inline stroke SVG (24 grid, stroke 1.6–1.8, `stroke-linejoin: miter`, `stroke-linecap: square`).
- **Chip:** JetBrains Mono 12px, padding 3px 8px, square. `In progress` = lilac text on `rgba(156,143,208,.16)` with lilac border; `Open` = light text, light border.
- **Segmented progress:** grid of N equal segments, 10px tall, 4px gap; done = lilac fill, open = `1px solid rgba(216,226,220,.4)` outline.
- **Segmented control (Temp | Permanent):** two 36px buttons sharing a border; on = `#D8E2DC` fill with pond text; `aria-pressed`.
- **Checkbox:** native input, 18×18, `accent-color: #9C8FD0`, whole row is the `<label>`, min-height 48px.
- **Inputs:** square, `rgba(8,18,22,.8)` fill, `1px solid #D8E2DC`, JetBrains Mono 15px, `color-scheme: dark`, min-height 44px.
- **Waiting items:** inner card with a 3px left border in the source color.

## Motion

- Banner slide: `transform` 600ms `cubic-bezier(.2,.7,.2,1)`; autoplay 7s.
- Timeline: continuous ~12px/s; arrow jumps 600ms same easing.
- Card open/close: `grid-template-rows` 450ms same easing; chevron rotates 180° in 350ms.
- Checklist check: color 250ms.
- `prefers-reduced-motion: reduce`: no autoplay, no auto-scroll, transitions ≤ 1ms.

## Background

The approved background is **"Palette knife v7 · after Water Lilies"**: thick knife marks in rounded-triangle shapes with ridges, color streaks and cast shadows, arranged like Monet's Water Lilies (horizontal water passes, vertical willow reflections, lilac sky patches, lily-pad rafts with pink flowers).

- Use the pre-rendered images, not the live SVG (the live version is ~1 MB of filtered SVG and is slow to repaint):
  - `design/assets/background-palette-knife-2560.webp` (2560×1600) for landscape.
  - `design/assets/background-palette-knife-portrait-1200.webp` (1200×1920) for portrait/phones.
- Apply as `background: #0E1A1F url(...) center / cover fixed no-repeat` on a full-viewport layer behind content, with the portrait image under `@media (orientation: portrait)`.
- To make other sizes: `python3 design/tools/generate_background.py` (see the `svg()` function: `svg(W, H, seed, prefix, scale, view=...)`), render in headless Chromium, convert to WebP.

## Layout

- Container `max-width: 1360px`, side padding `clamp(16px, 4vw, 48px)`, vertical gap 28px between sections.
- Two columns: `flex-wrap: wrap`; Working on `flex: 2 1 560px`, Warnings `flex: 1 1 300px`, gap 24px.
- Banner grids use `repeat(auto-fit, minmax(min(Npx, 100%), 1fr))` so they collapse on phones (stocks N=280, Gmail N=240).

## Accessibility

- Text contrast ≥ 4.5:1 over the darkest and lightest parts of the glass; keep glass opacity ≥ 0.5 over the painting.
- Real `<button>`, `<a href>`, `<input>` + `<label>`; `aria-expanded` on card toggles and the Seerr card; `aria-label` on icon-only buttons and slide dots; `role="group"` + `aria-label` on bubbles.
- Visible focus ring: `outline: 2px solid #C9C0F0; outline-offset: 3px`.
- Color never carries meaning alone (stock arrows/signs, chip words, `done` label).

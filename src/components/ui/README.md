# Shared UI primitives

Plain React + Tailwind 4 on the tokens in `src/app/globals.css` (component CSS lives there under
`@layer components`). Sharp edges everywhere. Import each
file directly (no barrel), e.g. `import { Button } from "@/components/ui/button"`. Every component takes
`className` for layout; utilities win over the component CSS.

| Import | Exports | Use |
|---|---|---|
| `ui/glass-panel` | `GlassPanel` | Glass surface. `tone="glass" \| "broken"`, `pad="section"` (28px) `\| "rail"` (22px) `\| "none"`, `as` section/div/aside/article. Give it `aria-label`. |
| `ui/inner-card` | `InnerCard`, `SourceName` | Card inside a panel. `open` (fill .62, full border), `accent="seerr"` etc. (3px left border, fill .42). |
| `ui/button` | `Button` | `variant="primary" \| "secondary" \| "alert" \| "ghost" \| "icon"`, `size="sm"` (13px, 3px shadow). Icon buttons require `aria-label`. `type` defaults to `"button"`. |
| `ui/chip` | `Chip` | `tone="in-progress"` (also booked time tags) `\| "open" \| "neutral"`. |
| `ui/segmented-control` | `SegmentedControl` | Two options, `aria-pressed`, `label` names the group. 36px look, 44px hit area. |
| `ui/typography` | `Eyebrow`, `SectionTitle`, `RailTitle` | Mono .16em eyebrow (`tone="muted" \| "reflection"`); Cormorant 40/36px (`size`); rail 30px (`tone="amber"` in Broken). |
| `ui/progress-segments` | `ProgressSegments` | `segments: boolean[]` in checklist order, `label` required (role progressbar). |
| `ui/checkbox` | `CheckboxRow` | Native checkbox; the row is the label (48px). `checked` + `onCheckedChange`. Checked rows go #7E8C87; children inherit `currentColor`. |
| `ui/inputs` | `TextInput`, `NumberInput`, `TimeInput`, `Field` | Square mono inputs, 44px. Wrap in `Field label="Start"`. `aria-invalid` turns the border amber. The native time picker follows the browser locale (12 h in en-US). |
| `ui/bubble` | `Bubble` | Hermes / Seerr bubble with the rotated-square tail. `label` (role group), optional `heading`, `onClose` (× button + Escape), `tail={{ side, offset }}` or `null`. |
| `ui/source-down` | `SourceDown`, `formatSourceDown` | "Calendar unavailable — last synced 10:42". Renders nothing when `source.ok`. Pass `now` and `timeZone` from `useDashboard()`. |
| `ui/skeleton` | `Skeleton`, `SkeletonPanel` | Shimmer blocks (static under reduced motion); a panel-shaped placeholder with the real title. |
| `ui/icons` | `ChevronLeft/Right/DownIcon`, `CloseIcon`, `ChatIcon`, `WarningIcon`, `CommitIcon`, `CheckIcon`, `ExternalIcon` | 24-grid stroke SVGs, `aria-hidden`; `size`, `strokeWidth`. |
| `ui/cx` | `cx` | Class-name join. |

Rules
- Real `<button>`, `<a href>`, `<input>` + `<label>`; 44px targets; the global `:focus-visible` ring
  (2px #C9C0F0, offset 3px) applies everywhere, so don't remove outlines.
- Motion is CSS transitions only; `prefers-reduced-motion` already cuts them to 1ms globally. JS-driven motion
  (banner autoplay, timeline auto-scroll) must check `matchMedia("(prefers-reduced-motion: reduce)")` itself.
- Color never carries meaning alone: keep the words ("In progress", "done", "▲ +").
- Need a new primitive? Put it in its own file here and say so in your report (other agents work in parallel).

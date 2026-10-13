# 01 · Product spec

One page, one person, dark mode only. It answers: what is on my calendar today, what am I working on, and what is waiting on me or broken. Everything on it changes during the day and updates live.

## Page structure (top to bottom)

```
┌──────────────────────────────────────────────────────────────┐
│ Header: date eyebrow · "Today" · source legend               │
├──────────────────────────────────────────────────────────────┤
│ Banner (slides): Daily message → Gmail → Orphans+Scan → Stocks│
├──────────────────────────────────────────────────────────────┤
│ Timeline (today's calendar, gaps labeled, auto-scrolls)      │
├────────────────────────────────────────┬─────────────────────┤
│ Working on (2/3): sprint cards          │ Warnings (1/3):     │
│  · collapsed: progress + current item   │  · Broken           │
│  · open: checklist + Hermes scheduling  │  · Waiting on you   │
└────────────────────────────────────────┴─────────────────────┘
```

Below ~900px the two columns stack (Working on first). Max content width 1360px.

---

## Header

- Eyebrow: weekday · month day (e.g. `MONDAY · OCTOBER 12`) in the dashboard time zone.
- Title "Today".
- Legend of source colors: github, hermes, gmail, seerr, pipeline (8px squares).

## Banner

A glass panel that slides horizontally between four slides. Auto-advance every 7s; square dot buttons (44×44 hit area) jump to a slide; auto-advance pauses while hovered or focused and is off under `prefers-reduced-motion`.

| # | Slide | Content | Source |
|---|-------|---------|--------|
| 1 | Daily message | One line in Cormorant italic, 28–40px. | `DailyMessage` for today (written by Gerardo or Hermes — decision D13). Empty state: hide the slide. |
| 2 | Gmail | Four groups in columns, each with a large count and label: **Needs reply** (sender + subject per row, the only group with senders), **Packages** (store/item + status word), **Payments** (merchant + time only, no amounts), **Deleted** (count + "moved to trash since 08:00"). | `BannerSnapshot(kind=gmail)` pushed by Hermes. |
| 3 | Orphans + daily scan | Left (2/3): "Orphans · manual review" — a short list of names only (episode/movie), plus item count. Right (1/3): "Daily scan · 06:00" — one big status (`1 issue` amber, or `All up` green), `n / n up`, and one line per issue (container + one-line status). | `BannerSnapshot(kind=orphans)` and `BannerSnapshot(kind=scan)`. |
| 4 | Stocks | A 4 × 3 list (12 rows) with columns Symbol · Price · Day · 6M. Changes use stock-site colors: up = green with `▲ +`, down = red with `▼ −` (the sign and arrow carry meaning, not color alone). | `BannerSnapshot(kind=stocks)`; source and watchlist = decision D9. |

Slides with no data are skipped. The slide with the oldest snapshot shows a muted "as of HH:MM" label.

## Timeline

Today's calendar as a horizontal row of cards connected by a line.

- **Data:** `CalendarEvent` rows overlapping the selected local day, sorted by start. All-day events show as small chips before the first timed event.
- **Card:** time range in JetBrains Mono 17px/600 (e.g. `13:00–14:15`), a source word (`calendar`, `via hermes`, `done`), and the title at 17px.
- **States:** past events (ended before now) are dimmed to 55% with a gray marker and the label `done`; Hermes-created work blocks are lilac with a filled lilac marker and `via hermes`; future events have a hollow light marker.
- **Now marker:** a dashed lilac card inserted at the current time, updated every minute.
- **Gaps:** above the line between two items, the free time from the end of one to the start of the next, formatted `36m` or `1h 21m`. The line segment and label are colored: under 30m green `#8CC79A`, 30–60m gold `#E8C77A`, over 60m pink `#E59AB5`. A legend reads "free time: under 30m · 30–60m · over 1h". Overlapping events show `overlap` in amber instead of a gap.
- **Motion:** auto-scrolls left very slowly (~12px/s), loops back to the start after a short pause at the end, pauses on hover/focus, holds for 10s after the arrow buttons are used. Earlier/Later arrow buttons step one card. Off under `prefers-reduced-motion` (arrows only).
- **Daily rollover:** at local midnight the page loads the new day's timeline without a reload. A date param (`?date=YYYY-MM-DD`) shows another day (read-only past, editable future).
- **Live:** calendar changes (including blocks Hermes just created) appear within seconds via the live stream.

## Working on (2/3 column)

Header "Working on", plus the active sprint name and days left (decision D8 settles how sprints are defined). Cards are **data-driven**: any number, any order, created or changed by Gerardo, GitHub sync or Hermes.

**Collapsed card**
- Title (repo name or card title) in JetBrains Mono 18px/600, meta on the right (`last commit 10:31 · 6 this week`, or `no commits yet · design phase`), chevron.
- Milestone line: `Milestone · v0.2 review queue` and `5 / 8 issues`.
- Segmented progress bar: one segment per checklist item, filled lilac when done.
- Current item row: `now`/`next` label, `#12`, title, status chip (`In progress` lilac, `Open` outlined).
- If Hermes has a suggestion for the current item: a pink-bordered Hermes row with "Schedule with Hermes".

**Open card** (click the title row; `aria-expanded`)
- The card grows smoothly (animate `grid-template-rows: 0fr → 1fr`, ~450ms); the summary collapses and the **checklist** expands.
- Checklist rows: real checkbox (accent lilac), issue number, title. Checking an item turns the row gray (`#7E8C87`) and updates the progress bar and count immediately (optimistic, then confirmed by the server).
- Each unchecked item has a **Schedule** button (Reschedule once booked). A booked item shows a lilac time tag `19:00–20:30`.
- In the mockup one card is open at a time (opening another closes the first). Keep that unless Gerardo asks otherwise.

**Hermes scheduling bubble** (opens under the item, sharp corners, lilac border, hard offset shadow, small square tail)
1. Hermes asks: "When should I block time for #13 Streak tracking?"
2. Gerardo enters **Start** (time input) and **Length** in minutes (free number field, 1–720, any value such as 47; a readable echo shows `1 h 23 min`) and presses **Ask Hermes**.
3. The bubble shows his message on the right (lilac fill) and "Hermes is checking your calendar…" while the request runs.
4. Results:
   - **Booked:** "Done. #13 is on your calendar 19:00–20:30." The item gets the time tag, the timeline shows the new lilac block.
   - **Conflict:** "I can't book that: [Work shift] is on your calendar 15:30–18:30. The next free 1 h 30 min starts at 20:30." plus a one-click `Use 20:30` button that fills the start time.
   - **Past time:** "That time already passed today. Pick something after 11:45."
   - **Past midnight:** "That runs past midnight. Try an earlier start."
   - **Invalid length:** "Give me a length of at least 1 minute."
   - **Hermes error/timeout:** "Hermes didn't answer. Try again." (keep the form).
5. Close with the × button (44×44). Esc also closes.

## Warnings (1/3 column)

**Broken** (amber panel; hidden when there are no open alerts)
- One row per open `Alert`: title (`VM 100 backup missed`), mono detail (`vzdump · Sun 01:00`), and a **Block time** button that opens the same Hermes scheduling bubble for that alert.

**Waiting on you** (glass panel)
- **Gmail:** `1 starred thread needs a reply` (from the gmail snapshot).
- **Seerr:** button card `2 guest requests to approve` → opens a bubble listing pending requests: poster placeholder (44×66), title, type, requested by; a **Temp | Permanent** segmented switch (default Temp, Gerardo's rule for guests); **Approve** / **Decline**. Handled rows gray out with `Approved → Temp library` / `Declined`; the count drops. An `Open Seerr ↗` link goes to `https://requests.wonderer41.org`.
- **Orphan review:** split in two link tiles, **Sonarr ↗** (`n episodes`) and **Radarr ↗** (`n movies`). URLs come from `SONARR_URL` / `RADARR_URL` (NPM domains, see `docs/06-INTEGRATIONS.md`).

Each item hides itself when its count is zero; the whole panel shows "Nothing waiting." when all are empty.

## Global states

- **Loading:** skeleton blocks with the panel shapes (no spinners), shimmer off under reduced motion.
- **Source down:** each section degrades on its own with one plain line ("Calendar unavailable — last synced 10:42"). Never blank the whole page.
- **Live connection lost:** a small muted "Reconnecting…" label in the header; reconnect with backoff.

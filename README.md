# Sprintline

A sprint-snapped Gantt for product planning. Timeline runs **Aug 2026 → Jan 2028** with month headers, subtle quarter delineations, and a 2-week sprint ruler. Ships preloaded with the Product Management Idea Board (Aug 7, 2026 export).

## Features

- **Sprint-snapped bars.** Drag a bar to move it; drag its right edge to resize. All changes snap to 2-week sprint increments so lengths map to real development windows, never abstract widths.
- **Row reordering.** Drag the grip on any row to move items up or down.
- **Dependencies.** Drag the dot on a bar's right edge onto another item to draw a dependency arrow. Click an arrow to remove it.
- **Editable columns.** Click any row or bar to open the editor. Every column is editable, including the added `Parent` column (defaults to `none`; pick another item's Key).
- **Highlight.** Multi-select values from any column (except Summary) to apply an amber highlight treatment to matching items.
- **Filter.** Multi-select values from any column (except Summary) to hide everything else for a focused view.
- **CSV round-trip.** Upload a CSV to replace the board; download the current board (includes Parent, sprint positions, dates, and dependencies so a re-upload restores your layout).
- Edits persist in your browser via localStorage. **Reset data** restores the built-in dataset.

## CSV format

Upload any CSV with a `Summary` column. Recognized columns: `Summary, Assignee, Status, Theme, Delivery Quarter, Teams, Delivery progress, Key, Effort, Impact, Parent`. Missing `Parent` defaults to `none`.

Bar placement on upload:
1. If `Start Sprint` and `Length (sprints)` columns exist (they're in every download from this tool), those are used.
2. Otherwise bars are seeded from `Delivery Quarter` (e.g. `26Q4, 27Q1`), clamped to the timeline.
3. Blank quarters start at sprint 0 with a 3-sprint length.

Dependencies restore from a `Depends On (Keys)` column (semicolon-separated Keys).

## Deploy

No build step. It's a static site: `index.html`, `styles.css`, `app.js`, `data.js`.

### 1. Push to GitHub (github.com/ricardougarcia)

```bash
cd sprintline
git init
git add .
git commit -m "Sprintline: sprint-snapped product planning Gantt"
git branch -M main
git remote add origin https://github.com/ricardougarcia/sprintline.git
git push -u origin main
```

(Create the empty `sprintline` repo first at github.com/new, or run `gh repo create ricardougarcia/sprintline --public --source=. --push` if you use the GitHub CLI.)

### 2. Deploy on Vercel (rico-g-projects)

Option A, dashboard: vercel.com/new → import `ricardougarcia/sprintline` under the **rico-g-projects** scope → Framework preset: **Other** → no build command, output directory blank → Deploy.

Option B, CLI:

```bash
npm i -g vercel
vercel --scope rico-g-projects
vercel --prod --scope rico-g-projects
```

Every push to `main` redeploys automatically once the repo is linked.

## Local preview

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

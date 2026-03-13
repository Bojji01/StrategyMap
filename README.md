# StrategyHub — LoL Strategy Map & Draft Tool

Interactive League of Legends strategy planning suite with a collaborative strategy map and a real-time draft pick/ban system.

---

## Strategy Map

Interactive map for planning team movements, ward placements, and game scenarios.

### Features

- **Champion Markers**: 5 blue + 5 red team markers with role assignments (Top, Jungle, Mid, Bot, Support)
- **Champion Select**: Click a marker, then select a champion from the Data Dragon grid
- **Minion Markers**: Blue and red minion wave markers
- **Ward System**: Yellow and pink wards with vision radius display
- **Drawing Tools**: Freehand pen with color selection (red, orange, blue, white, yellow) and eraser
- **Brush Size Control**: Adjustable pen/eraser width
- **Navigation**: Zoom (scroll wheel) and pan (middle mouse drag)
- **Size Control**: Adjustable marker size for all markers
- **Keyboard Shortcuts**: Quick tool switching with A, D, E keys
- **Real-Time Collaboration**: Firebase-synced map with shared room links

### Controls

| Action | Control |
|--------|---------|
| Select Mode | `A` key or click Select button |
| Draw Mode | `D` key or click Draw button |
| Erase Mode | `E` key or click Erase button |
| Change Brush Color | Click Draw button again while in draw mode |
| Zoom | Mouse scroll wheel |
| Pan | Middle mouse button + drag |
| Draw | Select pen tool, click and drag |
| Erase | Select eraser, click on objects |
| Move markers | Select mode, drag markers |
| Place marker | Drag from toolbar to map |

---

## Draft Pick/Ban

Full-featured League of Legends competitive draft system with real-time collaboration.

### Features

- **Normal Draft Mode**: Standard 20-step competitive pick/ban format (Ban Phase 1 → Pick Phase 1 → Ban Phase 2 → Pick Phase 2)
- **Fearless Draft Mode**: Champions picked in previous games are locked out for future games in a multi-game series
- **Real-Time Collaboration**: Firebase-synced rooms with 3 role-based links (Blue Team, Red Team, Spectator)
- **Ready Check System**: Both teams must click "Ready" before the draft begins; real-time status updates
- **Auto-Timer (30s)**: When the timer expires:
  - Pick phase + champion selected → auto locks in
  - Pick phase + no selection → random champion picked
  - Ban phase + champion selected → auto locks in
  - Ban phase + no selection → ban is skipped (shown as ✕)
- **Champion Grid**: Searchable, filterable by role (Top, Jungle, Mid, Bot, Support) with Data Dragon images
- **Fearless History**: Visual display of locked-out champions from previous games
- **Score Tracking**: Game-by-game score tracking for series play
- **Next Game Flow**: In Fearless mode, advancing to the next game triggers a new ready check
- **Role-Based Access Control**: Blue/Red team players can only act on their turn; spectators are view-only
- **Responsive Design**: Scales across all monitor sizes and DPI settings using CSS `clamp()` and media queries

### Draft Order (Competitive)

1. **Ban Phase 1**: B-R-B-R-B-R (6 bans)
2. **Pick Phase 1**: B-RR-BB-R (6 picks)
3. **Ban Phase 2**: R-B-R-B (4 bans)
4. **Pick Phase 2**: R-BB-R (4 picks)

---

## Tech Stack

- **Fabric.js** — Canvas manipulation (strategy map)
- **Firebase Realtime Database** — Real-time collaboration sync
- **Riot Data Dragon API** — Champion images and data
- **Vanilla JavaScript** — No frameworks
- **CSS3** — Responsive layout with `clamp()`, media queries

## Getting Started

1. Clone the repo
2. Serve with any static HTTP server (e.g. `npx http-server . -p 8080`)
3. Open `index.html` for the Strategy Map or `draft.html` for Draft Pick/Ban
4. Use the top navigation bar to switch between apps

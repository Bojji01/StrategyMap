# LoL Strategy Map

Interactive League of Legends strategy map for planning team movements, ward placements, and game scenarios.

## Features

- **Champion Markers**: 5 blue + 5 red team markers with role assignments (Top, Jungle, Mid, Bot, Support)
- **Champion Select**: Click a marker, then select a champion from the Data Dragon grid
- **Minion Markers**: Blue and red minion wave markers
- **Ward System**: Yellow and pink wards with vision radius display
- **Drawing Tools**: Freehand pen with color selection (red, orange, blue, white, yellow) and eraser
- **Brush Size Control**: Adjustable pen/eraser width
- **Navigation**: Zoom (scroll wheel) and pan (middle mouse drag)
- **Size Control**: Adjustable marker size for all markers
- **Keyboard Shortcuts**: Quick tool switching with A, D, E keys

## Controls

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

## Toolbar (Left)

- **Select** - Move placed markers
- **Draw** - Freehand drawing (click again to choose color)
- **Erase** - Remove objects
- **Brush Size** - Adjust pen/eraser width
- **Clear** - Remove all drawings
- **Recenter** - Reset zoom and position
- **Champion Markers** - 5 blue, 5 red (drag to map)
- **Minion Markers** - Blue/red wave icons
- **Wards** - Yellow/pink with vision radius
- **Marker Size** - Resize all markers

## Right Panel (Hamburger Menu)

- **Draft Select** - Assign champions to roles
- **Champion Search** - Filter champions by name
- **Champion Grid** - Click to assign to selected marker

## Tech Stack

- Fabric.js (canvas manipulation)
- Vanilla JavaScript
- Riot Data Dragon API (champion images)

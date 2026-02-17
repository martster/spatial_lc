# Spatial Live Coding AR

Browser-based AR visual live coding prototype using Hydra and a live camera stream.

## Goal

- Live-code visuals in the browser with Hydra.
- Use a two-device workflow: host (edit code) and viewer (place visuals in AR).
- Place time-based visual panels in space and collect them in a gallery.

## Run locally

Because camera access requires a secure context on many devices, use HTTPS or localhost.

```bash
# Option 1: Python
python3 -m http.server 8000

# Option 2: Node
npx serve .
```

Open `http://localhost:8000` and allow camera access.

## How it works

- `Host Session` (typically laptop): edits Hydra code and streams it live.
- `Join as Viewer` (typically phone): receives code updates and places AR panels.
- `Share Viewer Link`: opens native share flow (or clipboard fallback) to get the viewer URL onto the phone.
- AR modes are selected automatically:
  - WebXR AR where supported
  - iOS Quick Look where available
  - Desktop AR fallback (camera + 3D overlay)

## Gallery and panel behavior

- Each placed panel keeps the code state from its placement moment.
- Placed panels remain animated (with per-panel code context where possible).
- AR overlay supports `Undo Last` and `Clear All`.
- `Placed Moments` gallery stores snapshots and code snippets locally and can reload code.

## Notes

- iOS Safari and some Android browsers require explicit user interaction before media playback.
- WebXR support varies by browser/device; desktop fallback exists for unsupported environments.
- Code comments in this project are in English by design.

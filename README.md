# MakerX 3D File Sorter

A free Windows desktop app for organizing your 3D print file library — STL, 3MF, STEP/STP, and ZIP files.

**Download the latest release:** [makerxdesigns.com/utilities/3d-file-sorter.html](https://makerxdesigns.com/utilities/3d-file-sorter.html)

---

## What it does

- **AUTO sort (new in 2.0)** — group an entire folder into category folders with one click, each with a "Move All" button; an offline keyword classifier recognises names in several languages, files that don't match stay in an "Unsorted" list, and the app can suggest new groups it discovers
- Browse a folder of STL, 3MF, STEP/STP, and ZIP files in a sidebar, **sorted by name, date, or size** (new in 2.0)
- Preview any STL, 3MF, or STEP/STP file in a 3D viewer (no slicer required) — STEP files are tessellated locally via an OpenCASCADE engine; **ticking a file's checkbox previews it too** (new in 2.0)
- Rename, move to subfolders, or delete files via right-click
- Select multiple files with checkboxes to bulk move or bulk delete
- Print weight, time, and cost estimates for any loaded file
- Drag files onto folder targets or the trash zone
- Auto-detects and reopens your last folder on launch

All file operations happen locally — nothing is uploaded anywhere.

---

## Why this repo exists

The app installer triggers a Windows SmartScreen warning because it is not signed with a paid code-signing certificate. This repository contains the complete source code so you can verify exactly what the app does before running it.

---

## Tech stack

| Layer | Technology |
|---|---|
| Desktop shell | [Electron](https://www.electronjs.org/) v28 |
| 3D rendering | [Three.js](https://threejs.org/) r160 |
| STEP/STP parsing | [occt-import-js](https://github.com/kovacsv/occt-import-js) (OpenCASCADE, WASM) |
| ZIP reading | [JSZip](https://stuk.github.io/jszip/) |
| ZIP extraction (main process) | [adm-zip](https://github.com/cthackers/adm-zip) |
| Installer | electron-builder (NSIS, x64) |

---

## Source layout

```
index.html      — UI shell: 3D viewer, file list, multi-select, print estimates
app.js          — renderer logic: file list, viewer, estimates, sort-by, selection
auto-sort.js    — offline keyword classifier + the AUTO-sort grouped view
style.css       — app styles
main.js         — Electron main process (file system access, IPC handlers)
preload.js      — context bridge exposing safe IPC APIs to the renderer
libs/
  three.min.js        — Three.js (bundled, no CDN dependency at runtime)
  jszip.min.js        — JSZip (bundled)
  occt-import-js.js   — OpenCASCADE STEP/STP loader (bundled)
  occt-import-js.wasm — OpenCASCADE engine (bundled, ~7.6 MB)
package.json    — project manifest and electron-builder config
```

---

## Building from source

```bash
npm install
npm run build   # produces dist/MakerX 3D Viewer Setup x.x.x.exe
```

Requires Node.js 18+ and npm.

---

## License

© 2025 MakerX Designs. All Rights Reserved.

This source code is published for **inspection purposes only** — so you can verify what the app does before running it. It may not be copied, modified, redistributed, or used as the basis for other projects. 


---

*Built by [MakerX Designs](https://makerxdesigns.com) — Virginia Beach, VA*

# Electron app icons

Raster `icon.png` (512×512) and SVG sources copied from brand assets (`prod-example/.upriv/app/assets/`).

Used by `electron-builder` via `"icon": "build/icons/icon.png"` in `package.json`.

**Version control:** `build/icons/` is tracked in git (only `apps/electron/dist/` is gitignored).

Do not reference `prod-example/` at runtime — these files are bundled into the desktop shell only.

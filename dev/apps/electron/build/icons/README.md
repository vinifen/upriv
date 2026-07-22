# Electron app icons

Raster sources for `electron-builder` (AppImage + `.deb` + window icon).

| File | Role |
|------|------|
| `icon.png` | 512×512 master (also used as fallback) |
| `16x16.png` … `512x512.png` | Linux hicolor theme sizes (menu / dock / launcher) |
| `Upriv.svg` / `Upriv-icon.svg` | Vector sources |

Copied from brand assets (`prod-example/.upriv/app/assets/`). Do not reference `prod-example/` at runtime.

**Linux `.deb`:** installs under `/usr/share/icons/hicolor/<size>/apps/upriv-electron.png` and refreshes the icon cache in `afterInstall`.

**Version control:** `build/icons/` is tracked in git (only `apps/electron/dist/` is gitignored).

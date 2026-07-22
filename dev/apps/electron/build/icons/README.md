# Electron app icons

Raster sources for `electron-builder` (AppImage + `.deb` + Windows `.exe` + window icon).

| File | Role |
|------|------|
| `icon.png` | 512×512 master (also used as fallback) |
| `icon.ico` | Multi-size Windows icon (Explorer / Start / title bar resource) |
| `16x16.png` … `512x512.png` | Linux hicolor theme sizes (menu / dock / launcher) |
| `Upriv.svg` / `Upriv-icon.svg` | Vector sources |

Copied from brand assets (`prod-example/.upriv/app/assets/`). Do not reference `prod-example/` at runtime.

**Windows:** `afterPack` embeds `icon.ico` into `Upriv.exe` via standalone `rcedit` (avoids `winCodeSign` symlink / Developer Mode). NSIS installer icons also use `icon.ico`.

**Linux `.deb`:** installs under `/usr/share/icons/hicolor/<size>/apps/upriv-electron.png` and refreshes the icon cache in `afterInstall`.

**Version control:** `build/icons/` is tracked in git (only `apps/electron/dist/` and `build/tools/` are gitignored).

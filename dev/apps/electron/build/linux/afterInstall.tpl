#!/bin/bash
# Post-install for the .deb package.
#
# `${executable}` is the menu / alternatives target under /opt/…/
# After electron-builder afterPack, that path is the **bash wrapper** (not the
# Chromium `.bin`). Desktop launch therefore goes through the wrapper:
# - AppImage: N/A (this script is deb-only)
# - .deb: wrapper sees empty APPIMAGE → exec real binary *with* chrome-sandbox
#
# Smoke after `dpkg -i`: menu opens wrapper → resources/bin/upriv-daemon;
# `ps` / env should show no forced `--no-sandbox` on .deb; chrome-sandbox mode
# below still applies for systems without user namespaces.

if type update-alternatives 2>/dev/null >&1; then
    # Remove previous link if it doesn't use update-alternatives
    if [ -L '/usr/bin/${executable}' -a -e '/usr/bin/${executable}' -a "`readlink '/usr/bin/${executable}'`" != '/etc/alternatives/${executable}' ]; then
        rm -f '/usr/bin/${executable}'
    fi
    update-alternatives --install '/usr/bin/${executable}' '${executable}' '/opt/${sanitizedProductName}/${executable}' 100 || ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
else
    ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
fi

# Always SUID chrome-sandbox on .deb.
# Kernel userns can exist (`unshare --user`) while AppArmor still blocks
# unprivileged userns for Chromium (`apparmor_restrict_unprivileged_userns=1`
# on Ubuntu). Then Electron aborts: chrome-sandbox found but not mode 4755.
# AppImage never uses this script (FUSE nosuid → wrapper --no-sandbox).
# Do not swallow failures: a 0755 chrome-sandbox makes the Apps menu icon a no-op.
SANDBOX='/opt/${sanitizedProductName}/chrome-sandbox'
chown root:root "$SANDBOX"
chmod 4755 "$SANDBOX"
mode=$(stat -c '%a' "$SANDBOX" 2>/dev/null || true)
case "$mode" in
  4755|6755) ;;
  *)
    echo "upriv-electron postinst: chrome-sandbox mode is '$mode' (want 4755); menu launch will abort" >&2
    exit 1
    ;;
esac

if hash update-mime-database 2>/dev/null; then
    update-mime-database /usr/share/mime || true
fi

if hash update-desktop-database 2>/dev/null; then
    update-desktop-database /usr/share/applications || true
fi

# Refresh hicolor so Upriv icons (16–512) show in the app menu / dock.
if hash gtk-update-icon-cache 2>/dev/null; then
    gtk-update-icon-cache -f /usr/share/icons/hicolor || true
elif hash update-icon-caches 2>/dev/null; then
    update-icon-caches /usr/share/icons/hicolor || true
fi

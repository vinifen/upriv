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

# Check if user namespaces are supported by the kernel and working with a quick test:
if ! { [[ -L /proc/self/ns/user ]] && unshare --user true; }; then
    # Use SUID chrome-sandbox only on systems without user namespaces:
    chmod 4755 '/opt/${sanitizedProductName}/chrome-sandbox' || true
else
    chmod 0755 '/opt/${sanitizedProductName}/chrome-sandbox' || true
fi

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

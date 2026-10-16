import fs from "node:fs";
import path from "node:path";

/** First line of the portable file. A second wrap leaves the file alone. */
export const PORTABLE_LAUNCHER_MARK = Buffer.from("#!/bin/sh\n# Upriv portable launcher\n");

const OFFSET_WIDTH = 10;

/**
 * Shell prefix plus the original AppImage bytes.
 * Running the result sets `APPIMAGE_EXTRACT_AND_RUN` so startup does not need
 * system `libfuse2`, and `UPRIV_PORTABLE_FILE` so the data folder stays beside
 * this download rather than the extracted cache copy.
 */
export function wrapPortableAppImage(payload: Buffer): Buffer {
  const draft = launcherScript(0);
  const offset = Buffer.byteLength(draft);
  const script = launcherScript(offset);
  if (Buffer.byteLength(script) !== offset) {
    throw new Error("portable launcher length changed while writing the payload offset");
  }
  return Buffer.concat([Buffer.from(script, "utf8"), payload]);
}

export function wrapAppImageFile(file: string): void {
  const current = fs.readFileSync(file);
  if (current.subarray(0, PORTABLE_LAUNCHER_MARK.length).equals(PORTABLE_LAUNCHER_MARK)) return;
  const wrapped = wrapPortableAppImage(current);
  const tmp = `${file}.wrapping`;
  fs.writeFileSync(tmp, wrapped, { mode: 0o755 });
  fs.chmodSync(tmp, 0o755);
  fs.renameSync(tmp, file);
}

export function wrapAppImageArtifacts(artifactPaths: readonly string[]): void {
  for (const artifact of artifactPaths) {
    if (path.extname(artifact) !== ".AppImage") continue;
    wrapAppImageFile(artifact);
  }
}

function launcherScript(payloadOffset: number): string {
  const digits = String(payloadOffset);
  if (digits.length > OFFSET_WIDTH) {
    throw new Error("portable payload offset does not fit");
  }
  const offset = digits.padStart(OFFSET_WIDTH, "0");
  return `#!/bin/sh
# Upriv portable launcher
# The AppImage payload begins at PAYLOAD_OFFSET. Extracting it avoids a system libfuse2.
set -eu
SOURCE=$0
while [ -L "$SOURCE" ]; do
  DIR=$(CDPATH= cd "$(dirname "$SOURCE")" && pwd)
  SOURCE=$(readlink "$SOURCE")
  case $SOURCE in
    /*) ;;
    *) SOURCE=$DIR/$SOURCE ;;
  esac
done
DIR=$(CDPATH= cd "$(dirname "$SOURCE")" && pwd)
FILE=$DIR/$(basename "$SOURCE")
OFFSET_TEXT=${offset}
# Decimal. $((0000000008)) is an octal error in /bin/sh.
PAYLOAD_OFFSET=$(expr "$OFFSET_TEXT" + 0)
if [ -n "\${XDG_CACHE_HOME:-}" ]; then
  CACHE=$XDG_CACHE_HOME
elif [ -n "\${HOME:-}" ]; then
  CACHE=$HOME/.cache
else
  CACHE=/tmp
fi
DEST_DIR=$CACHE/upriv/appimage
mkdir -p "$DEST_DIR"
SIZE=$(stat -c %s "$FILE")
MTIME=$(stat -c %Y "$FILE")
PAYLOAD_SIZE=$((SIZE - PAYLOAD_OFFSET))
DEST=$DEST_DIR/\${SIZE}-\${MTIME}.AppImage
NEED=0
if [ ! -f "$DEST" ]; then
  NEED=1
else
  DEST_SIZE=$(stat -c %s "$DEST")
  if [ "$DEST_SIZE" != "$PAYLOAD_SIZE" ]; then
    NEED=1
  fi
fi
if [ "$NEED" = 1 ]; then
  TMP=$(mktemp "$DEST_DIR/.payload.XXXXXX")
  tail -c +$((PAYLOAD_OFFSET + 1)) "$FILE" > "$TMP"
  chmod 700 "$TMP"
  mv -f "$TMP" "$DEST"
fi
chmod 700 "$DEST"
if [ -n "\${UPRIV_PORTABLE_TEST_ECHO:-}" ]; then
  printf '%s\\n' "$FILE"
  printf '%s\\n' "$DEST"
  exit 0
fi
export UPRIV_PORTABLE_FILE=$FILE
export APPIMAGE_EXTRACT_AND_RUN=1
exec "$DEST" "$@"
`;
}

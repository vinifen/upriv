/**
 * Download the official unmodified WinFsp installer into build/winfsp/.
 * The MSI is redistributed with the Windows setup and the portable exe.
 * It is not committed. The SHA-256 is the hash published on the v2.1 release.
 */
const { createHash } = require("node:crypto");
const { createWriteStream } = require("node:fs");
const { mkdir, readFile, rename, rm } = require("node:fs/promises");
const https = require("node:https");
const path = require("node:path");

const FILE_NAME = "winfsp-2.1.25156.msi";
const URL = `https://github.com/winfsp/winfsp/releases/download/v2.1/${FILE_NAME}`;
const SHA256 = "073a70e00f77423e34bed98b86e600def93393ba5822204fac57a29324db9f7a";
const DEST_DIR = path.join(__dirname, "..", "build", "winfsp");
const DEST = path.join(DEST_DIR, FILE_NAME);

function download(url, dest, redirectsLeft) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      const status = response.statusCode ?? 0;
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();
        if (redirectsLeft <= 0) {
          reject(new Error("WinFsp download redirected too many times"));
          return;
        }
        download(response.headers.location, dest, redirectsLeft - 1).then(resolve, reject);
        return;
      }
      if (status !== 200) {
        response.resume();
        reject(new Error(`WinFsp download failed: HTTP ${status}`));
        return;
      }
      const file = createWriteStream(dest);
      response.pipe(file);
      file.on("error", reject);
      file.on("finish", () => file.close((error) => (error ? reject(error) : resolve())));
    });
    request.on("error", reject);
  });
}

async function sha256(file) {
  const bytes = await readFile(file);
  return createHash("sha256").update(bytes).digest("hex");
}

async function main() {
  await mkdir(DEST_DIR, { recursive: true });
  try {
    if ((await sha256(DEST)) === SHA256) {
      console.log(`[winfsp] ${FILE_NAME} already matches the pinned hash`);
      return;
    }
  } catch {
    // Missing file. Download it below.
  }
  const partial = `${DEST}.partial`;
  await rm(partial, { force: true });
  console.log(`[winfsp] downloading ${URL}`);
  await download(URL, partial, 5);
  const hash = await sha256(partial);
  if (hash !== SHA256) {
    await rm(partial, { force: true });
    throw new Error(`WinFsp installer hash mismatch: ${hash}`);
  }
  await rename(partial, DEST);
  console.log(`[winfsp] saved ${DEST}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

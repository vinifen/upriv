/**
 * After electron-builder writes the AppImage, wrap it so opening the file
 * does not require system libfuse2. The .deb artifact is left unchanged.
 */
const { wrapAppImageArtifacts } = require("../dist/portableAppImage.js");

exports.default = async function wrapPortableAppImages(buildResult) {
  wrapAppImageArtifacts(buildResult.artifactPaths ?? []);
  return [];
};

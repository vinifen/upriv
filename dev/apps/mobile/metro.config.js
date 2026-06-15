const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const appsRoot = path.resolve(projectRoot, "..");
const docsRoot = path.resolve(appsRoot, "../docs");

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(projectRoot);

// Watch shared packages and the i18n catalog (`dev/docs/i18n`) for HMR when strings change.
config.watchFolders = [appsRoot, docsRoot];
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, "node_modules")];

module.exports = config;

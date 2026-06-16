const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const appsRoot = path.resolve(projectRoot, "..");
const sharedRoot = path.resolve(appsRoot, "shared");

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(projectRoot);

// Watch shared package (including `locales/`) for HMR when strings change.
config.watchFolders = [sharedRoot];
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, "node_modules")];

module.exports = config;

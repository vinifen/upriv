const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const appsRoot = path.resolve(projectRoot, "..");
const sharedRoot = path.resolve(appsRoot, "shared");

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(projectRoot);

config.watchFolders = [sharedRoot];
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, "node_modules")];
config.resolver.unstable_enablePackageExports = true;
config.resolver.extraNodeModules = {
  "@upriv/shared": sharedRoot,
};

module.exports = config;

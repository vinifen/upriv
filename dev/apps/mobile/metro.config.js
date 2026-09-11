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
  // Never resolve `react` from `shared/node_modules` (duplicate = invalid hook call).
  react: path.resolve(projectRoot, "node_modules/react"),
  "react-native": path.resolve(projectRoot, "node_modules/react-native"),
  "@upriv/shared/react": path.join(sharedRoot, "src/react"),
  "@upriv/shared/testing": path.join(sharedRoot, "src/testing"),
  "@upriv/shared": sharedRoot,
};

const sharedNodeModules = path.join(sharedRoot, "node_modules");
const blockSharedNodeModules = new RegExp(
  `^${sharedNodeModules.replace(/[/\\]/g, "[/\\\\]")}[/\\\\].*`,
);
const existingBlockList = config.resolver.blockList;
config.resolver.blockList = existingBlockList
  ? [existingBlockList, blockSharedNodeModules].flat()
  : blockSharedNodeModules;

module.exports = config;

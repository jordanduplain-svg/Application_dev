const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
const path = require("path");

// Monorepo root (2 niveaux au-dessus de apps/mobile)
const monorepoRoot = path.resolve(__dirname, "../..");

const config = getDefaultConfig(__dirname);

// Permettre à Metro de résoudre les packages depuis le root du monorepo (pnpm)
config.watchFolders = [monorepoRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];

module.exports = withNativeWind(config, { input: "./app/global.css" });

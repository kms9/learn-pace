const fs = require("node:fs");
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
const workspaceRoot = path.resolve(__dirname, "../..");
config.watchFolders = [...new Set([...config.watchFolders, workspaceRoot])];

const workspacePackages = path.join(workspaceRoot, "packages") + path.sep;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Workspace TypeScript uses Node ESM specifiers and Metro runs it directly from source.
  if (context.originModulePath.startsWith(workspacePackages) &&
      !context.originModulePath.includes("/node_modules/") &&
      /^\.\.?\//.test(moduleName) && moduleName.endsWith(".js") &&
      fs.existsSync(path.resolve(path.dirname(context.originModulePath), moduleName.replace(/\.js$/, ".ts")))) {
    return context.resolveRequest(context, moduleName.slice(0, -3), platform);
  }
  // Resolve pnpm peer variants of Expo modules against one Expo runtime.
  if (moduleName === "expo" || moduleName.startsWith("expo/")) {
    return context.resolveRequest(
      { ...context, originModulePath: path.join(__dirname, "package.json") },
      moduleName,
      platform,
    );
  }
  // Metro export resolution can bypass the legacy per-file browser map.
  const piPackage = /^(.*\/node_modules\/@earendil-works\/[^/]+)\//.exec(context.originModulePath);
  if (piPackage && moduleName.startsWith(".") && (platform === "android" || platform === "ios")) {
    const root = piPackage[1];
    const key = "./" + path.relative(root, path.resolve(path.dirname(context.originModulePath), moduleName));
    const target = require(path.join(root, "package.json")).browser?.[key];
    if (typeof target === "string") return { type: "sourceFile", filePath: path.join(root, target) };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;

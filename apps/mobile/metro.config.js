// Metro config for a pnpm monorepo. The generic "Expo monorepo" advice
// (disableHierarchicalLookup + an explicit nodeModulesPaths list) is aimed
// at npm/yarn's flat-hoisted node_modules and turned out to be actively
// wrong here: pnpm resolves a package's own dependencies from ITS OWN
// nested node_modules inside the .pnpm virtual store via symlinks, and
// disableHierarchicalLookup stops Metro from walking into exactly that
// nested structure. That produced a string of "Unable to resolve module
// X" errors (invariant, nullthrows, memoize-one, flow-enums-runtime...)
// for packages that were never actually missing -- react-native's own
// package.json genuinely declares every one of them, confirmed by reading
// it directly. The real fix is `unstable_enableSymlinks`, which tells
// Metro to follow the symlinks pnpm's structure is built on, rather than
// blocking the lookup that would have found them anyway.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
config.resolver.unstable_enableSymlinks = true;
config.resolver.disableHierarchicalLookup = true;

module.exports = config;

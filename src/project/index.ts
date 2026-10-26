import path from 'node:path';
import type { ProjectContext } from '../types.js';
import { detectPackageManager, detectReactNativeVersion } from './detect.js';
import { declaredDeps, readInstalledVersions } from './lockfile.js';
import { ProjectError, readPackageJson } from './packageJson.js';
import { findWorkspace } from './workspace.js';

export { detectPackageManager, detectReactNativeVersion } from './detect.js';
export { declaredDeps, parseNpmLock, parsePnpmLock, parseYarnLock, readInstalledVersions } from './lockfile.js';
export { findWorkspace, type Workspace } from './workspace.js';
export { ProjectError, readPackageJson } from './packageJson.js';
export type { ReactNativeVersion } from './detect.js';
export type { PackageJson } from './packageJson.js';

/** Read the project at `cwd` and collect what the checks need. Throws ProjectError if it is not a React Native app. */
export async function buildProjectContext(cwd: string): Promise<ProjectContext> {
  const root = path.resolve(cwd);
  const pkg = await readPackageJson(root);

  const reactNative = detectReactNativeVersion(pkg);
  if (!reactNative) {
    throw new ProjectError(
      `${root} does not look like a React Native app: "react-native" is not in dependencies or devDependencies.`,
      'not-react-native',
    );
  }

  const workspace = await findWorkspace(root);
  const packageManager = await detectPackageManager(workspace.root, pkg, workspace.rootPkg);
  const { installed, file: lockfile } = await readInstalledVersions(workspace.root, packageManager, pkg, workspace.member);
  const lockedVersion = installed['react-native'];

  return {
    cwd: root,
    reactNativeVersion: lockedVersion ?? reactNative.version,
    reactNativeVersionSource: lockedVersion ? 'lockfile' : 'package.json',
    reactNativeRange: reactNative.range,
    packageManager,
    workspaceRoot: workspace.root === root ? undefined : workspace.root,
    lockfile,
    installed,
    declared: declaredDeps(pkg),
    devOnly: Object.keys(pkg.devDependencies ?? {}).filter((name) => !pkg.dependencies?.[name]),
  };
}

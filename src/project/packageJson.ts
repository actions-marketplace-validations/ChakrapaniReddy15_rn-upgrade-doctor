import { readFile } from 'node:fs/promises';
import path from 'node:path';

/** The subset of package.json fields the scanner uses. */
export interface PackageJson {
  name?: string;
  version?: string;
  packageManager?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/**
 * A problem with the scanned project itself. The CLI maps it to exit code 2.
 * `reason` tells "there is no React Native project here" apart from "the project's files are broken": with --apk,
 * the first one falls back to an APK-only scan, the second one is still an error.
 */
export class ProjectError extends Error {
  override name = 'ProjectError';

  constructor(
    message: string,
    readonly reason: 'no-package-json' | 'not-react-native' | 'invalid' = 'invalid',
  ) {
    super(message);
  }
}

export async function readPackageJson(cwd: string): Promise<PackageJson> {
  const file = path.join(cwd, 'package.json');
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new ProjectError(
        `No package.json found in ${cwd}. Run the scan from your React Native project folder or pass --cwd.`,
        'no-package-json',
      );
    }
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new ProjectError(`Could not parse ${file}: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ProjectError(`${file} is not a JSON object.`);
  }
  return parsed as PackageJson;
}

/** Write the example APKs and AABs into their examples/ folders (git-ignored). Run: npx tsx scripts/make-example-apks.ts */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exampleApks } from './example-apks.js';

const examples = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'examples');
const apks = exampleApks();
for (const apk of apks) {
  await mkdir(path.join(examples, apk.folder), { recursive: true });
  await writeFile(path.join(examples, apk.folder, apk.file), apk.data);
}
const folders = [...new Set(apks.map((a) => a.folder))].map((f) => `examples/${f}`);
console.log(`Wrote ${apks.length} example APKs/AABs into ${folders.join(' and ')}`);

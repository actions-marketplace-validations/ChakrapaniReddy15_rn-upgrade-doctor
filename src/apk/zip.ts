import type { Readable } from 'node:stream';
import yauzl from 'yauzl';
import { programHeadersEnd } from './elf.js';

export interface ZipNativeLib {
  path: string;
  abi: string;
  name: string;
  /** Stored without compression. */
  stored: boolean;
  /** Offset of the file data inside the zip (from the local file header). */
  dataOffset: number;
  /** ELF header and program headers, or undefined if they could not be read. */
  elfPrefix?: Buffer;
}

/** APK: lib/<abi>/x.so. AAB: <module>/lib/<abi>/x.so (base/ or a feature module). */
const APK_LIB = /^lib\/([^/]+)\/([^/]+\.so)$/;
const AAB_LIB = /^[^/]+\/lib\/([^/]+)\/([^/]+\.so)$/;

// yauzl 3 has readLocalFileHeader; @types/yauzl 2.x does not describe it yet.
type ZipFile = yauzl.ZipFile & {
  readLocalFileHeader(
    entry: yauzl.Entry,
    options: { minimal: boolean },
    callback: (err: Error | null, header: { fileDataStart: number }) => void,
  ): void;
};

export async function readNativeLibs(file: string, kind: 'apk' | 'aab'): Promise<ZipNativeLib[]> {
  const zip = (await new Promise<yauzl.ZipFile>((resolve, reject) =>
    yauzl.open(file, { lazyEntries: true, autoClose: false }, (err, z) => (err ? reject(err) : resolve(z))),
  )) as ZipFile;

  const pattern = kind === 'apk' ? APK_LIB : AAB_LIB;
  const libs: ZipNativeLib[] = [];
  try {
    for await (const entry of entries(zip)) {
      const match = pattern.exec(entry.fileName);
      if (!match) continue;
      const header = await new Promise<{ fileDataStart: number }>((resolve, reject) =>
        zip.readLocalFileHeader(entry, { minimal: true }, (err, h) => (err ? reject(err) : resolve(h))),
      );
      libs.push({
        path: entry.fileName,
        abi: match[1],
        name: match[2],
        stored: entry.compressionMethod === 0,
        dataOffset: header.fileDataStart,
        elfPrefix: await readElfPrefix(zip, entry).catch(() => undefined),
      });
    }
  } finally {
    zip.close();
  }
  return libs;
}

async function* entries(zip: yauzl.ZipFile): AsyncGenerator<yauzl.Entry> {
  while (true) {
    const entry = await new Promise<yauzl.Entry | undefined>((resolve, reject) => {
      const onEntry = (e: yauzl.Entry): void => {
        cleanup();
        resolve(e);
      };
      const onEnd = (): void => {
        cleanup();
        resolve(undefined);
      };
      const onError = (err: Error): void => {
        cleanup();
        reject(err);
      };
      const cleanup = (): void => {
        zip.off('entry', onEntry).off('end', onEnd).off('error', onError);
      };
      zip.on('entry', onEntry).on('end', onEnd).on('error', onError);
      zip.readEntry();
    });
    if (!entry) return;
    yield entry;
  }
}

/** Read only as many bytes as the ELF header says the program headers need, then stop the stream. */
async function readElfPrefix(zip: yauzl.ZipFile, entry: yauzl.Entry): Promise<Buffer | undefined> {
  const stream = await new Promise<Readable>((resolve, reject) =>
    zip.openReadStream(entry, (err, s) => (err ? reject(err) : resolve(s))),
  );
  const chunks: Buffer[] = [];
  let length = 0;
  let needed = 64;
  try {
    for await (const chunk of stream) {
      chunks.push(chunk as Buffer);
      length += (chunk as Buffer).length;
      if (length >= 64 && needed === 64) {
        const end = programHeadersEnd(Buffer.concat(chunks));
        if (end === undefined) return undefined;
        needed = Math.max(end, 64);
      }
      if (length >= needed) break;
    }
  } finally {
    stream.destroy();
  }
  const buf = Buffer.concat(chunks);
  return buf.length >= needed ? buf : undefined;
}

/** Largest entry readZipEntry will load into memory (manifests are a few KB; this only guards against bad input). */
const MAX_ENTRY_BYTES = 16 * 1024 * 1024;

/** The full contents of one zip entry, or undefined when the zip has no entry with that name. */
export async function readZipEntry(file: string, name: string): Promise<Buffer | undefined> {
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) =>
    yauzl.open(file, { lazyEntries: true, autoClose: false }, (err, z) => (err ? reject(err) : resolve(z))),
  );
  try {
    for await (const entry of entries(zip)) {
      if (entry.fileName !== name) continue;
      if (entry.uncompressedSize > MAX_ENTRY_BYTES) throw new Error(`${name} is larger than ${MAX_ENTRY_BYTES} bytes`);
      const stream = await new Promise<Readable>((resolve, reject) =>
        zip.openReadStream(entry, (err, s) => (err ? reject(err) : resolve(s))),
      );
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(chunk as Buffer);
      return Buffer.concat(chunks);
    }
    return undefined;
  } finally {
    zip.close();
  }
}

/** Names of all entries in the zip. */
export async function listZipEntries(file: string): Promise<string[]> {
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) =>
    yauzl.open(file, { lazyEntries: true, autoClose: false }, (err, z) => (err ? reject(err) : resolve(z))),
  );
  try {
    const names: string[] = [];
    for await (const entry of entries(zip)) names.push(entry.fileName);
    return names;
  } finally {
    zip.close();
  }
}

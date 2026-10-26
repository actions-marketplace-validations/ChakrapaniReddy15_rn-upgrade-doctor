import { X509Certificate } from 'node:crypto';
import { open } from 'node:fs/promises';
import type { ApkSigning, SigningCertificate, SigningScheme } from '../types.js';
import { listZipEntries, readZipEntry } from './zip.js';

/**
 * Signature schemes and debug-key detection for an APK (or the v1 signature of an AAB).
 * - v1 (JAR signing): META-INF/*.RSA, *.DSA or *.EC certificate files.
 * - v2 / v3 / v3.1: an APK Signing Block right before the zip central directory, ending with the magic
 *   "APK Sig Block 42" (https://source.android.com/docs/security/features/apksigning/v2).
 * The debug key is the one Android tooling creates automatically; its certificate subject is "CN=Android Debug".
 */

const V1_CERT = /^META-INF\/[^/]+\.(RSA|DSA|EC)$/i;
const BLOCK_MAGIC = Buffer.from('APK Sig Block 42', 'ascii');
const SCHEME_IDS: Record<number, SigningScheme> = {
  0x7109871a: 'v2',
  0xf05368c0: 'v3',
  0x1b93ad61: 'v3.1',
};
const EOCD_SIGNATURE = 0x06054b50;
const MAX_COMMENT = 0xffff;

/**
 * X.509 name attribute "CN = Android Debug": the commonName OID (2.5.4.3) followed by a UTF8String (0x0c) or
 * PrintableString (0x13) of length 13. Matching the encoded attribute, not just the text, avoids false positives.
 */
const DEBUG_CN = ['Android Debug'].flatMap((name) =>
  [0x0c, 0x13].map((tag) => Buffer.concat([Buffer.from([0x06, 0x03, 0x55, 0x04, 0x03, tag, name.length]), Buffer.from(name, 'ascii')])),
);

export async function readSigning(file: string): Promise<ApkSigning> {
  const schemes: SigningScheme[] = [];
  const certificates = new Map<string, SigningCertificate>();
  let debugBytes = false;

  const add = (der: Buffer, scheme: SigningScheme): void => {
    const cert = describeCertificate(der);
    if (!cert) return;
    const known = certificates.get(cert.sha256) ?? { ...cert, schemes: [] };
    if (!known.schemes.includes(scheme)) known.schemes.push(scheme);
    certificates.set(cert.sha256, known);
  };

  const certFiles = (await listZipEntries(file)).filter((name) => V1_CERT.test(name));
  if (certFiles.length > 0) schemes.push('v1');
  for (const name of certFiles) {
    const data = await readZipEntry(file, name);
    if (!data) continue;
    if (containsDebugCn(data)) debugBytes = true;
    for (const der of certificatesFromPkcs7(data)) add(der, 'v1');
  }

  for (const block of await readSigningBlock(file)) {
    const scheme = SCHEME_IDS[block.id];
    if (!scheme) continue; // padding, source stamp and other non-signature entries
    if (!schemes.includes(scheme)) schemes.push(scheme);
    if (containsDebugCn(block.value)) debugBytes = true;
    for (const der of certificatesFromSignerBlock(block.value)) add(der, scheme);
  }

  const list = [...certificates.values()];
  return {
    schemes,
    // The parsed subject decides; the byte match covers certificates Node cannot parse.
    debugSigned: list.some((c) => c.debug) || debugBytes,
    unsigned: schemes.length === 0,
    certificates: list,
  };
}

/** Subject, fingerprint and validity of a DER certificate, or undefined when it cannot be parsed. */
export function describeCertificate(der: Buffer): Omit<SigningCertificate, 'schemes'> | undefined {
  try {
    const cert = new X509Certificate(der);
    const names = cert.subject.split('\n');
    return {
      subject: [...names].reverse().join(', '),
      sha256: cert.fingerprint256,
      validFrom: new Date(cert.validFrom).toISOString(),
      validTo: new Date(cert.validTo).toISOString(),
      debug: names.includes('CN=Android Debug'),
    };
  } catch {
    return undefined;
  }
}

/** DER tag-length-value at `at`: tag, where the content starts and where the element ends. */
function tlv(buf: Buffer, at: number): { tag: number; start: number; end: number } | undefined {
  if (at + 2 > buf.length) return undefined;
  let length = buf[at + 1];
  let start = at + 2;
  if (length & 0x80) {
    const bytes = length & 0x7f;
    if (bytes === 0 || bytes > 4 || start + bytes > buf.length) return undefined;
    length = 0;
    for (let i = 0; i < bytes; i++) length = length * 256 + buf[start + i];
    start += bytes;
  }
  return start + length > buf.length ? undefined : { tag: buf[at], start, end: start + length };
}

function children(buf: Buffer, start: number, end: number): Array<{ tag: number; at: number; start: number; end: number }> {
  const list: Array<{ tag: number; at: number; start: number; end: number }> = [];
  for (let at = start; at < end; ) {
    const node = tlv(buf, at);
    if (!node || node.end > end) break;
    list.push({ ...node, at });
    at = node.end;
  }
  return list;
}

/**
 * Certificates of a v1 signature file: PKCS#7 ContentInfo { signedData OID, [0] SignedData { version,
 * digestAlgorithms, encapContentInfo, [0] IMPLICIT certificates, ... } } (RFC 2315 / RFC 5652).
 */
export function certificatesFromPkcs7(data: Buffer): Buffer[] {
  const contentInfo = tlv(data, 0);
  if (!contentInfo || contentInfo.tag !== 0x30) return [];
  const explicit = children(data, contentInfo.start, contentInfo.end).find((c) => c.tag === 0xa0);
  const signedData = explicit && tlv(data, explicit.start);
  if (!signedData || signedData.tag !== 0x30) return [];
  const certs = children(data, signedData.start, signedData.end).find((c) => c.tag === 0xa0);
  if (!certs) return [];
  return children(data, certs.start, certs.end)
    .filter((c) => c.tag === 0x30)
    .map((c) => data.subarray(c.at, c.end));
}

/**
 * Certificates of a v2/v3 signature: length-prefixed signers, each starting with length-prefixed signed data
 * whose first two fields are the digests and the certificates (uint32 little-endian lengths throughout).
 */
export function certificatesFromSignerBlock(value: Buffer): Buffer[] {
  const certs: Buffer[] = [];
  const prefixed = (buf: Buffer, at: number): Buffer | undefined => {
    if (at + 4 > buf.length) return undefined;
    const length = buf.readUInt32LE(at);
    return at + 4 + length > buf.length ? undefined : buf.subarray(at + 4, at + 4 + length);
  };
  const signers = prefixed(value, 0);
  for (let at = 0; signers && at + 4 <= signers.length; ) {
    const signer = prefixed(signers, at);
    if (!signer) break;
    at += 4 + signer.length;
    const signedData = prefixed(signer, 0);
    const digests = signedData && prefixed(signedData, 0);
    const list = signedData && digests && prefixed(signedData, 4 + digests.length);
    for (let c = 0; list && c + 4 <= list.length; ) {
      const cert = prefixed(list, c);
      if (!cert) break;
      certs.push(cert);
      c += 4 + cert.length;
    }
  }
  return certs;
}

export function containsDebugCn(data: Buffer): boolean {
  return DEBUG_CN.some((pattern) => data.includes(pattern));
}

export interface SigningBlockEntry {
  id: number;
  value: Buffer;
}

/** ID-value pairs of the APK Signing Block, or [] when the file has none (v1-only, unsigned, or an AAB). */
export async function readSigningBlock(file: string): Promise<SigningBlockEntry[]> {
  const handle = await open(file, 'r');
  try {
    const { size } = await handle.stat();
    const centralDirectory = await findCentralDirectory(handle, size);
    if (centralDirectory === undefined || centralDirectory < 32) return [];

    // The block ends with: uint64 size of block, then the 16-byte magic, immediately before the central directory.
    const footer = await read(handle, centralDirectory - 24, 24);
    if (!footer.subarray(8).equals(BLOCK_MAGIC)) return [];
    const blockSize = Number(footer.readBigUInt64LE(0));
    const start = centralDirectory - blockSize - 8;
    if (blockSize < 24 || start < 0) return [];

    const block = await read(handle, start, blockSize + 8);
    if (Number(block.readBigUInt64LE(0)) !== blockSize) return [];

    const entries: SigningBlockEntry[] = [];
    // Pairs sit between the leading size field and the trailing size + magic.
    for (let at = 8; at + 12 <= block.length - 24; ) {
      const length = Number(block.readBigUInt64LE(at));
      if (length < 4 || at + 8 + length > block.length - 24) break;
      entries.push({ id: block.readUInt32LE(at + 8), value: block.subarray(at + 12, at + 8 + length) });
      at += 8 + length;
    }
    return entries;
  } finally {
    await handle.close();
  }
}

/** Offset of the central directory, from the end-of-central-directory record (ZIP64 archives are not supported). */
async function findCentralDirectory(handle: Awaited<ReturnType<typeof open>>, size: number): Promise<number | undefined> {
  const tailSize = Math.min(size, 22 + MAX_COMMENT);
  const tail = await read(handle, size - tailSize, tailSize);
  for (let at = tail.length - 22; at >= 0; at--) {
    if (tail.readUInt32LE(at) !== EOCD_SIGNATURE) continue;
    // The comment length must reach exactly to the end of the file, so a signature inside a comment is not taken.
    if (at + 22 + tail.readUInt16LE(at + 20) !== tail.length) continue;
    const offset = tail.readUInt32LE(at + 16);
    return offset === 0xffffffff ? undefined : offset;
  }
  return undefined;
}

async function read(handle: Awaited<ReturnType<typeof open>>, position: number, length: number): Promise<Buffer> {
  const buf = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buf, 0, length, position);
  return buf.subarray(0, bytesRead);
}

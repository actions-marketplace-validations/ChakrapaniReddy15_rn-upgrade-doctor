import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  certificatesFromPkcs7,
  certificatesFromSignerBlock,
  containsDebugCn,
  describeCertificate,
  readSigning,
  readSigningBlock,
  scanApk,
} from '../src/apk/index.js';
import { DEBUG_CERT, EXPIRED_CERT, RELEASE_CERT, SHORT_CERT, der } from './certs.js';
import { derCommonName, makeZip, pkcs7, signerBlockValue, tempDir, writeTree } from './helpers.js';

const V2 = 0x7109871a;
const V3 = 0xf05368c0;
const V31 = 0x1b93ad61;
const PADDING = 0x42726577;

const files = [{ name: 'AndroidManifest.xml', data: Buffer.from('manifest') }, { name: 'classes.dex', data: Buffer.from('dex') }];
const release = der(RELEASE_CERT);
const debug = der(DEBUG_CERT);

let dir: string;
let cleanup: () => Promise<void>;

beforeEach(async () => {
  ({ dir, cleanup } = await tempDir('signing'));
});

afterEach(() => cleanup());

async function signing(zip: Buffer) {
  await writeTree(dir, { 'app.apk': zip });
  return readSigning(path.join(dir, 'app.apk'));
}

describe('readSigning', () => {
  it('finds v2 and v3 in the APK Signing Block, ignores padding, and lists the certificate once', async () => {
    const zip = makeZip(files, {
      signingBlock: [
        { id: V2, value: signerBlockValue([release]) },
        { id: V3, value: signerBlockValue([release]) },
        { id: PADDING, value: Buffer.alloc(32) },
      ],
    });
    const result = await signing(zip);
    expect(result).toMatchObject({ schemes: ['v2', 'v3'], debugSigned: false, unsigned: false });
    expect(result.certificates).toEqual([
      {
        subject: 'CN=Demo Release, O=Demo, C=US',
        sha256: describeCertificate(release)!.sha256,
        validFrom: '2026-01-01T05:31:16.000Z',
        validTo: '2060-12-23T05:31:16.000Z',
        debug: false,
        schemes: ['v2', 'v3'],
      },
    ]);
  });

  it('flags the debug key from the certificate subject', async () => {
    const result = await signing(makeZip(files, { signingBlock: [{ id: V31, value: signerBlockValue([debug]) }] }));
    expect(result).toMatchObject({ schemes: ['v3.1'], debugSigned: true });
    expect(result.certificates[0]).toMatchObject({ subject: 'CN=Android Debug, O=Android, C=US', debug: true });
  });

  it('reads v1 certificates from the PKCS#7 signature file', async () => {
    const zip = makeZip([...files, { name: 'META-INF/MANIFEST.MF', data: Buffer.from('Manifest-Version: 1.0') }, { name: 'META-INF/CERT.RSA', data: pkcs7([debug]) }]);
    const result = await signing(zip);
    expect(result).toMatchObject({ schemes: ['v1'], debugSigned: true, unsigned: false });
    expect(result.certificates.map((c) => [c.subject, c.schemes])).toEqual([['CN=Android Debug, O=Android, C=US', ['v1']]]);
  });

  it('combines v1 with v2/v3 and keeps the order of appearance', async () => {
    const zip = makeZip([...files, { name: 'META-INF/DEMO.EC', data: pkcs7([release]) }], {
      signingBlock: [{ id: V3, value: signerBlockValue([release]) }, { id: V2, value: signerBlockValue([release]) }],
    });
    const result = await signing(zip);
    expect(result.schemes).toEqual(['v1', 'v3', 'v2']);
    expect(result.certificates).toHaveLength(1);
    expect(result.certificates[0].schemes).toEqual(['v1', 'v3', 'v2']);
  });

  it('reports an unsigned APK, also when the zip has a comment', async () => {
    expect(await signing(makeZip(files))).toEqual({ schemes: [], debugSigned: false, unsigned: true, certificates: [] });
    expect(await signing(makeZip(files, { comment: 'built by a test' }))).toMatchObject({ unsigned: true });
  });

  it('finds the block when the zip has a comment that looks like a zip record', async () => {
    const zip = makeZip(files, { signingBlock: [{ id: V2, value: signerBlockValue([release]) }], comment: 'PK\u0005\u0006 inside a comment' });
    await writeTree(dir, { 'app.apk': zip });
    expect((await readSigningBlock(path.join(dir, 'app.apk'))).map((e) => e.id)).toEqual([V2]);
  });

  it('still detects the debug key by its encoded name when the certificate cannot be parsed', async () => {
    const broken = Buffer.concat([Buffer.from([0x30, 0x82]), derCommonName('Android Debug'), Buffer.from([0x31, 0x0b])]);
    const result = await signing(makeZip(files, { signingBlock: [{ id: V2, value: signerBlockValue([broken]) }] }));
    expect(result).toMatchObject({ schemes: ['v2'], debugSigned: true, certificates: [] });
  });

  it('is attached to the APK scan', async () => {
    await writeTree(dir, { 'app.apk': makeZip(files, { signingBlock: [{ id: V2, value: signerBlockValue([debug]) }] }) });
    expect((await scanApk(path.join(dir, 'app.apk'), [])).signing).toMatchObject({ schemes: ['v2'], debugSigned: true });
  });
});

describe('certificates', () => {
  it('describes subject, fingerprint and validity', () => {
    expect(describeCertificate(der(EXPIRED_CERT))).toMatchObject({
      subject: 'CN=Demo Expired, O=Demo, C=US',
      validFrom: '2000-01-01T05:31:16.000Z',
      validTo: '2000-12-31T05:31:16.000Z',
      debug: false,
    });
    expect(describeCertificate(der(SHORT_CERT))?.validTo).toBe('2033-06-30T07:10:12.000Z');
    expect(describeCertificate(release)?.sha256).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    expect(describeCertificate(Buffer.from('not a certificate'))).toBeUndefined();
  });

  it('extracts certificates from PKCS#7 and signer blocks, and ignores malformed input', () => {
    expect(certificatesFromPkcs7(pkcs7([release, debug]))).toEqual([release, debug]);
    expect(certificatesFromSignerBlock(signerBlockValue([release, debug]))).toEqual([release, debug]);
    expect(certificatesFromPkcs7(Buffer.from([0x30, 0x05, 0x01]))).toEqual([]);
    expect(certificatesFromSignerBlock(Buffer.from([0xff, 0xff, 0xff, 0x7f]))).toEqual([]);
  });

  it('does not take the text "Android Debug" outside a certificate name as the debug key', () => {
    expect(containsDebugCn(Buffer.from('Built with Android Debug Bridge'))).toBe(false);
    expect(containsDebugCn(derCommonName('Android Debugger'))).toBe(false);
    expect(containsDebugCn(derCommonName('Android Debug', 0x13))).toBe(true);
    expect(describeCertificate(debug)?.debug).toBe(true);
  });
});

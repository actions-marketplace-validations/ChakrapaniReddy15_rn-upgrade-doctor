/**
 * Reader for Android binary XML (AXML), the format of AndroidManifest.xml inside an APK.
 * Layout from the Android resource format (frameworks/base/libs/androidfw/include/androidfw/ResourceTypes.h):
 * a RES_XML_TYPE chunk holding a string pool, an optional resource-ID map and a stream of XML tree nodes.
 */

const RES_STRING_POOL_TYPE = 0x0001;
const RES_XML_TYPE = 0x0003;
const RES_XML_START_ELEMENT_TYPE = 0x0102;
const RES_XML_END_ELEMENT_TYPE = 0x0103;
const RES_XML_RESOURCE_MAP_TYPE = 0x0180;
const UTF8_FLAG = 0x100;
const NO_INDEX = 0xffffffff;

const TYPE_REFERENCE = 0x01;
const TYPE_STRING = 0x03;
const TYPE_INT_DEC = 0x10;
const TYPE_INT_HEX = 0x11;
const TYPE_INT_BOOLEAN = 0x12;

export type AxmlValue =
  | { type: 'string'; value: string }
  | { type: 'int'; value: number }
  | { type: 'bool'; value: boolean }
  /** A resource reference such as @xml/network_security_config, as its resource ID. */
  | { type: 'ref'; value: number }
  | { type: 'other'; dataType: number; value: number };

export interface AxmlAttribute {
  /** Attribute name, e.g. "targetSdkVersion"; may be empty in stripped builds (then use resId). */
  name: string;
  /** Android framework resource ID of the attribute (e.g. 0x01010270), when the file maps it. */
  resId?: number;
  value: AxmlValue;
}

export interface AxmlElement {
  name: string;
  attributes: AxmlAttribute[];
  children: AxmlElement[];
}

export class AxmlError extends Error {
  override name = 'AxmlError';
}

/** True when the buffer starts like a binary XML document (as opposed to plain-text XML). */
export function isAxml(buf: Buffer): boolean {
  return buf.length >= 8 && buf.readUInt16LE(0) === RES_XML_TYPE;
}

/** Parse binary XML into an element tree. Throws AxmlError for malformed input. */
export function parseAxml(buf: Buffer): AxmlElement {
  if (!isAxml(buf)) throw new AxmlError('not a binary XML document');
  const fileHeaderSize = buf.readUInt16LE(2);
  const fileSize = Math.min(buf.readUInt32LE(4), buf.length);

  let strings: string[] = [];
  let resourceIds: number[] = [];
  const roots: AxmlElement[] = [];
  const stack: AxmlElement[] = [];

  for (let at = fileHeaderSize; at + 8 <= fileSize; ) {
    const type = buf.readUInt16LE(at);
    const headerSize = buf.readUInt16LE(at + 2);
    const size = buf.readUInt32LE(at + 4);
    if (size < 8 || at + size > fileSize) throw new AxmlError(`bad chunk size at offset ${at}`);

    if (type === RES_STRING_POOL_TYPE) {
      strings = readStringPool(buf, at);
    } else if (type === RES_XML_RESOURCE_MAP_TYPE) {
      resourceIds = [];
      for (let p = at + headerSize; p + 4 <= at + size; p += 4) resourceIds.push(buf.readUInt32LE(p));
    } else if (type === RES_XML_START_ELEMENT_TYPE) {
      const element = readStartElement(buf, at + headerSize, at + size, strings, resourceIds);
      (stack.length > 0 ? stack[stack.length - 1].children : roots).push(element);
      stack.push(element);
    } else if (type === RES_XML_END_ELEMENT_TYPE) {
      stack.pop();
    }
    // Namespace and CDATA chunks carry nothing the manifest checks need.
    at += size;
  }

  if (roots.length === 0) throw new AxmlError('no root element');
  return roots[0];
}

function readStringPool(buf: Buffer, chunk: number): string[] {
  const stringCount = buf.readUInt32LE(chunk + 8);
  const flags = buf.readUInt32LE(chunk + 16);
  const stringsStart = buf.readUInt32LE(chunk + 20);
  const headerSize = buf.readUInt16LE(chunk + 2);
  const utf8 = (flags & UTF8_FLAG) !== 0;

  const strings: string[] = [];
  for (let i = 0; i < stringCount; i++) {
    const offset = buf.readUInt32LE(chunk + headerSize + i * 4);
    const at = chunk + stringsStart + offset;
    strings.push(utf8 ? readUtf8(buf, at) : readUtf16(buf, at));
  }
  return strings;
}

/** UTF-8 entries: character count, then byte count (each 1 or 2 bytes, high bit = 2 bytes), then the bytes. */
function readUtf8(buf: Buffer, at: number): string {
  let p = at;
  p += buf[p] & 0x80 ? 2 : 1; // character count, not needed
  let bytes = buf[p];
  if (bytes & 0x80) {
    bytes = ((bytes & 0x7f) << 8) | buf[p + 1];
    p += 2;
  } else {
    p += 1;
  }
  return buf.toString('utf8', p, p + bytes);
}

/** UTF-16 entries: character count (1 or 2 uint16, high bit = 2), then UTF-16LE characters. */
function readUtf16(buf: Buffer, at: number): string {
  let p = at;
  let chars = buf.readUInt16LE(p);
  if (chars & 0x8000) {
    chars = ((chars & 0x7fff) << 16) | buf.readUInt16LE(p + 2);
    p += 4;
  } else {
    p += 2;
  }
  return buf.toString('utf16le', p, p + chars * 2);
}

function readStartElement(buf: Buffer, ext: number, end: number, strings: string[], resourceIds: number[]): AxmlElement {
  const nameIndex = buf.readUInt32LE(ext + 4);
  const attributeStart = buf.readUInt16LE(ext + 8);
  const attributeSize = buf.readUInt16LE(ext + 10);
  const attributeCount = buf.readUInt16LE(ext + 12);

  const attributes: AxmlAttribute[] = [];
  for (let i = 0; i < attributeCount; i++) {
    const at = ext + attributeStart + i * attributeSize;
    if (at + 20 > end) throw new AxmlError('attribute outside its element');
    const attrName = buf.readUInt32LE(at + 4);
    const rawValue = buf.readUInt32LE(at + 8);
    const dataType = buf.readUInt8(at + 15);
    const data = buf.readUInt32LE(at + 16);
    attributes.push({
      name: strings[attrName] ?? '',
      ...(attrName < resourceIds.length && resourceIds[attrName] !== 0 ? { resId: resourceIds[attrName] } : {}),
      value: readValue(dataType, data, rawValue, strings),
    });
  }
  return { name: strings[nameIndex] ?? '', attributes, children: [] };
}

/** The typed value wins; the raw string (kept by some build tools next to it) is only a fallback. */
function readValue(dataType: number, data: number, rawValue: number, strings: string[]): AxmlValue {
  if (dataType === TYPE_STRING) return { type: 'string', value: strings[data] ?? '' };
  if (dataType === TYPE_INT_BOOLEAN) return { type: 'bool', value: data !== 0 };
  if (dataType === TYPE_INT_DEC || dataType === TYPE_INT_HEX) return { type: 'int', value: data | 0 };
  if (dataType === TYPE_REFERENCE) return { type: 'ref', value: data };
  if (rawValue !== NO_INDEX && strings[rawValue] !== undefined) return { type: 'string', value: strings[rawValue] };
  return { type: 'other', dataType, value: data };
}

/** Find an attribute by Android resource ID (reliable) or by name (fallback for files without a resource map). */
export function attribute(element: AxmlElement, name: string, resId?: number): AxmlValue | undefined {
  return (
    (resId !== undefined ? element.attributes.find((a) => a.resId === resId) : undefined) ??
    element.attributes.find((a) => a.name === name)
  )?.value;
}

export type NbtTag =
  | { type: 'byte'; value: number }
  | { type: 'short'; value: number }
  | { type: 'int'; value: number }
  | { type: 'long'; value: bigint | number | [number, number] }
  | { type: 'float'; value: number }
  | { type: 'double'; value: number }
  | { type: 'byteArray'; value: Buffer | number[] }
  | { type: 'string'; value: string }
  | { type: 'list'; value: { type: string; value: any[] } }
  | { type: 'compound'; value: Record<string, NbtTag> }
  | { type: 'intArray'; value: number[] }
  | { type: 'longArray'; value: (bigint | number)[] };

const TAG_TYPE_IDS: Record<string, number> = {
  end: 0,
  byte: 1,
  short: 2,
  int: 3,
  long: 4,
  float: 5,
  double: 6,
  byteArray: 7,
  string: 8,
  list: 9,
  compound: 10,
  intArray: 11,
  longArray: 12,
};

function writeTagPayload(tag: NbtTag): Buffer {
  switch (tag.type) {
    case 'byte': {
      const b = Buffer.alloc(1);
      b.writeInt8(tag.value);
      return b;
    }
    case 'short': {
      const b = Buffer.alloc(2);
      b.writeInt16BE(tag.value);
      return b;
    }
    case 'int': {
      const b = Buffer.alloc(4);
      b.writeInt32BE(tag.value);
      return b;
    }
    case 'long': {
      const b = Buffer.alloc(8);
      const val = Array.isArray(tag.value)
        ? (BigInt(tag.value[0]) << 32n) | BigInt(tag.value[1] >>> 0)
        : BigInt(tag.value);
      b.writeBigInt64BE(val);
      return b;
    }
    case 'float': {
      const b = Buffer.alloc(4);
      b.writeFloatBE(tag.value);
      return b;
    }
    case 'double': {
      const b = Buffer.alloc(8);
      b.writeDoubleBE(tag.value);
      return b;
    }
    case 'byteArray': {
      const raw = Buffer.isBuffer(tag.value)
        ? tag.value
        : Buffer.from(tag.value);
      const len = Buffer.alloc(4);
      len.writeInt32BE(raw.length);
      return Buffer.concat([len, raw]);
    }
    case 'string': {
      const strBuf = Buffer.from(tag.value, 'utf8');
      const lenBuf = Buffer.alloc(2);
      lenBuf.writeUInt16BE(strBuf.length);
      return Buffer.concat([lenBuf, strBuf]);
    }
    case 'list': {
      const listType = tag.value.type;
      const typeId = TAG_TYPE_IDS[listType] ?? 0;
      const typeByte = Buffer.from([typeId]);
      const len = Buffer.alloc(4);
      len.writeInt32BE(tag.value.value.length);
      const items = tag.value.value.map((val) =>
        writeTagPayload({ type: listType as any, value: val }),
      );
      return Buffer.concat([typeByte, len, ...items]);
    }
    case 'compound': {
      const parts: Buffer[] = [];
      for (const [key, child] of Object.entries(tag.value)) {
        const id = TAG_TYPE_IDS[child.type];
        if (id === undefined) continue;
        const keyBuf = Buffer.from(key, 'utf8');
        const keyLen = Buffer.alloc(2);
        keyLen.writeUInt16BE(keyBuf.length);
        parts.push(Buffer.from([id]), keyLen, keyBuf, writeTagPayload(child));
      }
      parts.push(Buffer.from([0])); // TAG_End
      return Buffer.concat(parts);
    }
    case 'intArray': {
      const arr = tag.value as number[];
      const len = Buffer.alloc(4);
      len.writeInt32BE(arr.length);
      const buf = Buffer.alloc(arr.length * 4);
      for (let i = 0; i < arr.length; i++) {
        buf.writeInt32BE(arr[i]!, i * 4);
      }
      return Buffer.concat([len, buf]);
    }
    case 'longArray': {
      const arr = tag.value as (bigint | number)[];
      const len = Buffer.alloc(4);
      len.writeInt32BE(arr.length);
      const buf = Buffer.alloc(arr.length * 8);
      for (let i = 0; i < arr.length; i++) {
        buf.writeBigInt64BE(BigInt(arr[i]!), i * 8);
      }
      return Buffer.concat([len, buf]);
    }
    default:
      return Buffer.alloc(0);
  }
}

/**
 * Serializes an NBT compound tag into binary format.
 */
export function writeNbt(tag: NbtTag, rootName: string = ''): Buffer {
  const rootId = Buffer.from([10]); // TAG_Compound
  const nameBuf = Buffer.from(rootName, 'utf8');
  const nameLen = Buffer.alloc(2);
  nameLen.writeUInt16BE(nameBuf.length);

  return Buffer.concat([rootId, nameLen, nameBuf, writeTagPayload(tag)]);
}

/**
 * Serializes an anonymous NBT tag into binary format without a root name (Network NBT format for 1.20.2+).
 */
export function writeAnonymousNbt(tag: NbtTag): Buffer {
  const typeId = TAG_TYPE_IDS[tag.type] ?? 10;
  if (typeId === 0) {
    return Buffer.from([0]);
  }
  return Buffer.concat([Buffer.from([typeId]), writeTagPayload(tag)]);
}

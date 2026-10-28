export interface ParsedField {
  name: string;
  desc: string;
  access: number;
  isPrivate: boolean;
  isPublic: boolean;
  isProtected: boolean;
  isStatic: boolean;
}

export interface ParsedMethod {
  name: string;
  desc: string;
  access: number;
  isPrivate: boolean;
  isPublic: boolean;
  isProtected: boolean;
  isStatic: boolean;
}

export interface ParsedJavaClass {
  thisClassName: string;
  superClassName: string;
  interfaces: string[];
  fields: ParsedField[];
  methods: ParsedMethod[];
}

/**
 * Lightweight, zero-dependency Java .class binary bytecode parser.
 * Reads constant pool, class hierarchy, fields, and methods with their descriptors and access flags.
 */
export function parseClassBytecode(
  bytes: Uint8Array | Buffer,
): ParsedJavaClass {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  let offset = 0;

  const readU1 = () => buf[offset++];
  const readU2 = () => {
    const v = buf.readUInt16BE(offset);
    offset += 2;
    return v;
  };
  const readU4 = () => {
    const v = buf.readUInt32BE(offset);
    offset += 4;
    return v;
  };

  const magic = readU4();
  if (magic !== 0xcafebabe) {
    throw new Error(
      `Invalid Java class file magic: 0x${magic.toString(16).toUpperCase()}`,
    );
  }

  // minor & major version
  readU2();
  readU2();

  const cpCount = readU2();
  const cp: any[] = new Array(cpCount);

  for (let i = 1; i < cpCount; i++) {
    const tag = readU1();
    if (tag === 1) {
      // CONSTANT_Utf8
      const len = readU2();
      cp[i] = { tag: 1, str: buf.toString('utf8', offset, offset + len) };
      offset += len;
    } else if (tag === 3 || tag === 4) {
      // CONSTANT_Integer, CONSTANT_Float
      offset += 4;
      cp[i] = { tag };
    } else if (tag === 5 || tag === 6) {
      // CONSTANT_Long, CONSTANT_Double
      offset += 8;
      cp[i] = { tag };
      i++; // Long & Double take 2 constant pool entries
    } else if (tag === 7) {
      // CONSTANT_Class
      cp[i] = { tag: 7, nameIdx: readU2() };
    } else if (tag === 8) {
      // CONSTANT_String
      cp[i] = { tag: 8, strIdx: readU2() };
    } else if (tag === 9 || tag === 10 || tag === 11) {
      // CONSTANT_Fieldref, Methodref, InterfaceMethodref
      cp[i] = { tag, classIdx: readU2(), ntIdx: readU2() };
    } else if (tag === 12) {
      // CONSTANT_NameAndType
      cp[i] = { tag: 12, nameIdx: readU2(), descIdx: readU2() };
    } else if (tag === 15) {
      // CONSTANT_MethodHandle
      offset += 3;
      cp[i] = { tag };
    } else if (tag === 16) {
      // CONSTANT_MethodType
      offset += 2;
      cp[i] = { tag };
    } else if (tag === 17 || tag === 18) {
      // CONSTANT_Dynamic, InvokeDynamic
      offset += 4;
      cp[i] = { tag };
    } else if (tag === 19 || tag === 20) {
      // CONSTANT_Module, Package
      offset += 2;
      cp[i] = { tag };
    } else {
      throw new Error(
        `Unsupported constant pool tag ${tag} at offset ${offset - 1}`,
      );
    }
  }

  // Class access flags
  readU2();

  const thisClassIdx = readU2();
  const superClassIdx = readU2();
  const thisClassName = cp[cp[thisClassIdx]?.nameIdx]?.str ?? '';
  const superClassName = cp[cp[superClassIdx]?.nameIdx]?.str ?? '';

  const ifaceCount = readU2();
  const interfaces: string[] = [];
  for (let i = 0; i < ifaceCount; i++) {
    const idx = readU2();
    interfaces.push(cp[cp[idx]?.nameIdx]?.str ?? '');
  }

  // Fields
  const fCount = readU2();
  const fields: ParsedField[] = [];
  for (let i = 0; i < fCount; i++) {
    const acc = readU2();
    const name = cp[readU2()]?.str ?? '';
    const desc = cp[readU2()]?.str ?? '';
    const attrCount = readU2();
    for (let a = 0; a < attrCount; a++) {
      readU2(); // attr name
      const attrLen = readU4();
      offset += attrLen;
    }
    fields.push({
      name,
      desc,
      access: acc,
      isPrivate: (acc & 0x0002) !== 0,
      isPublic: (acc & 0x0001) !== 0,
      isProtected: (acc & 0x0004) !== 0,
      isStatic: (acc & 0x0008) !== 0,
    });
  }

  // Methods
  const mCount = readU2();
  const methods: ParsedMethod[] = [];
  for (let i = 0; i < mCount; i++) {
    const acc = readU2();
    const name = cp[readU2()]?.str ?? '';
    const desc = cp[readU2()]?.str ?? '';
    const attrCount = readU2();
    for (let a = 0; a < attrCount; a++) {
      readU2(); // attr name
      const attrLen = readU4();
      offset += attrLen;
    }
    methods.push({
      name,
      desc,
      access: acc,
      isPrivate: (acc & 0x0002) !== 0,
      isPublic: (acc & 0x0001) !== 0,
      isProtected: (acc & 0x0004) !== 0,
      isStatic: (acc & 0x0008) !== 0,
    });
  }

  return {
    thisClassName,
    superClassName,
    interfaces,
    fields,
    methods,
  };
}

import { createHash } from 'node:crypto';

export function generateOfflineUuid(username: string): string {
  const hash = createHash('md5').update(`OfflinePlayer:${username}`).digest();
  hash[6] = (hash[6]! & 0x0f) | 0x30;
  hash[8] = (hash[8]! & 0x3f) | 0x80;
  const hex = hash.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export class PacketBuffer {
  private buffer: Buffer;
  private offset: number;

  constructor(buffer?: Buffer) {
    this.buffer = buffer ? Buffer.from(buffer) : Buffer.alloc(128);
    this.offset = 0;
  }

  private ensureCapacity(additionalBytes: number): void {
    if (this.offset + additionalBytes > this.buffer.length) {
      const newLength = Math.max(
        this.buffer.length * 2,
        this.offset + additionalBytes,
      );
      const newBuf = Buffer.allocUnsafe(newLength);
      this.buffer.copy(newBuf, 0, 0, this.offset);
      this.buffer = newBuf;
    }
  }

  public getOffset(): number {
    return this.offset;
  }

  public setOffset(offset: number): this {
    this.offset = offset;
    return this;
  }

  public remaining(): number {
    return Math.max(0, this.buffer.length - this.offset);
  }

  public toBuffer(): Buffer {
    return this.buffer.subarray(0, this.offset);
  }

  public getRawBuffer(): Buffer {
    return this.buffer;
  }

  // --- VarInt & VarLong ---

  public writeVarInt(value: number): this {
    let v = value >>> 0;
    while (true) {
      if ((v & ~0x7f) === 0) {
        this.writeUByte(v);
        return this;
      }
      this.writeUByte((v & 0x7f) | 0x80);
      v >>>= 7;
    }
  }

  public readVarInt(): number {
    let value = 0;
    let shift = 0;
    while (true) {
      if (this.offset >= this.buffer.length) {
        throw new Error('Unexpected end of buffer reading VarInt');
      }
      const byte = this.readUByte();
      value |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) break;
      shift += 7;
      if (shift >= 35) {
        throw new Error('VarInt is too big (> 5 bytes)');
      }
    }
    return value | 0;
  }

  public static readVarIntFromBuffer(
    buf: Buffer,
    offset: number = 0,
  ): { value: number; size: number } | null {
    let value = 0;
    let shift = 0;
    let bytesRead = 0;

    while (true) {
      if (offset + bytesRead >= buf.length) {
        return null; // Incomplete VarInt
      }
      const byte = buf.readUInt8(offset + bytesRead);
      bytesRead++;
      value |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) break;
      shift += 7;
      if (shift >= 35) {
        throw new Error('VarInt is too big (> 5 bytes)');
      }
    }

    return { value: value | 0, size: bytesRead };
  }

  public writeVarLong(value: bigint | number): this {
    let v = BigInt(value);
    // treat as 64-bit unsigned
    v = BigInt.asUintN(64, v);
    while (true) {
      if ((v & ~0x7fn) === 0n) {
        this.writeUByte(Number(v));
        return this;
      }
      this.writeUByte(Number((v & 0x7fn) | 0x80n));
      v >>= 7n;
    }
  }

  public readVarLong(): bigint {
    let value = 0n;
    let shift = 0n;
    while (true) {
      if (this.offset >= this.buffer.length) {
        throw new Error('Unexpected end of buffer reading VarLong');
      }
      const byte = BigInt(this.readUByte());
      value |= (byte & 0x7fn) << shift;
      if ((byte & 0x80n) === 0n) break;
      shift += 7n;
      if (shift >= 70n) {
        throw new Error('VarLong is too big (> 10 bytes)');
      }
    }
    return BigInt.asIntN(64, value);
  }

  // --- Primitives ---

  public writeByte(value: number): this {
    this.ensureCapacity(1);
    this.buffer.writeInt8(value, this.offset);
    this.offset += 1;
    return this;
  }

  public readByte(): number {
    const val = this.buffer.readInt8(this.offset);
    this.offset += 1;
    return val;
  }

  public writeUByte(value: number): this {
    this.ensureCapacity(1);
    this.buffer.writeUInt8(value, this.offset);
    this.offset += 1;
    return this;
  }

  public readUByte(): number {
    const val = this.buffer.readUInt8(this.offset);
    this.offset += 1;
    return val;
  }

  public writeBoolean(value: boolean): this {
    return this.writeUByte(value ? 1 : 0);
  }

  public readBoolean(): boolean {
    return this.readUByte() !== 0;
  }

  public writeShort(value: number): this {
    this.ensureCapacity(2);
    this.buffer.writeInt16BE(value, this.offset);
    this.offset += 2;
    return this;
  }

  public readShort(): number {
    const val = this.buffer.readInt16BE(this.offset);
    this.offset += 2;
    return val;
  }

  public writeUShort(value: number): this {
    this.ensureCapacity(2);
    this.buffer.writeUInt16BE(value, this.offset);
    this.offset += 2;
    return this;
  }

  public readUShort(): number {
    const val = this.buffer.readUInt16BE(this.offset);
    this.offset += 2;
    return val;
  }

  public writeInt(value: number): this {
    this.ensureCapacity(4);
    this.buffer.writeInt32BE(value, this.offset);
    this.offset += 4;
    return this;
  }

  public readInt(): number {
    const val = this.buffer.readInt32BE(this.offset);
    this.offset += 4;
    return val;
  }

  public writeLong(value: bigint | number): this {
    this.ensureCapacity(8);
    this.buffer.writeBigInt64BE(BigInt(value), this.offset);
    this.offset += 8;
    return this;
  }

  public readLong(): bigint {
    const val = this.buffer.readBigInt64BE(this.offset);
    this.offset += 8;
    return val;
  }

  public writeFloat(value: number): this {
    this.ensureCapacity(4);
    this.buffer.writeFloatBE(value, this.offset);
    this.offset += 4;
    return this;
  }

  public readFloat(): number {
    const val = this.buffer.readFloatBE(this.offset);
    this.offset += 4;
    return val;
  }

  public writeDouble(value: number): this {
    this.ensureCapacity(8);
    this.buffer.writeDoubleBE(value, this.offset);
    this.offset += 8;
    return this;
  }

  public readDouble(): number {
    const val = this.buffer.readDoubleBE(this.offset);
    this.offset += 8;
    return val;
  }

  // --- Strings & Buffers ---

  public writeString(value: string): this {
    const bytes = Buffer.from(value, 'utf8');
    this.writeVarInt(bytes.length);
    this.writeBuffer(bytes);
    return this;
  }

  public readString(maxLength: number = 32767): string {
    const length = this.readVarInt();
    if (length < 0 || length > maxLength * 4) {
      throw new Error(
        `String length ${length} exceeds allowed maximum ${maxLength}`,
      );
    }
    const bytes = this.readBuffer(length);
    return bytes.toString('utf8');
  }

  public writeBuffer(buf: Buffer): this {
    this.ensureCapacity(buf.length);
    buf.copy(this.buffer, this.offset);
    this.offset += buf.length;
    return this;
  }

  public readBuffer(length: number): Buffer {
    if (this.offset + length > this.buffer.length) {
      throw new Error(
        `Cannot read ${length} bytes, only ${this.buffer.length - this.offset} available`,
      );
    }
    const slice = this.buffer.subarray(this.offset, this.offset + length);
    this.offset += length;
    return Buffer.from(slice);
  }

  public writeByteArray(buf: Buffer): this {
    this.writeVarInt(buf.length);
    this.writeBuffer(buf);
    return this;
  }

  public readByteArray(): Buffer {
    const length = this.readVarInt();
    return this.readBuffer(length);
  }

  // --- UUID ---

  public writeUUID(uuid: string): this {
    const clean = uuid.replace(/-/g, '');
    if (clean.length !== 32) {
      // zero UUID if invalid format
      this.writeBuffer(Buffer.alloc(16));
    } else {
      this.writeBuffer(Buffer.from(clean, 'hex'));
    }
    return this;
  }

  public readUUID(): string {
    const bytes = this.readBuffer(16);
    const hex = bytes.toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  // --- Positions ---

  public writePosition18(x: number, y: number, z: number): this {
    const xBig = BigInt(Math.floor(x)) & 0x3ffffffn;
    const yBig = BigInt(Math.floor(y)) & 0xfffn;
    const zBig = BigInt(Math.floor(z)) & 0x3ffffffn;
    const packed = (xBig << 38n) | (yBig << 26n) | zBig;
    return this.writeLong(packed);
  }

  public writePositionModern(x: number, y: number, z: number): this {
    const xBig = BigInt(Math.floor(x)) & 0x3ffffffn;
    const zBig = BigInt(Math.floor(z)) & 0x3ffffffn;
    const yBig = BigInt(Math.floor(y)) & 0xfffn;
    const packed = (xBig << 38n) | (zBig << 12n) | yBig;
    return this.writeLong(packed);
  }

  // --- Packet Framing Helper ---

  public static framePacket(packetId: number, payload: Buffer): Buffer {
    const idBuf = new PacketBuffer();
    idBuf.writeVarInt(packetId);
    const idBytes = idBuf.toBuffer();

    const totalLength = idBytes.length + payload.length;
    const lenBuf = new PacketBuffer();
    lenBuf.writeVarInt(totalLength);

    return Buffer.concat([lenBuf.toBuffer(), idBytes, payload]);
  }
}

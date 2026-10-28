import { encodeDword, X64Encoder } from '../encoding.js';
import { REGISTER_INFO, type X64Register64 } from '../registers.js';

export function emitPush(
  encoder: X64Encoder,
  value: X64Register64 | number,
): void {
  if (typeof value === 'number') {
    if (value >= -128 && value <= 127) {
      encoder.write(0x6a, value & 0xff);
    } else {
      encoder.write(0x68, ...encodeDword(value));
    }
    return;
  }
  const register = REGISTER_INFO[value];
  encoder.emitRex(false, undefined, register.code);
  encoder.write(0x50 + (register.code & 7));
}

export function emitPop(encoder: X64Encoder, destination: X64Register64): void {
  const register = REGISTER_INFO[destination];
  encoder.emitRex(false, undefined, register.code);
  encoder.write(0x58 + (register.code & 7));
}

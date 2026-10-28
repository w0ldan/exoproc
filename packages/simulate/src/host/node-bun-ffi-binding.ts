/**
 * Minimal host-side `bun:ffi` binding needed while Node loads Win32 ABI
 * manifests. Guest code receives the full process-bound binding from
 * `worker/bun-ffi-module.ts` instead.
 */
const FFI_TYPES = {
  char: 0,
  int8_t: 1,
  i8: 1,
  u8: 2,
  uint8_t: 2,
  i16: 3,
  int16_t: 3,
  u16: 4,
  uint16_t: 4,
  int: 5,
  i32: 5,
  int32_t: 5,
  u32: 6,
  uint32_t: 6,
  i64: 7,
  int64_t: 7,
  u64: 8,
  uint64_t: 8,
  double: 9,
  f64: 9,
  float: 10,
  f32: 10,
  bool: 11,
  ptr: 12,
  pointer: 12,
  void: 13,
  cstring: 14,
  function: 17,
  buffer: 20,
} as const;

export const FFIType = new Proxy(FFI_TYPES, {
  get(target, property, receiver) {
    if (typeof property === 'symbol' || Reflect.has(target, property)) {
      return Reflect.get(target, property, receiver);
    }
    throw new Error(
      `Host bun:ffi binding does not implement ${String(property)}`,
    );
  },
});

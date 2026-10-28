import { expect, test, describe } from 'bun:test';
import {
  cjitopen,
  SyncNativePointer,
  CType,
  localCallableMemoryAccessor,
} from '../../packages/xffi/src/index.js';
import { ptr as bunPtr } from 'bun:ffi';
import {
  MarshallingCallableAccessor,
  HostAccessor,
} from '../../packages/accessors/src/index.js';

describe('accessors > String Reading & Marshalling', () => {
  test('should read null-terminated UTF-8 (ANSI) strings from memory', () => {
    const text = 'Merhaba Dünya!';
    const buf = Buffer.from(text + '\0', 'utf8');
    const addr = Number(bunPtr(buf));

    const ptr = new SyncNativePointer(addr);
    expect(ptr.readStringSync()).toBe(text);
    expect(ptr.readStringSync({ size: 7 })).toBe('Merhaba'); // with size limit
  });

  test('should read null-terminated UTF-16LE (Wide) strings with Turkish characters', () => {
    const text = 'Şekerli Çay İçelim!';
    const encoded = Buffer.from(text, 'utf16le');
    const withNull = Buffer.alloc(encoded.length + 2);
    encoded.copy(withNull);
    const addr = Number(bunPtr(withNull));

    const ptr = new SyncNativePointer(addr);
    expect(ptr.readStringSync({ encoding: 'utf16le' })).toBe(text);
    expect(ptr.readStringSync({ encoding: 'utf16le', size: 7 })).toBe(
      'Şekerli',
    ); // with size limit
  });

  test('should handle null pointer gracefully in string reading', () => {
    const ptr = new SyncNativePointer(0);
    expect(ptr.readStringSync()).toBe('');
  });

  test('should automatically marshal string arguments using MarshallingCallableAccessor', async () => {
    const lib = cjitopen({
      get_length: {
        args: [CType.cstring],
        returns: CType.u64,
        source: `
          int len = 0;
          char* str = (char*)arg0;
          while (str[len] != '\\0') {
            len++;
          }
          return (unsigned long long)len;
        `,
      },
    });

    const get_length = lib.symbols.get_length;
    const host = new HostAccessor(localCallableMemoryAccessor);
    const marshallingAccessor = new MarshallingCallableAccessor(
      localCallableMemoryAccessor,
      host,
    );
    host.backend = marshallingAccessor;

    // Call using a standard JS string directly! Under the hood, MarshallingCallableAccessor
    // allocates remote memory, writes the string with null terminator, passes the pointer,
    // and then cleans up.
    const result = await marshallingAccessor.call(
      get_length,
      'Hello from Marshalling Middleware!',
    );
    expect(result).toBe(34n);

    lib.close();
  });
});

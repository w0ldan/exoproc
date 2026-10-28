import { expect, test, describe } from 'bun:test';
import { CType, createCFunction } from '../../packages/xffi/src/index.js';
import { ThrowingMemoryAccessor } from '../../packages/accessors/src/index.js';

describe('accessors > ThrowingMemoryAccessor Guard', () => {
  test('should throw an explicit error for every memory operation', async () => {
    const accessor = new ThrowingMemoryAccessor(-1);

    expect(accessor.processId).toBe(-1);
    expect(accessor.isLocal).toBe(false);

    // Assert operations throw errors
    expect(accessor.read(0, 10)).rejects.toThrow(
      "ThrowingMemoryAccessor: 'read' is not implemented or permitted.",
    );
    expect(accessor.write(0, new Uint8Array(1))).rejects.toThrow(
      "ThrowingMemoryAccessor: 'write' is not implemented or permitted.",
    );
    expect(accessor.alloc(10)).rejects.toThrow(
      "ThrowingMemoryAccessor: 'alloc' is not implemented or permitted.",
    );
    expect(accessor.free(0)).rejects.toThrow(
      "ThrowingMemoryAccessor: 'free' is not implemented or permitted.",
    );
    expect(accessor.protect(0, 10, 0x04)).rejects.toThrow(
      "ThrowingMemoryAccessor: 'protect' is not implemented or permitted.",
    );
    expect(accessor.query(0)).rejects.toThrow(
      "ThrowingMemoryAccessor: 'query' is not implemented or permitted.",
    );

    // Assert call throws error
    const dummyFunc = createCFunction(0x1000, [CType.void, []]);
    expect(accessor.call(dummyFunc)).rejects.toThrow(
      "ThrowingMemoryAccessor: 'call' is not implemented or permitted.",
    );

    // Assert scalar reads throw errors
    expect(accessor.readInt32(0)).rejects.toThrow(
      "ThrowingMemoryAccessor: 'readInt32' is not implemented or permitted.",
    );
    expect(accessor.readPointer(0)).rejects.toThrow(
      "ThrowingMemoryAccessor: 'readPointer' is not implemented or permitted.",
    );

    // Assert scalar writes throw errors
    expect(accessor.writeInt32(0, 42)).rejects.toThrow(
      "ThrowingMemoryAccessor: 'writeInt32' is not implemented or permitted.",
    );
  });
});

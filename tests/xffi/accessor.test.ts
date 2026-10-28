import { expect, test, describe } from 'bun:test';
import { ptr as bunPtr } from 'bun:ffi';
import {
  localMemoryAccessor,
  localCallableMemoryAccessor,
  AbstractSyncMemoryAccessor,
  AbstractMemoryAccessor,
  AbstractSyncCallableMemoryAccessor,
  AbstractCallableMemoryAccessor,
  RemoteProcessMemoryAccessor,
  resolveAddress,
  SyncStruct,
  Struct,
  struct,
  SyncNativePointer,
  NativePointer,
  cimport,
  CType,
  type AddressLike,
  type ISyncMemoryAccessor,
} from '../../packages/xffi/src/index';
import { getGlobalDummyProcess } from 'exoproc-dummy';
describe('xffi > MemoryAccessor and Custom Accessors', () => {
  test('should support allocating and freeing memory using localMemoryAccessor', () => {
    const addr = localMemoryAccessor.allocSync(16);
    expect(addr).toBeGreaterThan(0);

    // Write some data and read it back
    localMemoryAccessor.writeInt32Sync(addr, 123456);
    expect(localMemoryAccessor.readInt32Sync(addr)).toBe(123456);

    localMemoryAccessor.freeSync(addr);
  });

  test('should route remote process operations through a real process', async () => {
    if (process.platform !== 'win32') return;

    const tp = getGlobalDummyProcess();

    const remote = new RemoteProcessMemoryAccessor(tp.pid, {
      handle: tp.handle,
      closeHandle: false,
    });

    // Test Cross-Process Struct
    const PointStruct = struct({ x: 'i32', y: 'i32' });
    const remoteStruct = PointStruct.allocSync(remote, { x: 100, y: 200 });

    // Read back the memory from the remote process space
    expect(remoteStruct.x).toBe(100);
    expect(remoteStruct.y).toBe(200);

    // Verify cross-process write
    remoteStruct.x = 500;
    expect(remoteStruct.x).toBe(500);

    // Cleanup
    remote.freeSync(remoteStruct.address);
    remote.close();
  });

  test('should support protect and query (Windows only)', async () => {
    if (process.platform !== 'win32') return;

    // Drive protect/query against a *real* dedicated page in a remote process
    // rather than `localMemoryAccessor.allocSync(4096)`. A non-executable local
    // allocation with no fixed address returns CRT `malloc()`'d heap memory
    // (see LocalMemoryAccessor.allocSync in accessor.ts), and `malloc()`'d
    // pointers are not page-aligned. Calling VirtualProtect on one toggles the
    // protection of the entire heap *page* it happens to sit on -- a page
    // shared with adjacent CRT allocations and metadata -- to READONLY and back,
    // and then `free()`s it. That corrupts the local heap, and on GitHub
    // Actions' virtualized Wine runners it is fatal (CLAUDE.md issue #5: local
    // memory ops are unreliable there, never on real hardware or a local Wine).
    // It was the deterministic segfault that always struck right here, after
    // this file's remote test printed (pass) -- the crash is this test starting,
    // not the previous test's teardown. `VirtualAllocEx` hands back a dedicated,
    // page-aligned region, so protect/query/free touch nothing but that page,
    // which is exactly the "drive it through a real process" pattern issue #5
    // prescribes (and VirtualProtectEx/VirtualQueryEx are already proven on CI
    // by the winapi remote-scan and struct tests).
    const tp = getGlobalDummyProcess();

    const remote = new RemoteProcessMemoryAccessor(tp.pid, {
      handle: tp.handle,
      closeHandle: false,
    });

    const addr = remote.allocSync(4096); // VirtualAllocEx -> PAGE_READWRITE page

    // VirtualProtectEx to PAGE_READONLY (2); returns the old protection.
    const oldProtect = remote.protectSync(addr, 4096, 2);
    expect(oldProtect).toBeGreaterThan(0);

    const info = remote.querySync(addr);
    expect(info).not.toBeNull();
    expect(info.Protect).toBe(2);

    // Restore protection and free the region.
    remote.protectSync(addr, 4096, oldProtect);
    remote.freeSync(addr);

    remote.close();
  });

  test('should seamlessly route struct operations through a custom/mock remote memory accessor', () => {
    // We'll create a completely virtual mock remote process memory space
    const virtualMemorySpace = new Map<number, number>();

    class VirtualMemoryAccessor extends AbstractSyncMemoryAccessor {
      readSync(address: AddressLike, size: number): Buffer {
        const addr = Number(resolveAddress(address));
        const buf = Buffer.alloc(size);
        for (let i = 0; i < size; i++) {
          buf.writeUInt8(virtualMemorySpace.get(addr + i) || 0, i);
        }
        return buf;
      }

      writeSync(address: AddressLike, data: Buffer | Uint8Array): number {
        const addr = Number(resolveAddress(address));
        for (let i = 0; i < data.byteLength; i++) {
          virtualMemorySpace.set(addr + i, data[i]!);
        }
        return data.byteLength;
      }

      allocSync(_size: number): AddressLike {
        return 0x90000000; // virtual address space
      }

      freeSync(_address: AddressLike): boolean {
        return true;
      }

      protectSync(
        _address: AddressLike,
        _size: number,
        _newProtect: number,
      ): number {
        return 4;
      }

      querySync(_address: AddressLike): never {
        throw new Error(`query failed for ${String(_address)}`);
      }

      machineCodeSync(): never {
        throw new Error('machineCodeSync not implemented in this mock');
      }

      // eslint-disable-next-line require-yield
      *scanSync(): Generator<never> {
        throw new Error('scanSync not implemented in this mock');
      }
    }

    const mockAccessor = new VirtualMemoryAccessor(-1);

    const POINT_SCHEMA = {
      x: 'i32',
      y: 'i32',
    } as const;

    // Instantiate a struct on a mock virtual remote address, passing our mock accessor!
    const remoteStruct = new SyncStruct(POINT_SCHEMA, 0x90000100, mockAccessor);

    // Test writing via Struct properties
    remoteStruct.x = 8899;
    remoteStruct.y = 1122;

    // Verify that values were written to our mock virtual memory storage instead of the local native heap!
    // 'x' is at offset 0 (0x90000100), 'y' is at offset 4 (0x90000104)
    const xBuffer = Buffer.alloc(4);
    xBuffer.writeInt32LE(8899, 0);
    expect(virtualMemorySpace.get(0x90000100)).toBe(xBuffer[0]);
    expect(virtualMemorySpace.get(0x90000101)).toBe(xBuffer[1]);

    // Test reading via Struct properties
    expect(remoteStruct.x).toBe(8899);
    expect(remoteStruct.y).toBe(1122);
  });

  test('should resolve addresses for TypedArrays and CStrings using AddressLike', () => {
    const array = new Uint8Array([42, 43, 44]);
    const arrayAddr = Number(bunPtr(array));

    // Resolve a TypedArray address
    expect(resolveAddress(array)).toBe(arrayAddr);

    // Resolve via NativePointer constructor using TypedArray
    const np = new SyncNativePointer(array);
    expect(np.toNumber()).toBe(arrayAddr);
  });

  test('should seamlessly support purely asynchronous memory accessors for Struct field access via Struct', async () => {
    // Set up a mock asynchronous memory space
    const virtualAsyncMemory = new Map<number, number>();

    class MockAsyncMemoryAccessor extends AbstractMemoryAccessor {
      async read(
        address: AddressLike,
        size: number,
        offset = 0,
      ): Promise<Buffer> {
        const addr = Number(resolveAddress(address)) + offset;
        const buf = Buffer.alloc(size);
        for (let i = 0; i < size; i++) {
          buf.writeUInt8(virtualAsyncMemory.get(addr + i) || 0, i);
        }
        return buf;
      }

      async write(
        address: AddressLike,
        data: Buffer | Uint8Array,
        offset = 0,
      ): Promise<number> {
        const addr = Number(resolveAddress(address)) + offset;
        for (let i = 0; i < data.byteLength; i++) {
          virtualAsyncMemory.set(addr + i, data[i]!);
        }
        return data.byteLength;
      }

      async alloc(_size: number): Promise<AddressLike> {
        return 0xa0000000;
      }

      async free(_address: AddressLike): Promise<boolean> {
        return true;
      }

      async protect(
        _address: AddressLike,
        _size: number,
        _newProtect: number,
      ): Promise<number> {
        return 4;
      }

      async query(_address: AddressLike): Promise<any> {
        return null;
      }

      async machineCode(): Promise<never> {
        throw new Error('machineCode not implemented in this mock');
      }

      // eslint-disable-next-line require-yield
      async *scan(): AsyncGenerator<never> {
        throw new Error('scan not implemented in this mock');
      }
    }

    const asyncAccessor = new MockAsyncMemoryAccessor(-1);

    const PLAYER_SCHEMA = {
      id: 'i32',
      health: 'i32',
      mana: 'i32',
    } as const;

    // Verify that using synchronous Struct with an async-only accessor throws an error immediately
    // (deliberately passing the wrong accessor kind to test the runtime guard -- cast past the
    // compile-time check that would otherwise (correctly) reject this).
    expect(
      () =>
        new SyncStruct(
          PLAYER_SCHEMA,
          0xa0001000,
          asyncAccessor as unknown as ISyncMemoryAccessor,
        ),
    ).toThrow(
      'Synchronous operations are not supported on this async-only MemoryAccessor. Use Struct instead.',
    );

    // Instantiate the Struct at a virtual remote address
    const player = new Struct(PLAYER_SCHEMA, 0xa0001000, asyncAccessor);

    // Verify that the accessor does not support sync operations
    expect('readSync' in player._accessor).toBe(false);

    // Verify async writing via player.set('health', 100) or set('mana', 200)
    await player.set('health', 100);
    await player.set('mana', 200);
    await player.set('id', 1337);

    // Direct property getters return a Promise on Struct!
    const healthPromise = player.health;
    expect(healthPromise).toBeInstanceOf(Promise);
    expect(await healthPromise).toBe(100);

    // Property getters can be directly awaited
    const manaVal = await player.mana;
    expect(manaVal).toBe(200);

    // Explicit .get() also returns a Promise and works beautifully
    const idVal = await player.get('id');
    expect(idVal).toBe(1337);

    // Verify that player.toStringAsync() asynchronously resolves all fields!
    const strRepresentation = await player.toStringAsync();
    expect(strRepresentation).toContain(
      'Struct { id: 1337, health: 100, mana: 200 } at 0x',
    );
    expect(strRepresentation).toContain('(12 bytes)');

    // Calling sync toString() returns a placeholder indicating async fields
    expect(player.toString()).toContain(
      '<async fields: use await struct.toStringAsync() or await getters>',
    );
  });

  test('should seamlessly support NativePointer async string reading', async () => {
    const virtualAsyncMemory = new Map<number, number>();

    // Seed ANSI string "Hello" at 0xA0002000
    virtualAsyncMemory.set(0xa0002000, 72);
    virtualAsyncMemory.set(0xa0002001, 101);
    virtualAsyncMemory.set(0xa0002002, 108);
    virtualAsyncMemory.set(0xa0002003, 108);
    virtualAsyncMemory.set(0xa0002004, 111);
    virtualAsyncMemory.set(0xa0002005, 0);

    // Seed Wide string "World" at 0xA0003000
    const wideStr = Buffer.from('World', 'utf16le');
    for (let i = 0; i < wideStr.length; i++) {
      virtualAsyncMemory.set(0xa0003000 + i, wideStr[i]!);
    }
    virtualAsyncMemory.set(0xa0003000 + wideStr.length, 0);
    virtualAsyncMemory.set(0xa0003000 + wideStr.length + 1, 0);

    class MockAsyncMemoryAccessor extends AbstractMemoryAccessor {
      async read(
        address: AddressLike,
        size: number,
        offset = 0,
      ): Promise<Buffer> {
        const addr = Number(resolveAddress(address)) + offset;
        const buf = Buffer.alloc(size);
        for (let i = 0; i < size; i++) {
          buf.writeUInt8(virtualAsyncMemory.get(addr + i) || 0, i);
        }
        return buf;
      }

      async write(): Promise<never> {
        throw new Error('write not implemented in this mock');
      }

      async alloc(): Promise<never> {
        throw new Error('alloc not implemented in this mock');
      }

      async free(): Promise<never> {
        throw new Error('free not implemented in this mock');
      }

      async protect(): Promise<never> {
        throw new Error('protect not implemented in this mock');
      }

      async query(): Promise<never> {
        throw new Error('query not implemented in this mock');
      }

      async machineCode(): Promise<never> {
        throw new Error('machineCode not implemented in this mock');
      }

      // eslint-disable-next-line require-yield
      async *scan(): AsyncGenerator<never> {
        throw new Error('scan not implemented in this mock');
      }
    }

    const asyncAccessor = new MockAsyncMemoryAccessor(-1);

    // Test NativePointer (async version)
    const ptr = new NativePointer(0xa0002000);
    const val = await ptr.readUInt8(0, asyncAccessor);
    expect(val).toBe(72); // 'H'

    // Test NativePointer async string reading
    expect(await ptr.readString({ accessor: asyncAccessor })).toBe('Hello');

    // Test NativePointer async wide string reading
    const ptrWorld = new NativePointer(0xa0003000);
    expect(
      await ptrWorld.readString({
        encoding: 'utf16le',
        accessor: asyncAccessor,
      }),
    ).toBe('World');
  });

  test('should support synchronous and asynchronous function execution via callable memory accessors', async () => {
    // Import standard libc strlen to get a real function pointer
    const libc = cimport({
      strlen: {
        args: [CType.cstring],
        returns: CType.u64,
      },
    });

    const strlen = libc.symbols.strlen;
    expect(strlen.address).not.toBe(0);

    // 1. Verify localCallableMemoryAccessor implements ISyncCallableMemoryAccessor
    const valSync = localCallableMemoryAccessor.callSync(
      strlen,
      'Hello World!',
    );
    expect(valSync).toBe(12n);

    // 2. Verify localCallableMemoryAccessor implements ICallableMemoryAccessor
    const valAsync = await localCallableMemoryAccessor.call(
      strlen,
      'Hello World!',
    );
    expect(valAsync).toBe(12n);

    // 3. Verify passing explicit argTypes
    const valSyncExplicit = localCallableMemoryAccessor.callSync(
      strlen,
      'Merhaba',
    );
    expect(valSyncExplicit).toBe(7n);

    libc.close();
  });

  test('should support implementing custom sync and async callable memory accessors', async () => {
    class CustomSyncCallableAccessor extends AbstractSyncCallableMemoryAccessor {
      readSync() {
        return Buffer.alloc(0);
      }
      writeSync() {
        return 0;
      }
      allocSync() {
        return 0;
      }
      freeSync() {
        return true;
      }
      protectSync() {
        return 0;
      }
      querySync(): never {
        throw new Error('query failed');
      }
      machineCodeSync(): never {
        throw new Error('machineCodeSync not implemented in this mock');
      }
      // eslint-disable-next-line require-yield
      *scanSync(): Generator<never> {
        throw new Error('scanSync not implemented in this mock');
      }

      callSync(func: any, ...args: any[]) {
        return `sync-called-${Number(func)}-with-${args.join(',')}`;
      }
    }

    class CustomAsyncCallableAccessor extends AbstractCallableMemoryAccessor {
      async read() {
        return Buffer.alloc(0);
      }
      async write() {
        return 0;
      }
      async alloc() {
        return 0;
      }
      async free() {
        return true;
      }
      async protect() {
        return 0;
      }
      async query(): Promise<never> {
        throw new Error('query failed');
      }
      async machineCode(): Promise<never> {
        throw new Error('machineCode not implemented in this mock');
      }
      // eslint-disable-next-line require-yield
      async *scan(): AsyncGenerator<never> {
        throw new Error('scan not implemented in this mock');
      }

      async call(func: any, ...args: any[]) {
        return `async-called-${Number(func)}-with-${args.join(',')}`;
      }
    }

    const syncAccessor = new CustomSyncCallableAccessor(-1);
    const asyncAccessor = new CustomAsyncCallableAccessor(-1);

    expect('readSync' in syncAccessor).toBe(true);
    expect('readSync' in asyncAccessor).toBe(false);

    const resSync = syncAccessor.callSync(0x1000, 'arg1', 42);
    expect(resSync).toBe('sync-called-4096-with-arg1,42');

    const resAsync = await asyncAccessor.call(0x2000, 'arg2', 99);
    expect(resAsync).toBe('async-called-8192-with-arg2,99');
  });

  test('should support automatic promise-resolved async fallbacks on a custom sync memory accessor', async () => {
    const store = new Map<number, number>();
    class MyCustomSyncAccessor extends AbstractSyncMemoryAccessor {
      readSync(address: AddressLike, size: number, offset = 0): Buffer {
        const addr = Number(resolveAddress(address)) + offset;
        const buf = Buffer.alloc(size);
        for (let i = 0; i < size; i++) {
          buf.writeUInt8(store.get(addr + i) || 0, i);
        }
        return buf;
      }

      writeSync(
        address: AddressLike,
        data: Buffer | Uint8Array,
        offset = 0,
      ): number {
        const addr = Number(resolveAddress(address)) + offset;
        for (let i = 0; i < data.byteLength; i++) {
          store.set(addr + i, data[i]!);
        }
        return data.byteLength;
      }

      allocSync(_size: number) {
        return 0xb0000000;
      }
      freeSync(_address: AddressLike) {
        return true;
      }
      protectSync(_address: AddressLike, _size: number, _newProtect: number) {
        return 0;
      }
      querySync(_address: AddressLike): never {
        throw new Error(`query failed for ${String(_address)}`);
      }
      machineCodeSync(): never {
        throw new Error('machineCodeSync not implemented in this mock');
      }
      // eslint-disable-next-line require-yield
      *scanSync(): Generator<never> {
        throw new Error('scanSync not implemented in this mock');
      }
    }

    const accessor = new MyCustomSyncAccessor(-1);

    // Verify that calling the inherited async methods on the custom sync accessor actually routes to sync methods and resolves via Promises
    const allocRes = await accessor.alloc(100);
    expect(allocRes).toBe(0xb0000000);

    const writeRes = await accessor.write(
      0xb0001000,
      Buffer.from([10, 20, 30]),
    );
    expect(writeRes).toBe(3);

    const readRes = await accessor.read(0xb0001000, 3);
    expect(readRes).toEqual(Buffer.from([10, 20, 30]));

    // Verify it works seamlessly with an async Struct
    const myStruct = new Struct(
      {
        first: 'u8',
        second: 'u8',
      },
      0xb0001000,
      accessor,
    );

    // Write via Struct set
    await myStruct.set('first', 99);
    await myStruct.set('second', 101);

    // Read via Struct properties
    const firstVal = await myStruct.first;
    const secondVal = await myStruct.second;
    expect(firstVal).toBe(99);
    expect(secondVal).toBe(101);
  });

  test('should support scanSync and scan on local memory using localMemoryAccessor', async () => {
    const size = 100;
    const addr = localMemoryAccessor.allocSync(size);
    expect(addr).toBeGreaterThan(0);

    const patternBytes = Buffer.from([0x12, 0x34, 0x56, 0x78, 0x9a]);
    localMemoryAccessor.writeSync(resolveAddress(addr) + 20, patternBytes);

    // 1. Test scanSync
    const resultsSync = Array.from(
      localMemoryAccessor.scanSync(addr, size, '12 34 56 78 9A'),
    );
    expect(resultsSync).toHaveLength(1);
    expect(BigInt(resolveAddress(resultsSync[0]))).toBe(
      BigInt(resolveAddress(addr)) + 20n,
    );

    // 2. Test scan (async)
    const resultsAsync: bigint[] = [];
    for await (const val of localMemoryAccessor.scan(
      addr,
      size,
      '12 34 56 78 9A',
    )) {
      resultsAsync.push(BigInt(resolveAddress(val)));
    }
    expect(resultsAsync).toHaveLength(1);
    expect(resultsAsync[0]).toBe(BigInt(resolveAddress(addr)) + 20n);

    localMemoryAccessor.freeSync(addr);
  });

  test('should support running machineCode via cmachinecode + accessor.call', async () => {
    const { cmachinecode } =
      await import('../../packages/xffi/src/cmachinecode.js');
    const sc = cmachinecode({
      source: 'return arg0 + arg1;',
      returns: 'i32',
      args: ['i32', 'i32'],
    });

    // sync
    const resultSync = localCallableMemoryAccessor.callSync(sc, 40, 2);
    expect(resultSync).toBe(42);

    // async
    const resultAsync = await localCallableMemoryAccessor.call(sc, 40, 2);
    expect(resultAsync).toBe(42);
  });

  test('should support machineCode allocation and calling via accessor.call with automatic machineCode resolution', async () => {
    const { cmachinecode } =
      await import('../../packages/xffi/src/cmachinecode.js');
    const localSc = cmachinecode({
      source: 'return arg0 * arg1;',
      returns: 'i32',
      args: ['i32', 'i32'],
    });

    // 1. Allocate machineCode and get remote address
    const remoteAddr = await localCallableMemoryAccessor.machineCode(localSc);
    expect(remoteAddr).not.toBe(0);

    // 2. Clone machineCode for the remote address
    const remoteSc = localSc.cloneForAddress(remoteAddr);
    expect(remoteSc.ptr).toBeDefined();

    // 3. Call via remoteSc.call(accessor, arg1, arg2)
    const valCall = await remoteSc.call(localCallableMemoryAccessor, 6, 7);
    expect(valCall).toBe(42);

    // 4. Call via accessor.call(localSc, arg1, arg2) — auto-allocates and clones
    const valAccessorCall = await localCallableMemoryAccessor.call(
      localSc,
      6,
      7,
    );
    expect(valAccessorCall).toBe(42);

    // 5. Test sync version
    const remoteAddrSync = localCallableMemoryAccessor.machineCodeSync(localSc);
    const remoteScSync = localSc.cloneForAddress(remoteAddrSync);
    const valSyncCall = remoteScSync.callSync(
      localCallableMemoryAccessor,
      10,
      5,
    );
    expect(valSyncCall).toBe(50);
  });
});

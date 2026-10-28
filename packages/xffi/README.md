# bun-xffi

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/w0ldan/exoproc/blob/main/LICENSE)

The core FFI and native systems programming foundation of the
[Exoproc](https://github.com/w0ldan/exoproc) toolkit for Bun. It provides the
C-ABI type system, memory accessor abstractions, a runtime **TinyCC** JIT, and
struct/union layout calculations — all backed by real memory, local or remote.

Everything else in Exoproc (`bun-winapi`, `bun-nthread`, `bun-nhook`,
`bun-minhook`) is built on top of this package.

## Installation

```bash
bun add bun-xffi
```

## Requirements

- Bun ≥ 1.0
- Windows x64 — or Linux with Wine for development

## Quick Start

### C structs, backed by real memory

Define a layout once; read and write its fields — nested and all — straight
through to memory. No manual offsets, no `DataView` bookkeeping:

```typescript
import { struct } from 'bun-xffi';

const Vector3 = struct({
  x: 'f32',
  y: 'f32',
  z: 'f32',
});

const vec = Vector3.allocSync();
vec.x = 1.0;
vec.y = 2.5;
vec.z = -5.0;

console.log(`Vector: (${vec.x}, ${vec.y}, ${vec.z})`);
```

Point a `Struct` at memory in **another process** through a remote accessor
and the very same field access reads and writes the target — now async:

```typescript
import { Struct } from 'bun-xffi';

const player = new Struct(
  { id: 'i32', health: 'i32' },
  entityAddress,
  remoteAccessor, // any IMemoryAccessor — local, remote, or thread-redirected
);
await player.set('health', 999); // writes into the target process
console.log(await player.health); // reads it back
```

### JIT-compile C at runtime

`cjitopen` compiles raw C source to executable machineCode via TinyCC and
hands you back directly callable functions:

```typescript
import { cjitopen, CType } from 'bun-xffi';

const lib = cjitopen({
  fast_multiply: {
    args: [CType.i32, CType.i32],
    returns: CType.i32,
    source: `return arg0 * arg1;`,
  },
});

console.log(lib.symbols.fast_multiply(6, 7)); // 42
lib.close();
```

### Import native symbols without a wrapper DLL

`cimport` resolves `extern` symbols straight out of a system DLL and wraps
them as directly callable functions — no hand-written C glue:

```typescript
import { cimport, CType } from 'bun-xffi';

const Kernel32 = cimport(
  {
    GetCurrentThreadId: { args: [], returns: CType.DWORD },
  },
  { library: ['kernel32'] },
);

console.log(Kernel32.symbols.GetCurrentThreadId());
```

## Features

- **Memory Accessors (`IMemoryAccessor`)**: Unified sync/async interfaces for
  `read`, `write`, `alloc`, `free`, `protect`, `query`, `scan`, and `call` —
  the same interface for local memory, another process's memory, or a
  redirected thread in another process.
- **Middleware Accessor chain**: Composable decorators — `CallRedirectorAccessor`,
  `IndirectCallRedirectorAccessor` (malloc-based, no direct
  `VirtualAlloc`/`WriteProcessMemory`) — that stack to build a fully silent,
  cross-process execution pipeline.
- **C Struct Compiler (`struct`, `union`)**: Native-feeling TypeScript
  declarations backed 1:1 by real (even remote) memory pointers, with
  automatic offset alignment, padding, and nested structs.
- **TinyCC JIT Compilation (`CJit`/`cjitopen`)**: Compile raw C snippets to
  executable memory or DLLs at runtime for high-performance callbacks and
  machineCode.
- **`cimport`**: Wrap existing native DLL exports directly as callable
  functions, with no intermediate C wrapper.

## Part of the Exoproc toolkit

| Package        | Description                                                        |
| -------------- | ------------------------------------------------------------------ |
| `bun-xffi`     | **You are here** — FFI foundation: accessors, structs, JIT         |
| `bun-winapi`   | Ergonomic process / memory / thread / module / snapshot APIs       |
| `bun-nthread`  | x64 thread redirection — remote calls without `CreateRemoteThread` |
| `bun-minhook`  | Real 5-byte `jmp` + trampoline/detour hooking                      |
| `bun-capstone` | Capstone disassembler bindings                                     |

See the [main repository](https://github.com/w0ldan/exoproc) for the full
picture of how these compose into cross-process hooking and instrumentation.

## Contributing & Security

See [CONTRIBUTING.md](https://github.com/w0ldan/exoproc/blob/main/CONTRIBUTING.md)
for development setup.

## License

[MIT](https://github.com/w0ldan/exoproc/blob/main/LICENSE)

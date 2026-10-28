# bun-winapi

Ergonomic, object-oriented Win32 process, thread, module, and memory management APIs for Bun. It wraps raw Windows FFI functions into native-feeling TypeScript classes.

## Installation

```bash
bun add bun-winapi
```

## Quick Start

```typescript
import { Process, Thread } from 'bun-winapi';

// Find a process by name
const proc = Process.findByName('notepad.exe');
if (proc) {
  console.log(`notepad.exe PID: ${proc.pid}`);

  // Read and print modules
  for (const mod of proc.getModules()) {
    console.log(`Module: ${mod.name} @ 0x${mod.baseAddress.toString(16)}`);
  }
}

// Get the current thread ID
const tid = Thread.currentId();
console.log(`Current thread ID: ${tid}`);
```

## Features

- **Process Wrapper (`Process`)**: Query handles, search by name or ID, list modules, read/write memory using native accessors, and enumerate threads.
- **Thread Wrapper (`Thread`)**: Open threads, suspend/resume execution, query and apply execution register contexts (`ThreadContext`), and retrieve exit codes.
- **Modules & Snapshots**: Enumerate system processes and loaded DLL modules via Toolhelp32 snapshots.
- **Pointer Arithmetic (`NativePointer`)**: High-performance typed pointer structures for safe address arithmetic.

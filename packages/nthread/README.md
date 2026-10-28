# bun-nthread

Non-invasive x64 Windows thread redirection library. It allows you to redirect existing running threads in a target process to execute arbitrary remote calls, removing the need for `CreateRemoteThread` or machineCode injection.

## Installation

```bash
bun add bun-nthread
```

## Quick Start (Indirect Accessor)

`IndirectNThreadHostAccessor` is a composite memory accessor. It routes **every** single remote memory operation (allocations, reads, writes, calls) by redirecting a live thread in the target, making it highly non-intrusive:

```typescript
import { IndirectNThreadHostAccessor } from 'bun-nthread';
import { struct } from 'bun-xffi';

// Create the indirect accessor on the target process and thread
const memory = new IndirectNThreadHostAccessor(pid, threadId);
await memory.whenReady();

// Read memory through a struct over the redirected thread
const Player = struct({ id: 'i32', health: 'i32' });
const p = new Player(playerAddr, memory);

console.log(`Player HP: ${await p.health}`);
```

## Features

- **GPR & XMM Register Mapping**: Maps first 4 arguments to x64 ABI registers (`RCX`, `RDX`, `R8`, `R9`) and floating-point arguments to `XMM0`–`XMM3`.
- **Unlimited Stack Arguments**: Correctly writes additional arguments (5+) to the redirected thread stack and manages stub compilation (`add rsp, offset; ret`) remotely to maintain stack integrity.
- **Auto-Suspension Management**: Keeps the redirected thread completely suspended between calls to eliminate CPU consumption (0% overhead) and avoid redundant Win32 `SuspendThread`/`ResumeThread` cycles.
- **Rop-Stub Locating**: Synchronously scans DLL modules (like `ntdll.dll` and `kernel32.dll`) to resolve sleep, pushret, and return stubs shared across all processes.

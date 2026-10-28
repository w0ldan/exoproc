# bun-minhook

A cross-process MinHook-style hooking engine. It builds a real relocated trampoline buffer and installs a 5-byte relative `jmp` detour. It works over any `IMemoryAccessor`, enabling hooking in both local and remote processes.

## Installation

```bash
bun add bun-minhook
```

## Quick Start

```typescript
import { MinHook } from 'bun-minhook';
import { IndirectNThreadHostAccessor } from 'bun-nthread';
import { Kernel32Impl } from 'bun-winapi';

// Target process setup
const memory = new IndirectNThreadHostAccessor(pid, threadId);
const minhook = new MinHook(pid);

// 1. Create hook (allocates and builds the trampoline; target function is untouched)
const hook = await minhook.create(memory, targetFn);

// 2. Enable hook (detour function is loaded as detour)
// Supports automatic far-detour relaying if the detour is outside rel32 reach
await hook.enable(Kernel32Impl.GetCurrentThreadId);

// 3. Disable and destroy
await hook.disable(); // Restores original bytes at the target
await hook.destroy(); // Frees the remote trampoline
```

## Features

- **Relocated Trampoline Generation**: Disassembles target instructions using Capstone and relocates RIP-relative operands (e.g. `jmp`, `call`, `mov rip+offset`) so they execute correctly inside the trampoline.
- **Far-Detour Relay (Gateway)**: Transparently injects a 14-byte absolute jump relay near the target if the detour resides outside the 2GB relative branch range (ideal for hooking remote DLL exports).
- **Accessor-Agnostic**: Operates on any implementation of `IMemoryAccessor`, including local processes, remote thread-redirected threads, or named pipe loops.

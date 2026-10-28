# bun-capstone

TypeScript FFI bindings for the **Capstone** disassembly engine with full OOP support, optimized for Windows x64 reverse engineering and instruction decoding.

## Installation

```bash
bun add bun-capstone
```

## Quick Start

```typescript
import { Capstone, Architecture, Mode } from 'bun-capstone';

// Initialize disassembler for x86_64
const cs = new Capstone(Architecture.X86, Mode.MODE_64);

const code = Buffer.from([0x55, 0x48, 0x89, 0xe5]); // push rbp; mov rbp, rsp
const insns = cs.disasm(code, 0x1000n);

for (const ins of insns) {
  console.log(`0x${ins.address.toString(16)}: ${ins.mnemonic} ${ins.opStr}`);
}

cs.close();
```

## Architecture

This package provides:

- High-level bindings to the underlying Capstone DLL (`libcapstone.dll`).
- Typed classes representing disassembler instances (`Capstone`) and decoded instructions (`Instruction`).
- Operand-level detailed breakdown (registers, memory offsets, immediate values) using x64-specific extensions.

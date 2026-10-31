# Exoproc Roadmap & Architectural Vision

This document details the architectural blueprint and open-source roadmap for **Exoproc**.

Exoproc follows an **Umbrella Architecture** model: a collection of modular, single-responsibility packages in a Bun workspace monorepo, tied together by a single umbrella package (`exoproc`) that provides an all-in-one distribution for developers, terminal operators, and AI coding agents.

---

## 1. The Umbrella Architecture Model

### Architectural Principles

1. **Unified Core Engines (Multi-Platform & Multi-Architecture):**
   Fundamental systems capabilities live in unified, cross-platform packages using clean driver and calling convention abstractions:
   - **`bun-nthread`:** The core zero-injection thread redirection engine. Instead of fragmenting into per-OS packages, `bun-nthread` is unified across Windows, macOS Darwin, and Linux using pluggable drivers (`Win32ThreadDriver`, `MachThreadDriver`, `PtraceThreadDriver`) and calling convention modules (`WinX64Convention`, `AAPCS64Convention`).
   - **`exoproc-asm`:** Pure assembler emitting native machine code and stub thunks (`X64Assembler`, `ARM64Assembler`).
   - **`bun-capstone`:** Multi-architecture instruction disassembly (x86_64 and ARM64).
   - **`bun-xffi`:** C-ABI type system, memory accessors, and runtime JIT compilation.

2. **OS-Specific Kernel & API Layers:**
   Operating-system-specific structs, handles, and detour engines remain cleanly decoupled:
   - **Windows:** `win32-abi` (C structs/offsets), `bun-winapi` (Process/Thread/Memory handles), `bun-minhook` (5-byte JMP relative detours).
   - **macOS (Darwin):** `darwin-abi` (Mach kernel types/offsets), `bun-darwinapi` (MachTask, `mach_vm_*` memory accessors), `bun-machhook` (dyld interposing & symbol rebinding).

3. **Pure TypeScript Static Binary Analysis:**
   Standalone, zero-dependency binary parsers for executable formats:
   - **`bun-pe`:** PE32 / PE32+ (x64 and ARM64) executable mapper, sections, imports, exports, and base relocations.
   - **`bun-macho`:** Mach-O 64-bit binary parser, load commands, sections, and dynamic symbol tables.

4. **Autonomous AI Reverse Engineering & Signature Inference:**
   Empowering AI coding agents to perform safe, autonomous function redirection by inspecting target process binaries, reading on-disk/in-memory code, disassembling epilogues/prologues, inferring calling conventions (`stdcall`, `fastcall`, `cdecl`, `win64`, `sysv64`, `aapcs64`), and verifying hook safety before applying detours.

5. **Single Umbrella CLI & Runtime (`exoproc`):**
   Direct consumers install a single package (`npm i -g exoproc` or `npx -y exoproc`). The umbrella package bundles and re-exports all underlying modular engines under clean namespaces (`nthread`, `minhook`, `winapi`, `darwinapi`, `pe`, `macho`, `asm`, `accessors`, `ipc`, `java`) and powers the 21-tool stdio Model Context Protocol (MCP) server.

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                        Unified Umbrella Package (exoproc)                        │
│             CLI Runner  •  Multi-Agent Setup  •  Full Modular Exports            │
└────────────────────────────────────────┬─────────────────────────────────────────┘
                                         │
    ┌────────────────────────────────────┴────────────────────────────────────┐
    ▼                                                                         ▼
┌──────────────────────────┐                             ┌──────────────────────────┐
│  MCP Server (stdio)      │                             │  Live Process Automation │
│  exoproc-mcp (21 tools)  │                             │  exoproc-runner          │
└───────────┬──────────────┘                             └───────────┬──────────────┘
            │                                                        │
    ┌───────┴────────────────────────────────────────────────────────┴──────┐
    ▼                                                                       ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                                Systems Engine Stack                              │
│                                                                                  │
│  [Unified Core Engines (Multi-Platform & Multi-Architecture)]                    │
│  ├── bun-nthread (Zero-Injection Thread Redirection: Win32, Mach, ptrace)        │
│  ├── exoproc-asm (Native X64Assembler & ARM64Assembler JIT stubs)                │
│  ├── bun-capstone (Multi-Architecture Instruction Disassembler)                  │
│  └── bun-xffi (Low-level C-ABI Memory Accessors & JIT Compilation)               │
│                                                                                  │
│  [OS-Specific Kernel & API Layers]                                               │
│  ├── Windows: win32-abi  •  bun-winapi  •  bun-minhook (5-Byte JMP Detours)      │
│  └── macOS:   darwin-abi •  bun-darwinapi • bun-machhook (dyld/Symbol Rebind)    │
│                                                                                  │
│  [Static Binary Analysis & AI Reverse Engineering (Pure TypeScript)]             │
│  ├── bun-pe (PE32 / PE32+ parser: DOS, NT headers, sections, IAT/EAT)            │
│  ├── bun-macho (Mach-O 64-bit parser: load commands, segments, symbols)          │
│  └── ai-analysis (Calling convention inference: stdcall/fastcall/win64, safety)  │
│                                                                                  │
│  [Shared Foundation & JVM Subsystems]                                            │
│  ├── exoproc-accessors (Composite memcmp, memset, process caching)              │
│  ├── exoproc-ipc (Named Pipe Hub, UNIX domain sockets, agent RPC)                │
│  ├── bun-njava (JVM Reflection, dynamic proxies & in-process agent)              │
│  └── exoproc-utils (Binary cache, SHA-1/256 integrity, shared logging)          │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Current Status (v0.7.x — Windows x64 Production Stack)

- [x] **Zero-Injection Thread Redirection (`bun-nthread`):** Hijacks remote threads via thread context manipulation (`SetThreadContext`) and execution stubs without code injection or `CreateRemoteThread`.
- [x] **5-Byte JMP Trampoline Detours (`bun-minhook`):** Disassembles prologues with Capstone, builds relative near trampolines, and provides 14-byte absolute far-detour relays.
- [x] **C-to-Shellcode JIT Compilation (`bun-xffi`):** Dynamic in-memory compilation of C code into relocatable machine code using TinyCC (`cmachinecode`), with automatic Win32 symbol resolution.
- [x] **Named Pipe IPC Hub (`exoproc-ipc`):** High-speed inter-process communication for diagnostics and agent RPC.
- [x] **JVM Dynamic Instrumentation (`bun-njava`):** JNI reflection, Nashorn compatibility shims, in-process Java agent, and dynamic class proxies.
- [x] **21-Tool Model Context Protocol Server (`exoproc-mcp`):** Native stdio MCP transport for Claude Code, Cursor, Windsurf, Claude Desktop, Antigravity, Cline, OpenCode, and Zed.
- [x] **Ahead-Of-Time (AOT) Windows Binary:** Standalone `exoproc.exe` with API trimming (`--trim`) and smart zero-latency caching.

---

## 3. Open Source Contribution Modules (Roadmap TODOs)

The following modules represent key architectural expansions designed for modular implementation by community contributors and autonomous agents.

---

### [ ] Modül 1: ARM Mimarisi Desteği (`exoproc-asm` & `bun-nthread` ARM64 Calling Convention)

**Target Packages:** `packages/asm` (`exoproc-asm`) and `packages/nthread` (`bun-nthread`)  
**Purpose:** Extend `bun-nthread` and `exoproc-asm` to support ARM64 (AArch64), enabling native thread redirection on Windows on ARM (e.g. Snapdragon X Elite, Surface Pro) and Linux/macOS aarch64 without creating separate packages.

#### Technical Specifications & Calling Conventions:

1. **Calling Convention (AAPCS64):**
   - Arguments 1–8: `X0`–`X7` (integer / pointer).
   - Floating-point / SIMD arguments 1–8: `V0`–`V7` (`D0`–`D7` / `S0`–`S7`).
   - Stack Arguments: Pushed onto `SP` (16-byte aligned at all times).
   - Return Value: `X0` (or `X0`–`X1` for 128-bit values), `V0` for floats.

2. **ARM64 Register State Management:**
   - On Windows ARM64: `ARM64_NT_CONTEXT` structure tracking registers `X0`–`X30`, `Sp` (Stack Pointer), `Pc` (Program Counter), and `Fpcr`/`Fpsr`.
   - On POSIX / Linux ARM64: `ucontext_t` and `mcontext_t` with `pstate` and general-purpose registers.

3. **Execution Stub Library (`exoproc-asm` ARM64Assembler):**
   - Sleep / Park Stub: `b .` (`0x14000000` — infinite branch to self).
   - Return / Exit Stub: `ret` (`0xD65F03C0` — return to address in `X30` / `LR`).
   - Register Jump Stub: `br X16` (`0xD61F0200` — indirect branch via intra-procedure call scratch register `X16` / `IP0`).
   - Stack Adjustment Thunks: `add sp, sp, #imm` + `ret`.

#### Implementation Tasks:

- [ ] Add `ARM64Assembler` to `packages/asm` supporting branch, register move, stack manipulation, and return instructions.
- [ ] Define ARM64 ABI constants, register indices, and context structure layouts in `packages/win32/abi/src/arm64.ts`.
- [ ] Add `AAPCS64Convention` module to `bun-nthread` (`src/arch/arm64.ts`) implementing parameter marshalling and return unpacking.
- [ ] Implement ARM64 stub discovery and allocation routines in `bun-nthread`:
  - Locate `b .` and `ret` instructions in system DLLs (`ntdll.dll`, `kernel32.dll` on Windows ARM64).
  - Implement register-based dispatch through `X16`/`X17`.
- [ ] Verify argument marshalling up to 8 GPRs and stack-spilled parameters.
- [ ] Add integration test suite under `tests/nthread/arm64/`.

---

### [ ] Modül 2: macOS (Darwin) Desteği (`darwin-abi`, `bun-darwinapi`, `bun-nthread` Mach Driver, `bun-machhook`)

**Target Packages:**

- `packages/darwin/abi` (`darwin-abi`)
- `packages/darwin/api` (`bun-darwinapi`)
- `packages/nthread` (`bun-nthread` — Mach driver)
- `packages/darwin/machhook` (`bun-machhook`)

**Purpose:** Provide full native runtime instrumentation, Mach memory manipulation, Mach thread hijacking via unified `bun-nthread`, and dynamic symbol rebinding for macOS (Apple Silicon ARM64 & Intel x86_64).

#### Technical Specifications & Mach APIs:

1. **Mach Task & Memory Control (`darwin-abi` & `bun-darwinapi`):**
   - `task_for_pid(mach_task_self(), pid, &task)`: Obtain Mach task port for target process (requires `get-task-allow` entitlement or root/SIP relaxation).
   - `mach_vm_read_overwrite(task, address, size, data, &outSize)`: Remote memory reading.
   - `mach_vm_write(task, address, data, size)`: Remote memory writing.
   - `mach_vm_allocate(task, &address, size, flags)` / `mach_vm_deallocate(task, address, size)`: Virtual memory allocation.
   - `mach_vm_protect(task, address, size, set_maximum, new_protection)`: Memory protection management (`VM_PROT_READ`, `VM_PROT_WRITE`, `VM_PROT_EXECUTE`).

2. **Mach Thread State Hijacking (`bun-nthread` Mach Driver):**
   - Rather than creating a separate package, `bun-nthread` implements a `MachThreadDriver` implementing `IThreadDriver`:
     - `task_threads(task, &thread_list, &thread_count)`: Enumerate Mach thread ports.
     - `thread_suspend(thread)` / `thread_resume(thread)`: Execution flow control.
     - `thread_get_state(thread, ARM_THREAD_STATE64, &state, &count)`: Read register context (`__pc`, `__sp`, `__lr`, `__x[29]`).
     - `thread_set_state(thread, ARM_THREAD_STATE64, &state, count)`: Redirect instruction pointer and dispatch calls via Mach ports without code injection.
   - Shared `NThread` API remains 100% identical across Windows and macOS.

3. **Dynamic Hooking on Darwin (`bun-machhook`):**
   - `dyld` Interposing: Replace exported functions at runtime via Mach-O `__interpose` sections.
   - Dynamic Symbol Re-binding (fishhook style): Re-bind lazy and non-lazy symbol pointers in Mach-O image segments (`__DATA,__la_symbol_ptr` and `__DATA,__nl_symbol_ptr`).

#### Implementation Tasks:

- [ ] Create `packages/darwin/abi` (`darwin-abi`) with Mach kernel types, thread state structures, and protection flags.
- [ ] Implement `DarwinProcess`, `MachTask`, and `MachMemoryAccessor` in `packages/darwin/api` (`bun-darwinapi`) conforming to `IMemoryAccessor`.
- [ ] Implement `MachThreadDriver` in `bun-nthread` (`packages/nthread/src/drivers/mach.ts`) for zero-injection thread execution over Mach thread ports for `arm64` and `x86_64`.
- [ ] Implement `bun-machhook` for dynamic symbol rebinding in Mach-O images.
- [ ] Add Darwin permission and SIP status diagnostics to `exoproc doctor`.

---

### [ ] Modül 3: Saf TypeScript Statik Analiz (`bun-pe` & `bun-macho`)

**Target Packages:**

- `packages/formats/pe` (`bun-pe`)
- `packages/formats/macho` (`bun-macho`)

**Purpose:** Zero-dependency, pure TypeScript binary parsers that read, inspect, and map Windows PE/COFF and macOS Mach-O executable binaries directly in memory using standard `Uint8Array` / `DataView`.

#### Technical Specifications:

1. **Portable Executable (`bun-pe` — PE32 / PE32+ x64 and ARM64):**
   - **DOS Header:** Verify `e_magic` (`0x5A4D` / `MZ`), extract offset `e_lfanew` to NT Headers.
   - **NT Headers:**
     - Signature: `0x00004550` (`PE\0\0`).
     - File Header: Machine type (`0x8664` for AMD64, `0xAA64` for ARM64), `NumberOfSections`, `Characteristics`.
     - Optional Header: `AddressOfEntryPoint`, `ImageBase`, `SectionAlignment`, `FileAlignment`, `SizeOfImage`, `DataDirectory[16]`.
   - **Section Headers Table:** Parse section headers (`.text`, `.rdata`, `.data`, `.pdata`), virtual address, raw data offset, and section flags (`IMAGE_SCN_MEM_EXECUTE`, `IMAGE_SCN_MEM_READ`, `IMAGE_SCN_MEM_WRITE`).
   - **Data Directories Navigation:**
     - Export Table: Parse `IMAGE_EXPORT_DIRECTORY`, function names, ordinals, and RVA-to-offset mapping.
     - Import Table: Parse `IMAGE_IMPORT_DESCRIPTOR`, resolve DLL import names, OriginalFirstThunk (INT) and FirstThunk (IAT).
     - Base Relocation Table: Parse `IMAGE_BASE_RELOCATION` blocks (`IMAGE_REL_BASED_DIR64`, `IMAGE_REL_BASED_HIGHLOW`) for rebasing binaries in simulated or manual mapping.
     - Exception Table: Parse `.pdata` `IMAGE_RUNTIME_FUNCTION_ENTRY` for x64 unwinding information.

2. **Mach-O (`bun-macho` — 64-bit Mach-O):**
   - Verify `magic` (`0xFEEDFACF` for `MH_MAGIC_64`).
   - Iterate Load Commands (`LC_SEGMENT_64`, `LC_SYMTAB`, `LC_DYSYMTAB`, `LC_LOAD_DYLIB`).
   - Parse section mappings (`__TEXT,__text`, `__DATA,__data`, `__DATA,__bss`).
   - Parse dynamic symbol tables and string tables (`LC_SYMTAB`).

3. **MCP Tools Integration:**
   - `inspect_binary({ path | hex })`: Return format, architecture, entrypoint, sections, and linked imports.
   - `list_imports({ path })`: Return list of imported DLLs/dylibs and symbol names.
   - `list_exports({ path })`: Enumerate exported functions and ordinal indices.

#### Implementation Tasks:

- [ ] Create `packages/formats/pe` (`bun-pe`) with memory stream reader, PE header parser, section loader, and export/import extractors.
- [ ] Create `packages/formats/macho` (`bun-macho`) with Mach-O 64-bit load commands, segment parser, and symbol table reader.
- [ ] Expose binary analysis APIs in umbrella package `exoproc` under `exoproc.pe` and `exoproc.macho`.
- [ ] Register `inspect_binary`, `list_imports`, and `list_exports` tools in `packages/exoproc-mcp`.
- [ ] Add unit test suites with real PE and Mach-O binary fixtures in `tests/formats/pe/` and `tests/formats/macho/`.

---

### [ ] Modül 4: Otonom AI Tersine Mühendislik ve Çağırma Kuralı (Calling Convention) Analizi

**Target Packages:** `packages/formats/pe` (`bun-pe`), `packages/capstone/core` (`bun-capstone`), `packages/minhook` (`bun-minhook`), `packages/exoproc-mcp`  
**Purpose:** Enable autonomous AI coding agents to inspect live target processes, read and cross-reference on-disk binary code with in-memory state, infer calling conventions and parameter signatures from machine code epilogues/prologues, verify hook safety, and automatically construct reliable detour trampolines.

#### Technical Specifications & Analysis Pipeline:

1. **Static & Live Code Extraction:**
   - Locate target function entrypoints via PE Export Address Tables (EAT), debug symbols, or pattern scans.
   - Read the executable code directly from process memory and cross-reference with on-disk binary image (`bun-pe` / `bun-macho`) to verify whether code has been patched, packed, or relocated.

2. **Calling Convention & Argument Count Inference:**
   - **Epilogue Stack Cleanup Detection:**
     - `ret imm16` (`0xC2 iw`): Callee-cleanup calling convention (`stdcall`, `thiscall`, or 32-bit `fastcall`). The immediate value divided by pointer size gives the exact stack argument count (e.g. `ret 0x10` $\implies$ 4 arguments on 32-bit).
     - `ret` (`0xC3`): Caller-cleanup calling convention (`cdecl`), or 64-bit calling conventions (Microsoft x64, System V AMD64, AAPCS64).
   - **Register Usage & Parameter Passing Heuristics:**
     - On x86 32-bit: Inspect whether `ECX` and/or `EDX` are read before written $\implies$ `fastcall` (`ECX`, `EDX`) or `thiscall` (`ECX` = `this`).
     - On Windows x64: Trace prologue instructions saving home registers (`mov [rsp+8], rcx`, `mov [rsp+16], rdx`) to determine argument count and types.
     - On x64 SEH: Parse `.pdata` `IMAGE_RUNTIME_FUNCTION_ENTRY` and `UNWIND_INFO` to resolve function boundaries, frame register, and stack allocation size.
     - On ARM64: Trace `X0`–`X7` and `V0`–`V7` parameter usage and stack frame prologue (`stp x29, x30, [sp, #-N]!`).

3. **Autonomous Hook Safety & Trampoline Verification:**
   - Disassemble prologue using `bun-capstone`.
   - Calculate required stolen instruction length ($\ge 5$ bytes for x86/x64 rel32 JMP) without cutting multi-byte instructions in half.
   - Inspect instructions for RIP-relative addressing or short branches (`EB xx`, `7x xx`) and automatically apply operand relocation or far-detour relays.
   - Detect 2-byte hot-patching pre-prologues (`mov edi, edi` preceded by 5x `nop`) to enable non-disruptive 2-byte hot-patching when available.

4. **MCP Tools Integration for AI Agents:**
   - `analyze_function({ pid, address | symbol, module? })`:
     - Returns structured analysis:
       ```ts
       {
         callingConvention: 'stdcall' | 'fastcall' | 'cdecl' | 'win64' | 'sysv64' | 'aapcs64',
         argCount: number,
         stackCleanupBytes: number,
         prologueLength: number,
         isHookable: boolean,
         relocationRequired: boolean,
         suggestedDetourSignature: string
       }
       ```
   - `auto_hook({ pid, target, detourShellcode | detourType })`:
     - Fully autonomous tool: analyzes target function, verifies calling convention, synthesizes trampoline, compiles detour wrapper matching the ABI, and attaches detour atomically.

#### Implementation Tasks:

- [ ] Build `CallingConventionAnalyzer` in `bun-capstone` combining disassembler opcode stream with control-flow heuristics.
- [ ] Implement `.pdata` function boundary and unwind code extractor in `bun-pe`.
- [ ] Connect `analyze_function` tool to `packages/exoproc-mcp` providing structured AI output.
- [ ] Implement automated signature-matching detour wrapper generator in `bun-minhook`.
- [ ] Add integration test suite under `tests/analysis/convention.test.ts`.

---

## 5. Contributing & Standards

1. **Monorepo Conventions:**
   - Every package must have `src/index.ts`, `dist/index.js`, and `dist/index.d.ts`.
   - Native bindings and FFI must implement graceful platform fallbacks (e.g. skip tests cleanly on unsupported host operating systems).
   - Zero emojis in code, logs, and commit messages.

2. **Quality Verification:**

   ```bash
   bun run typecheck    # 0 errors across all workspace packages
   bun run format:check # Prettier code style
   bun run test         # Unit test suite
   ```

3. **Release & Versioning:**
   - Use `bun run bump:changed` for surgical version increments of touched packages.
   - All inter-package dependencies use semver (`^0.7.x`) to preserve npm ecosystem compatibility.

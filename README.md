<div align="center">

# Exoproc: Reverse Engineer & Instrument Any Process

### One unified CLI and Model Context Protocol (MCP) server for Windows x64 reverse engineering, thread hijacking, function detours, live memory manipulation, and C-to-shellcode compilation.

**Inspect a running process. Intercept functions, redirect threads, modify memory, and compile C to shellcode—without DLL injection.**

[![npm version](https://img.shields.io/npm/v/exoproc?style=flat-square&color=cb3837)](https://www.npmjs.com/package/exoproc)
[![MCP Catalog](https://img.shields.io/badge/MCP-22_tools-5c4ee5?style=flat-square)](server.json)
[![Bun Requirements](https://img.shields.io/badge/Bun-%3E%3D1.0-339933?style=flat-square&logo=bun&logoColor=white)](https://bun.sh)
[![License: MIT](https://img.shields.io/badge/license-MIT-f4c430?style=flat-square)](LICENSE)
[![Platform](https://img.shields.io/badge/target-Windows_x64-0078d6?style=flat-square&logo=windows&logoColor=white)](#architecture)

[Quick start](#quick-start) · [How Exoproc works](#how-exoproc-works) · [What you can inspect & instrument](#what-you-can-inspect--instrument) · [Showcases](#showcases) · [MCP tool catalog](#mcp-tool-catalog) · [CLI reference](#cli-reference) · [FAQ](#faq) · [Architecture](#architecture)

</div>

```bash
# Node.js
npx -y exoproc

# Bun
bun x exoproc

# Windows (PowerShell)
powershell -c "irm https://exoproc.woldan.me/install.ps1|iex"
```

> [!IMPORTANT]
> Exoproc targets native **Windows x64** process runtime. Development and offline operations (C-to-shellcode JIT compilation, machine code simulation, and MCP schema generation) run cross-platform. Live instrumentation commands (`nthread`, `minhook`, memory manipulation, desktop inspection) run natively on Windows x64.

---

See a feature in a native Windows application that you want to inspect or reverse engineer? Want your AI agent to debug a live process, read internal state, or intercept API calls in real time?

**Exoproc connects your AI coding agent directly to Windows x64 process internals.** It equips agents (Claude Code, Cursor, Windsurf, Claude Desktop, Antigravity, VS Code Cline, OpenCode, Zed) with a 22-tool Model Context Protocol (MCP) server and a standalone terminal CLI.

Analysis and instrumentation run locally with **zero DLL injection** and **no `CreateRemoteThread`**.

---

## Quick start

### Installation & Agent Setup

Choose your preferred way to run or configure Exoproc:

#### Option 1: Zero-Install via Node.js (`npx`)

Works out-of-the-box on machines with Node.js (`>=18.0.0`). Transparently fetches the native Windows x64 AOT engine without requiring Bun:

```bash
# Interactive setup wizard
npx -y exoproc

# Auto-configure all detected AI agents
npx -y exoproc setup --yes
```

#### Option 2: Zero-Install via Bun (`bun x`)

Runs natively with Bun for high performance:

```bash
# Interactive setup wizard
bun x exoproc

# Auto-configure all detected AI agents
bun x exoproc setup --yes
```

#### Option 3: Windows Automated Installer (PowerShell)

Installs Bun if missing, sets up the global `exoproc` CLI command in your PATH, and runs the agent setup wizard:

```cmd
powershell -c "irm https://exoproc.woldan.me/install.ps1|iex"
```

#### Option 4: Standalone Windows x64 Native Binary (`exoproc.exe`)

No Node.js and no Bun required! Download the pre-compiled Ahead-Of-Time (AOT) executable directly from [GitHub Releases](https://github.com/w0ldan/exoproc/releases/latest) and run:

```cmd
exoproc.exe setup --yes
```

The wizard automatically discovers installed agents on your machine, writes portable stdio MCP configurations with automatic backups, and installs tailored agent instructions and skills. Restart your agent afterward.

Setup supports Claude Code, Cursor, Windsurf, Claude Desktop, Antigravity, VS Code Cline, OpenCode, and Zed.

### Ask your agent

Once configured, ask your AI agent to inspect or automate any running application:

```text
Find the running Notepad process, inspect its main Edit control, read the text,
install a MinHook detour on its message handler, and take a screenshot.
```

Your agent will seamlessly invoke `list_processes`, attach with `open_accessor`, execute Win32 code via `execute_code`, capture a screenshot, and cleanly detach with `close_accessor`.

### Use the terminal

Exoproc provides a unified command-line tool for developers:

```bash
# List running processes on the system
exoproc ps

# Enumerate desktop windows and child edit controls
exoproc windows

# Compile C code directly into standalone x86_64 machine code / shellcode
exoproc compile -s "int add(int a, int b) { return a + b; }"

# Execute C-style Win32 code inside a target process
exoproc exec "MessageBoxW(0, L'Hello from Exoproc', L'Exoproc', 0);" --pid 1234

# Capture a desktop or window screenshot (PNG)
exoproc screenshot screen.png

# Check system health and configured AI agents
exoproc doctor
```

Once installed globally, the `exoproc` command is immediately available in your PATH. Alternatively, run any command ad-hoc via `npx` or `bun x`:

```bash
# Node.js
npx exoproc ps
npx exoproc windows
npx exoproc doctor

# Bun
bun x exoproc ps
bun x exoproc windows
bun x exoproc doctor
```

### Update Exoproc

To update Exoproc and refresh all agent configurations:

```bash
# Node.js
npx -y exoproc@latest setup --yes

# Bun
bun x exoproc@latest setup --yes

# PowerShell
powershell -c "irm https://exoproc.woldan.me/install.ps1|iex"
```

---

## How Exoproc works

Your agent communicates with Exoproc through the standard Model Context Protocol (MCP) over pure `stdio`. Exoproc executes native Windows x64 operations directly using thread context redirection, memory allocation, and JIT compilation:

```
┌─────────────────────────────────────────────────────────────┐
│  AI Agents (Claude Code, Cursor, Antigravity, Windsurf)     │
└──────────────────────────────┬──────────────────────────────┘
                               │  stdio (JSON-RPC 2.0)
┌──────────────────────────────▼──────────────────────────────┐
│  Exoproc Unified CLI & MCP Server (exoproc)                 │
├─────────────────────────────────────────────────────────────┤
│  • Memory Engine (read, write, alloc, scan AOB)             │
│  • MinHook Detours (5-byte JMP + far relay trampolines)     │
│  • NThread Engine (thread hijacking via Get/SetThreadCtx)   │
│  • TinyCC JIT (C source → relocatable x86_64 shellcode)     │
│  • Win32 C-Style Scripting & Struct Marshalling             │
│  • Desktop Window Discovery & PNG Capture                   │
└──────────────────────────────┬──────────────────────────────┘
                               │  Win32 Debug / Memory APIs
┌──────────────────────────────▼──────────────────────────────┐
│  Target Windows x64 Process (zero DLL injection)            │
└─────────────────────────────────────────────────────────────┘
```

### Core Architecture Highlights

1. **Zero DLL Injection:** Never drops a DLL to disk or forces `LoadLibrary` into target processes.
2. **No `CreateRemoteThread` Required:** `nthread` executes remote calls by temporarily parking an existing thread at a system sleep stub (`jmp $`), updating `RIP`/registers via `SetThreadContext`, and returning safely via a `ret` stub.
3. **5-Byte JMP Trampoline Detours (`minhook`):** True MinHook-style 5-byte relative `JMP` hooks with automatic prologue decoding via Capstone, branch relocation, and 14-byte far-detour relays (`jmp [rip+0]`) for arbitrary distances (>2GB).
4. **Embedded TinyCC JIT:** Compiles C snippets directly into raw x86_64 machine code, ready for execution, simulation, or remote process injection.
5. **Deterministic Simulation:** Emulates x86_64 CPU instructions and NT syscalls completely in memory for offline verification.
6. **On-Demand Binary Caching & Integrity:** External binaries (`capstone.dll`, ECJ compiler JARs, Tiny-Remapper) are downloaded lazily on first use into `~/.cache/exoproc/deps/` with full SHA-1/SHA-256 cryptographic checksum verification. Published npm packages remain ultra-lightweight (<1MB).

---

## What you can inspect & instrument

| Capability                  | What Exoproc Provides                                                            | Underlying Mechanism                                     |
| :-------------------------- | :------------------------------------------------------------------------------- | :------------------------------------------------------- |
| **Live Win32 Processes**    | Discover PIDs, thread counts, command lines, module bases, and architecture      | `CreateToolhelp32Snapshot`, `Process32NextW`             |
| **Virtual Memory**          | Read, write, allocate, protect, and query memory regions                         | `VirtualAllocEx`, `VirtualProtectEx`, `VirtualQueryEx`   |
| **AOB Pattern Scanning**    | Fast pattern scanning with wildcards (`?`) across module regions                 | Optimized SIMD-accelerated byte search (`memmem`)        |
| **Function Detours**        | Intercept Win32 APIs and internal functions with 5-byte relative JMP trampolines | `minhook` with Capstone prologue relocation & far relays |
| **Thread Hijacking**        | Execute functions inside the target using an existing thread                     | `nthread` via `SuspendThread` + `SetThreadContext`       |
| **C-to-Shellcode JIT**      | Compile C source into standalone, relocatable x86_64 machine code                | Embedded TinyCC JIT + Capstone disassembly               |
| **C-Style Win32 Scripting** | Execute code with Win32 `#define` constants, structs, and out-params             | Ambient runner context with AST auto-wrapping            |
| **Desktop Windows & UI**    | Discover HWNDs, titles, classes, and child `Edit` controls                       | `EnumWindows`, `EnumChildWindows`, `GetWindowTextW`      |
| **Window Screenshots**      | Capture desktop or specific window rects directly to PNG                         | GDI `BitBlt` capture + lightweight PNG encoding          |
| **JVM / JNI Analysis**      | Inspect JARs, extract classes, methods, fields, and bytecode                     | Headless JVM reflection and class-model inspector        |
| **Deterministic Emulation** | Simulate x86_64 machine code execution and track register/memory state           | In-memory Win64 CPU machine and syscall emulator         |

---

## Showcases

### Showcase 1: Live Notepad Keystroke Hooking (MinHook Detour)

Intercept Notepad's window procedure using a 5-byte MinHook detour. The original instructions are relocated to a near-allocated trampoline, while the detour function captures keystrokes and forwards execution seamlessly:

```typescript
// AI Agent installs detour via minhook_install
await minhook_install({
  session: 'notepad.exe',
  target: 'user32.dll!SetWindowTextW',
  detourMachineCode: shellcodeHex,
});
```

- Target function remains valid and fully callable via the generated trampoline.
- Automatic 14-byte far relay allocated if the detour sits >2GB away.
- Hot-swappable and reversible with `minhook_remove`.

### Showcase 2: Thread Context Hijacking Without DLL Injection (`nthread`)

Execute arbitrary Win32 API calls inside a remote process without spawning a remote thread:

```typescript
// nthread suspends a thread, parks it at a jmp $ stub, sets RIP/RCX/RDX,
// resumes it, and captures RAX upon return:
const res = await nthread_call({
  session: 'target.exe',
  function: 'kernel32.dll!GetCurrentProcessId',
  args: [],
});
console.log('Remote PID:', res.returnValue);
```

### Showcase 3: On-the-Fly C-to-Shellcode JIT Compilation

Compile C code to relocatable x86_64 machine code and disassemble it:

```bash
exoproc compile -s "int add(int a, int b) { return a + b; }"
```

Output:

```
Successfully compiled x86_64 machine code (18 bytes):
Hex: 554889e54881ec20000000e8d6ffffffc9c3

Disassembly:
  0x1000: push      rbp
  0x1001: mov       rbp, rsp
  0x1004: sub       rsp, 0x20
  0x100b: call      0xfe6
  0x1010: leave
  0x1011: ret
```

### Showcase 4: Live C-Style Win32 Scripting with Automatic Marshalling

Execute Win32 scripts with standard C structs, string buffers, and out-parameters:

```typescript
// AI Agent executes directly in target process via execute_code
await execute_code({
  session: 'notepad.exe',
  code: `
    RECT rc;
    GetWindowRect(HWND, &rc);
    print("Window bounds: " + rc.left + ", " + rc.top + " - " + rc.right + ", " + rc.bottom);

    StringBuffer buf(256);
    GetWindowTextW(HWND, buf, 256);
    print("Current Title: " + buf.toString());
  `,
});
```

---

## MCP tool catalog

Exoproc exposes **22 high-performance tools** over standard Model Context Protocol (stdio):

| Category                 | Tool                 | Description                                                        |
| :----------------------- | :------------------- | :----------------------------------------------------------------- |
| **Process Discovery**    | `list_processes`     | Discover running processes with PIDs, names, and thread counts     |
|                          | `spawn_process`      | Spawn a target process de-elevated with arguments                  |
|                          | `execute_command`    | Execute shell commands and capture stdout/stderr                   |
| **Session Lifecycle**    | `open_accessor`      | Attach to a target process via PID or image name                   |
|                          | `close_accessor`     | Detach and clean up allocated remote buffers                       |
| **Memory Manipulation**  | `read_memory`        | Read memory as hex, raw bytes, UTF-8/UTF-16 strings, or numbers    |
|                          | `write_memory`       | Write raw bytes, strings, or numbers into target memory            |
|                          | `scan_pattern`       | Search memory for byte patterns with wildcards (`48 8B ? ? 48 85`) |
|                          | `allocate_memory`    | Allocate executable, read/write, or protected virtual memory       |
| **Function Detours**     | `minhook_install`    | Install a 5-byte relative JMP detour with trampoline and far relay |
|                          | `minhook_remove`     | Restore original bytes and clean up detour trampolines             |
|                          | `list_hooks`         | Enumerate all active detours and trampolines                       |
| **Thread Hijacking**     | `nthread_call`       | Invoke a remote function via live thread context redirection       |
| **C JIT & Compilation**  | `compile_c`          | JIT-compile C code into standalone x86_64 shellcode via TinyCC     |
|                          | `compile_shellcode`  | Alias for `compile_c` with automatic remote target injection       |
|                          | `disassemble`        | Disassemble hex bytes into x86_64 assembly via Capstone            |
| **Simulation & Testing** | `simulate_run`       | Deterministically simulate machine code execution in memory        |
| **Win32 Execution**      | `execute_code`       | Execute C-style Win32 code inside the remote target process        |
|                          | `execute_local_code` | Execute Win32 code in the local runner process                     |
| **Desktop Inspection**   | `list_windows`       | Enumerate desktop windows, HWNDs, titles, and child edit controls  |
|                          | `take_screenshot`    | Capture desktop or window rect directly to PNG                     |
| **JVM Analysis**         | `jvm_inspect_jar`    | Inspect JAR contents, classes, methods, and bytecode signatures    |

---

## Supported AI agents

`exoproc setup` automatically detects, backs up, and registers with:

| Agent / IDE              | Configuration Target                       | Installed Skills & Rules                                               | Transport |
| :----------------------- | :----------------------------------------- | :--------------------------------------------------------------------- | :-------- |
| **Claude Code**          | `~/.claude.json`                           | `~/.claude/skills/exoproc/SKILL.md`<br>`~/.claude/commands/exoproc.md` | Stdio     |
| **Cursor**               | `~/.cursor/mcp.json`<br>`.cursor/mcp.json` | `~/.cursor/rules/exoproc.mdc`                                          | Stdio     |
| **Windsurf**             | `~/.codeium/windsurf/mcp_config.json`      | Global Tool Discovery                                                  | Stdio     |
| **Claude Desktop**       | `claude_desktop_config.json`               | Native Stdio MCP Server                                                | Stdio     |
| **Antigravity / Gemini** | `~/.gemini/antigravity/mcp_config.json`    | `~/.gemini/antigravity/skills/exoproc/SKILL.md`                        | Stdio     |
| **VS Code Cline**        | `cline_mcp_settings.json`                  | Native MCP Configuration                                               | Stdio     |
| **OpenCode**             | `~/.config/opencode/opencode.json`         | Global Tool Integration                                                | Stdio     |
| **Zed**                  | `~/.config/zed/settings.json`              | `context_servers.exoproc`                                              | Stdio     |

---

## CLI reference

```
Usage:
  exoproc <command> [options]

Core Commands:
  setup              Configure AI agents with Exoproc MCP server & skills
  mcp                Run the Model Context Protocol (MCP) server over stdio
  doctor, status     Inspect host environment, AI agents, and binary SHA checksums

Diagnostics & Tools:
  ps                 List active processes on target system
  windows            List visible desktop windows & child edit controls
  screenshot [path]  Capture desktop or window screenshot (PNG)
  compile <code|file> Compile C source to x86_64 machine code / shellcode
  exec <code>        Execute C-style Win32 code snippet (--pid <pid> for remote)
  run <script.ts>    Execute automation or diagnostics script

Global Options:
  --help, -h         Show help message
  --version, -v      Show Exoproc version
  --yes, -y          Automatically approve prompts (for setup)
  --dry-run          Preview changes without writing to disk
```

---

## FAQ

<details>
<summary><strong>Which AI agents can use Exoproc?</strong></summary>

Any AI coding agent that supports the standard Model Context Protocol (MCP) over stdio. Running `npx -y exoproc`, `bun x exoproc`, `exoproc.exe setup`, or the PowerShell installer automatically detects and configures Claude Code, Cursor, Windsurf, Claude Desktop, Antigravity, Cline, OpenCode, and Zed. Other clients can register `exoproc mcp` manually.

</details>

<details>
<summary><strong>Do I need to inject a DLL into the target process?</strong></summary>

No. Exoproc operates completely without DLL injection. All memory manipulation, thread redirection (`nthread`), and function detour patching (`minhook`) occur from outside the process using standard Win32 debug and memory primitives.

</details>

<details>
<summary><strong>What happens if a detour target is further than 2GB away?</strong></summary>

A standard x86_64 relative `JMP` can only reach addresses within ±2GB (`rel32`). When the target detour address exceeds this distance (such as jumping to an existing system DLL function), `minhook` automatically allocates a 14-byte far relay stub (`jmp [rip+0]; <absolute 64-bit address>`) near the target and points the 5-byte JMP at the relay. Near detours still receive direct, low-latency relative JMPs.

</details>

<details>
<summary><strong>How does `nthread` execute calls without CreateRemoteThread?</strong></summary>

`nthread` suspends an existing thread in the target process, saves its context (`GetThreadContext`), points its `RIP` to a shared sleep stub (`jmp $`), sets register arguments (`RCX`, `RDX`, `R8`, `R9`, `XMM0-XMM3`), resumes the thread, and waits for it to execute and return safely via a `ret` stub. The original thread context is fully restored after each call.

</details>

<details>
<summary><strong>Can I compile C code directly to shellcode?</strong></summary>

Yes. Exoproc embeds a TinyCC JIT compiler that converts standard C source code into standalone, relocatable x86_64 machine code. You can disassemble the output with Capstone, test it in the deterministic simulator, or inject it directly into a target process.

</details>

<details>
<summary><strong>Does Exoproc work offline without an internet connection?</strong></summary>

Yes. Exoproc runs 100% locally on your machine. No telemetry, no external servers, and no background daemon ports.

</details>

---

## Architecture

Exoproc is structured as a modular TypeScript monorepo targeting Windows x64:

```
packages/
├── xffi/                # Low-level Win64 FFI, C-ABI types, memory accessors, TinyCC JIT
├── win32/
│   ├── api/             # Typed Win32 wrappers (Process, Window, Module, Hook base)
│   └── abi/             # Win32 C constants, struct definitions, ABI offsets
├── nthread/             # Thread context hijacking without CreateRemoteThread
├── minhook/             # 5-byte JMP trampoline detours with far relays & Capstone
├── nshm/                # Shared memory transport and de-elevated process spawning
├── accessors/           # Composite accessors: memcmp-read, memset-write, process-cache
├── capstone/
│   ├── core/            # Capstone 4.0.2 disassembler with on-demand binary caching
│   └── abi/             # Capstone C-ABI types and instruction definitions
├── java/
│   ├── njava/           # JVM reverse engineering, JNI reflection, Java.type dynamic proxies
│   ├── jjit/            # Java 8/17+ in-memory compiler (ECJ) and Tiny-Remapper obfuscator
│   ├── agent/           # In-process Java bytecode injection agent (Exoproc.java)
│   ├── mappings/        # Obfuscation mapping pool resolver (Tiny v1, MCP, Mojang, SRG)
│   ├── runtime/         # Modular runtime execution context, Nashorn compatibility shims
│   └── nashorn/         # Dynamic Nashorn engine compatibility shims
├── simulate/            # Deterministic in-memory x86_64 CPU and Win32 syscall emulator
├── runner/              # Ambient execution context for C-style Win32 scripts
├── utils/               # Shared logging, cache, on-demand dependency downloader & SHA verification
├── exoproc-mcp/         # 22-tool Model Context Protocol server (pure stdio transport)
└── exoproc/             # Unified CLI, setup wizard, doctor diagnostics, and distribution
```

---

## Contributing & Monorepo Development

```bash
# Clone and install dependencies
git clone https://github.com/w0ldan/exoproc.git
cd exoproc
bun install

# Verify/download binary dependencies into persistent cache (~/.cache/exoproc/deps)
bun run deps

# Compile all 23 packages and generate declaration files
bun run build

# Multi-core TypeScript type check (340+ files across 23 projects)
bun run typecheck

# Run test suites
bun test

# Independent version bump for changed packages
bun run bump:changed
```

---

## Disclaimer

See [DISCLAIMER.md](DISCLAIMER.md) for responsible-use guidance.

Exoproc is designed for lawful research, debugging, reverse engineering, software preservation, and interoperability analysis of applications you own or are authorized to examine.

---

## License

[MIT](LICENSE) © Serkan

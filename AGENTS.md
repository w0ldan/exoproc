# AGENTS.md

This file provides guidance to AI coding agents (opencode, Claude Code, ...) when working with code in this repository.

## Project Purpose

**Exoproc** is a unified systems programming toolkit and Model Context Protocol (MCP) server for native Windows x64 reverse engineering, thread context hijacking (`nthread`), function redirection (`minhook` 5-byte JMP relative detour), memory manipulation, C-to-shellcode JIT compilation (TinyCC), and live Win32 process instrumentation.

It connects AI coding agents (Claude Code, Cursor, Windsurf, Claude Desktop, Antigravity, Cline, OpenCode, Zed) directly to Windows x64 process internals with zero DLL injection and no `CreateRemoteThread`.

**Current primary deliverables:**

1. **MCP Server (`packages/exoproc-mcp`)**: A standard stdio Model Context Protocol (MCP) server exposing 22 tools for process discovery, memory manipulation, live Win32 code execution, minhook detours, nthread hijacking, TinyCC C-to-shellcode compilation, Capstone disassembly, and desktop window inspection.
2. **Unified CLI & Setup (`packages/exoproc`)**: Self-contained CLI runner (`exoproc ps`, `windows`, `screenshot`, `compile`, `exec`, `run`, `doctor`) and automated agent configuration wizard (`exoproc setup`).
3. **Core Systems Stack (`xffi`, `winapi`, `nthread`, `minhook`)**: Foundational memory accessors, thread redirection without `CreateRemoteThread`, and trampoline generation with far-detour relays.

## Commands

```bash
# Install dependencies (also runs exoproc-utils deps caching postinstall)
bun install

# Manage/download binary dependencies (Capstone DLL, ECJ, Tiny-Remapper)
bun run deps
bun run deps:force    # re-download and re-verify all binary dependencies

# Build all packages
bun run build
bun run build:clean   # clean first, then build

# Independent version bump for changed packages only
bun run bump:changed
bun run bump:changed --dry-run
bun run bump:changed --all   # bump all packages simultaneously

# Run test suites
bun test                                           # all tests
bun test tests/exoproc-mcp/mcp.test.ts             # MCP tests
bun test tests/exoproc/cli.test.ts                 # CLI tests

# Type checking (all 23 packages & test suites)
bun run typecheck   # bun check && bun check -p tests/tsconfig.json

# Lint / format
bun run lint
bun run format
bun run format:check
```

## Requirements

- **Repository / Contributor Development:** Bun version `>=1.4.4`. Required for workspace developers who clone the repo to use native multi-core TypeScript type checking via `bun check` and native code formatting via `bun fmt`.
- **End-User / Package Consumer:** Standard Bun (`>=1.0.0`) or Node.js (`>=18.0.0`) via `bunx` / `npx`. Direct consumers of published packages do not run linter/typecheck toolchains and do not need Bun 1.4.4.

## Architecture

This is a **bun workspace monorepo** targeting the **Windows x64** runtime. Every package's `package.json` `"main"` points to `"./dist/index.js"` (a built artifact) and `"types"` points to `"./dist/index.d.ts"`, **not** `./src/index.ts`.

### Package dependency graph

```
exoproc-utils         (logger, cache, modular deps downloader, SHA-1/256 validator)
  ^
win32-abi             (Win32 C constants, struct definitions, ABI offsets)
  ^
bun-xffi              (low-level FFI foundation — C-ABI types, memory accessors, TinyCC JIT)
  ^
bun-winapi            (Win32 process/memory/thread/module/snapshot APIs + Hook base classes)
  ^
bun-capstone-abi / bun-capstone (Capstone 4.0.2 disassembler, x86_64 instruction decoding)
  ^
bun-nthread           (x64 thread redirection — no code injection, uses stubs;
  ^                    IndirectNThreadHostAccessor = indirect chain over an NThread backend)
bun-minhook           (function redirection: 5-byte JMP + trampoline/detour; needs allocNear)
  ^
bun-nshm              (Win32 shared memory transport & de-elevated process spawning)
  ^
exoproc-accessors     (composite accessors: memcmp-read, memset-write, process-cache)
  ^
win32-simulate        (in-memory x86_64 CPU emulation and Win32 syscall simulation)
  ^
exoproc-jjit          (Java 8/17+ in-memory compiler [ECJ] & bytecode obfuscation [Tiny-Remapper])
  ├── bun-njava       (JVM reverse engineering, JNI reflection, Java.type dynamic proxies)
  ├── njava-agent     (in-process Java agent for high-speed bytecode injection and reflection RPC)
  ├── exoproc-mappings(obfuscation mapping resolver: Tiny v1, MCP, Mojang, SRG, Spigot)
  ├── exoproc-runtime (modular runtime execution context, Nashorn compatibility shims)
  └── exoproc-nashorn (Nashorn engine shims for Java 15+)
  ^
exoproc-runner        (ambient execution context for C-style Win32 automation scripts)
  ^
exoproc-mcp           (22-tool Model Context Protocol server over stdio)
  ^
exoproc               (Unified CLI: `exoproc setup`, `doctor`, `mcp`, `ps`, `windows`, `screenshot`, `compile`, `exec`)
```

### xffi

The foundational layer. Key concepts:

- **`ffi` / `sizeof` / `alignmentof` / `compileStruct`** (`ffi.ts`) — C-ABI type system for Win64. `sizeof` and `alignmentof` understand primitive aliases (`HANDLE`, `DWORD`, etc.), arrays, nested structs, and unions.
- **`IMemoryAccessor` / `ISyncMemoryAccessor`** (`iaccessor.ts`) — interfaces all accessors implement. Methods: `read`, `write`, `alloc`, `allocNear`, `free`, `protect`, `query`, `scan`, `call`, `machineCode` (+ their `*Sync` twins). `accessor.machineCode(sc)` injects a `CMachineCode` and returns its remote address.
- **`AbstractMemoryAccessor`** (`accessor.ts`) — base class providing helper scalar R/W, debug wrapping, and scan utilities. Subclass this for custom accessors.
- **`MiddlewareAccessor` / `InittableMiddlewareAccessor`** (`middleware-accessor.ts`) — wraps another accessor; `InittableMiddlewareAccessor` adds lazy async `init()`/`deinit()` lifecycle. **Every** memory op (`read`, `write`, `alloc`, `free`, `protect`, `query`, `call`, **and `machineCode`**) is guarded by `!isInitializing → await this.init()` — each has an `XAfterInit` twin that forwards to the backend. (`machineCode` was historically missing this guard, so a `machineCode()`-first call routed down the chain before init: the backend wasn't hijacked/ready yet and `MsvcrtDependentMiddlewareAccessor.onInit`'s msvcrt check spuriously failed. Any new op MUST have the same guard.) `initNext()` skips backends that are already initializing (`!next.isInitializing` guard) to prevent deadlocks when `root.*` is called from within `onInit()`.
- **`allocNear` / `allocNearSync`** (`iaccessor.ts` + `accessor.ts`, pure helpers in `near-alloc.ts`) — accessor **method** (not a standalone fn) that finds/commits free memory within ±~2GB of a target address (for a 5-byte rel32 JMP), by walking `query()` results outward and honoring 64KB allocation granularity. The generic impl on `AbstractMemoryAccessor` uses `this.query()`/`this.alloc()`, so it composes cross-process for free through `CallRedirectorAccessor` (which overrides those). `CallRedirectorAccessor` also has an explicit **region-aware** `allocNear` override (jumps by `RegionSize` instead of naive 64KB steps) since each probe there is an expensive remote `call`.
- **`HostAccessor`** (`host-accessor.ts`) — orchestrating root accessor; initializes all `InittableMiddlewareAccessor` instances in the backend chain via `initNext()`.
- **`BootstrapHostAccessor`** (`middleware-accessor.ts`) — solves circular init dependencies. Starts with `target = this` (routes directly through its own backend, bypassing any middleware above), then after `initNext()` switches `target = root`. Required as root for any `InittableMiddlewareAccessor` (e.g. `CallRedirectorAccessor`) whose `onInit` needs `this.root.*` before the full chain above it is wired up.
- **`CallRedirectorAccessor`** (`middleware-accessor.ts`) — redirects `alloc/free/protect/query` to run inside the target process via `this.root.call(VirtualAlloc/VirtualFree/VirtualProtect/VirtualQuery)`.
- **`IndirectCallRedirectorAccessor`** (`middleware-accessor.ts`) — extends `CallRedirectorAccessor`; for `READWRITE` allocations without a specific address uses `MsvcrtImpl.malloc`/`MsvcrtImpl.free` instead of `VirtualAlloc`. Tracks malloc blocks locally to intercept `free`/`protect`/`query` on them.
- **`waitAsync(handle, timeoutMs)`** (`waiter.ts`) — non-blocking wait for a HANDLE to signal: polls `WaitForSingleObject(handle, 0)` in a loop with a backoff ramp (a few zero-delay instant checks, then 1ms up to a 10ms cap), yielding to the event loop via `setTimeout` between checks. No separate thread/Worker — every check is a real OS query, never a blocking wait, so the JS event loop is never wedged. Replaces the old `callAsync`/`QueueUserWorkItem`-based async call mechanism (`CFunction.callAsync`), which is gone entirely — it required JIT-compiled thread-pool-proc code and a threadsafe `JSCallback`, and hung indefinitely on real Windows because `QueueUserWorkItem`'s worker threads are native NT thread-pool threads Bun has no knowledge of (threadsafe callbacks are only reliable from a Bun `Worker`, per Bun's own docs). `waitAsync` sidesteps the whole problem by never leaving the calling thread.
- **`RemoteCallableMemoryAccessor`** (`callable-accessor.ts`) — creates a remote thread via `CreateRemoteThread` for each call. `call()` awaits `waitAsync()` on the thread handle so the event loop can process I/O while waiting instead of blocking.
- **`Stub` / `registerStub`** (`stub.ts`) — locates existing byte patterns (e.g. `C3` ret, `EB FE` sleep) in system DLLs. Stubs are shared across all processes at identical addresses, so they require no remote allocation. `shouldCloneForAccessor()` returns `false` for stubs. Internally built on `createMachineCode` so they are directly callable via a local accessor.
- **`createMachineCode(address, sig, bytes, callable?)`** (`cmachinecode.ts`) — wraps a known address+bytes+signature into a `CMachineCode`. `callable` defaults to a `BunCFunction` binding; pass a throwing function for remote-only machineCode. Used as the base for `cmachinecode()`, `createRemoteMachineCode()`, and `makeStub()`.
- **`CMachineCode` / `cmachinecode()`** (`cmachinecode.ts`) — user-supplied machineCode that _does_ require remote allocation. `shouldCloneForAccessor()` returns `true`. `cloneForAddress(addr)` returns a `CMachineCode` already at a remote address (`shouldCloneForAccessor() = false`).
- **`cimport`** (`cimport.ts`) — wraps Win32 symbols with `BunCFunction` bindings directly (no intermediate C `_wrapper` functions). `createCFunction(..., undefined)` creates the `BunCFunction`; dummy symbols get a throwing callable.
- **`CJit` / `cjitopen`** (`cjit.ts`) — JIT-compiles C snippets to a shared library at runtime using `bun:ffi` `cc()`. On import, `index.ts` registers default Win32 libraries (kernel32, ntdll, msvcrt, user32, gdi32, psapi) and common structs/defines into `cjitDefaults`.
- **`struct` / `union` / `Struct`** (`struct.ts`) — TypeScript class-based struct definitions with auto-computed offsets.
- **`win/`** — Pre-built `CImportLibrary` definitions for kernel32, ntdll, msvcrt, user32, gdi32, psapi, plus Win32 struct/define constants.

#### Middleware chain composition pattern

```
BootstrapHostAccessor (root, pid, outerHost)
  └─ .backend = RemoteCallableMemoryAccessor(pid)

CallRedirectorAccessor (or Indirect variant) (backend=RemoteCallableMemoryAccessor, root=bootstrap)
outerHost.backend = accessor  ← wired after construction
```

During `CallRedirectorAccessor.onInit()`-driven calls: bootstrap `target=this` → `root.call()` routes through `RemoteCallableMemoryAccessor` directly (isInitializing→skip init). After init: bootstrap `target=outerHost` → full chain active.

### winapi

Ergonomic wrappers over `xffi` Win32 calls:

- `Process`, `Module`, `Thread`, `Handle`, `Snapshot` — typed wrappers for Win32 handles and enumeration.
- `NativePointer` / `SyncNativePointer` — pointer types with address arithmetic.
- **Hook base classes** (`hook.ts`) — the OOP-handle model shared by `nhook` and `minhook`. **The hook API never takes a raw address** — it deals in typed function objects: `HookTarget = CFunction` (the function to hook; its `.args.length` is the default `argCount`) and `HookDetour = CFunction | CMachineCode` (a `CMachineCode` is injected on demand — `resolveDetour` in minhook — a plain `CFunction` is used as-is). `Hook.target` is the `CFunction`; `hook.address` (getter) resolves it to the patch address. `Hook` (abstract class) is a **thin forwarder handle**: it captures `memory` + `manager` at `create()` time, and `hook.enable()` / `hook.disable()` / `hook.destroy()` / `hook.toggle()` just forward into the manager (`manager.enable(memory, hook)` — that's where the real logic lives). Base `Hook.enable()` takes **no** detour (patch hooks don't redirect); `hook.argCount` is a getter over `target.args.length` (no stored field). Only `DetourHook` overrides `enable(detour?)`: its forwarder owns the remember/reuse logic (`if (!detour) detour = this.detour; else this.detour = detour`) and holds `detour?: CFunction` (the last detour, kept as a `CFunction`) — so an omitted detour reinstalls the last one, and the manager just installs whatever it's handed (throws if none). `PatchHook` adds `originalBytes`/`affectedLength`. `HookManager<T>` is a registry/factory (`create`/`register`/`forget`/`get`/`has`/`enableAll`/`disableAll`/`destroyAll` + the abstract `enable`/`disable`/`destroy` impls; `get`/`has`/`forget` also take a `CFunction`, not an address); `PollableHookManager` adds `poll`/`resume` (thread-parking styles); `InterceptHookManager` adds `callOriginal`/`getOriginalArgs`. Concrete handles (`NHookInstance`, `MinHookInstance`) are pure data — they never override the forwarders. Drive hooks via the handle, not `manager.enable(mem, hook)`.

### nthread

Thread redirection without `CreateRemoteThread` or machineCode allocation.

**Flow:** suspend target thread → save context → redirect `RIP` to a `jmp <reg>` stub → set that register to a `jmp $` (sleep) stub → resume → wait for thread to park at sleep stub → execute calls by setting `RIP`/`RCX`/`RDX`/`R8`/`R9` (and `XMM0`–`XMM3` for float/double args) and resuming → wait for return via a `ret` stub return chain.

**Argument passing (Windows x64 ABI):**

- Args 1–4: `f32`/`f64` → `XMM0`–`XMM3` (+ GPR bit-cast mirror for variadic compat); `int`/`ptr` → `RCX`/`RDX`/`R8`/`R9`.
- Args 5+: written to `[callRsp + 40 + (i-4)*8]`. NThread allocates a per-N-stack-arg stub (`add rsp, (0x28+N*8); ret`) in the remote process on first use and restores the original return chain in `finally` after each call. No hard cap on argument count.

**Return values:** `f32` → `XMM0` low 32 bits; `f64` → `XMM0` low 64 bits; everything else → `RAX`. `ContextFlags` includes `FLOATING_POINT` so the kernel saves/restores XMM state.

Key public stub accessors (synchronous, must await `whenReady()` first):

- `getRandomSleepAddress()` — `EB FE` (jmp $)
- `getRandomPushretAddress()` — push reg + ret
- `getRandomJumpAddress()` — jmp reg
- `getRandomRetAddress()` — `C3`
- `getRandomAddRsp28RetAddress()` — `add rsp, 0x28; ret`

**`NThread` is itself an `ICallableMemoryAccessor`** (extends `InittableMiddlewareAccessor`): read/write/alloc forward to its backend (`RemoteCallableMemoryAccessor`), only `call` is overridden to run via hijacking. During `onInit()` it issues bootstrap stub calls via `this.root`, so its root must wrap `NThread` itself (the `RedirectorHostAccessor` → `redirector.target = <the host>` cycle-breaker).

- **`IndirectNThreadHostAccessor`** (`indirect-nthread-host-accessor.ts`) — `extends IndirectCallableAccessor` with an `NThread` as the base callable backend instead of `RemoteCallableMemoryAccessor`. So the full indirect chain (IndirectCallRedirector malloc/memset + machineCode pool + memcmp/file-transfer + marshalling) runs with **every** remote op executed by redirecting a live thread — no `CreateRemoteThread`, no injected pipe-loop. Constructor: `new IndirectNThreadHostAccessor(pid, threadId, options?)`; it wires `nthreadRoot.target = this` (same pattern as `redirector.target = indirect` in the nthread integration test). Proven cross-process with `minhook` (see below), verified by an independent `RemoteCallableMemoryAccessor` reading the installed JMP via raw `ReadProcessMemory`.

### nhook (Archived on `feat/nhook`)

The experimental 2-byte inline hook (`EB FE` spin park + Capstone simulate displaced instructions) has been moved to the `feat/nhook` branch. In the active codebase, `minhook` is the primary production hooking engine.

### minhook

The active hooking strategy — a real MinHook-style trampoline/detour hook (5-byte relative JMP). Depends on `winapi` + `capstone`, **not** `nthread` — it accepts any `IMemoryAccessor`, so it works over `IndirectNThreadHostAccessor` (thread redirection backend), a `CreateRemoteThread`-based indirect chain, or a local accessor equally.

**Hooking strategy — 5-byte JMP + trampoline:**

- `buildTrampoline` (`trampoline.ts`) reads the target prologue, disassembles (Capstone), accumulates instructions until `>= 5` bytes are covered, refuses to hook if any stolen instruction is a branch, relocates RIP-relative operands, and `allocNear`s a trampoline (stolen bytes + `jmp rel32` back into the unmodified body) within rel32 reach of the target. `originalBytes` MUST be de-tainted via `Buffer.from(Array.from(prologue.subarray(...)))` — a raw read-backed buffer's association makes `disable()`'s restore write silently no-op on cross-process (ReadProcessMemory-backed) reads (same bug nhook's `create()` had).
- Two-phase `create(target)` / `enable(detour)`: `create()` builds the trampoline only (target untouched), so `hook.trampoline` is known before the caller compiles their detour (bake it in as a literal). `target` is a `CFunction`; the detour is a `CMachineCode` (injected on demand via `resolveDetour` → `memory.machineCode`, unless already-injected) or a `CFunction` — never a raw address. `enable()` is idempotent + hot-swappable (re-call with a different detour to re-target the JMP).
- **Far-detour relay:** if the resolved detour is outside the 5-byte JMP's rel32 range (e.g. an existing kernel32 function like `GetCurrentThreadId`, which sits beyond ±2GB from an injected target), `enable()` `allocNear`s a 14-byte relay stub near the target (`jmp qword ptr [rip+0]; <abs u64>`), points the JMP at the relay, and the relay absolutely jumps to the far detour (`MinHookInstance.relay`, lazily allocated, rewritten on hot-swap, freed in `destroy()`). Near detours still get a direct JMP. This is real MinHook's gateway/relay behavior; it's what lets _any_ `CFunction` be a detour regardless of distance. Drive via the handle: `const h = await minhook.create(mem, targetFn); await h.enable(detourSc); await h.disable(); await h.destroy();` (see the Hook base classes in `winapi`). Verified cross-process by `tests/minhook/minhook-indirect-nthread.test.ts`, which injects a function into a spawned `TestProcess` target, hooks it over `IndirectNThreadHostAccessor`, and _invokes_ it on the hijacked thread — a passthrough detour returns the original value (proving the trampoline), a `return 1234` detour overrides it (proving execution) — cross-checked by an independent raw `ReadProcessMemory` read of the installed JMP.

### njava

JVM instrumentation and runtime reflection layer:

- **`Java.type(className)`** — Nashorn-compatible dynamic class proxy resolving static methods, fields, constructors, and nested classes. Works across obfuscated targets via `njava-mappings`.
- **`AgentBridge` vs. `ReflectionBridge`** — `ReflectionBridge` operates via in-memory JNI calls without modifying the JVM target; `AgentBridge` connects to the in-process `Exoproc.java` agent for high-speed bytecode injection and reflection RPC.
- **Exception Unwrapping** — Java `Throwable` instances (e.g. `ClassNotFoundException`, `InvocationTargetException`) are automatically caught, unwrapped, and converted into standard JavaScript `Error` objects so that normal TypeScript `try { ... } catch (err: any)` blocks handle JVM exceptions naturally.
- **Nashorn Compatibility** — Provides shims for `Java.type`, `Java.from`, `Java.to`, and standard global primitives even on Java 15+ where Nashorn was removed from the JDK.

### exoproc & exoproc-mcp

The high-level CLI, setup engine, and Model Context Protocol (MCP) server:

- **`exoproc-mcp`** — Dedicated stdio Model Context Protocol server exposing 22 high-performance tools (`list_processes`, `spawn_process`, `open_accessor`, `close_accessor`, `read_memory`, `write_memory`, `scan_pattern`, `allocate_memory`, `list_hooks`, `minhook_install`, `minhook_remove`, `nthread_call`, `execute_code`, `execute_local_code`, `execute_command`, `simulate_run`, `disassemble`, `compile_c`, `compile_shellcode`, `jvm_inspect_jar`, `list_windows`, `take_screenshot`). Pure stdio transport, zero ports, zero background daemon.
- **`exoproc`** — Unified binary and CLI (`packages/exoproc`). Provides:
  - `exoproc setup` — Multi-agent setup wizard detecting and configuring Claude Code, Cursor, Windsurf, Claude Desktop, Antigravity, Cline, OpenCode, and Zed.
  - `exoproc doctor` — Host environment, AI agent configuration, and binary dependencies SHA checksum diagnostics.
  - `exoproc mcp` — Runs the stdio MCP server.
  - `exoproc ps`, `windows`, `screenshot`, `compile`, `exec`, `run` — Terminal diagnostics tools.

### Binary Dependency Management & On-Demand Caching

External native binaries (`capstone.dll`, ECJ compiler JARs, Tiny-Remapper JAR) are managed through modular `deps.json` files and cached locally on demand:

- **Lightweight Distribution:** Published npm tarballs do not bundle large binaries (under 1MB package footprint).
- **Central OS Cache:** Resolved via `getDepsCacheDir()` in `exoproc-utils` to:
  - Linux/macOS: `$XDG_CACHE_HOME/exoproc/deps/` or `~/.cache/exoproc/deps/`
  - Windows: `%LOCALAPPDATA%\exoproc\cache\deps\`
- **Modular `deps.json` Definitions:**
  - `packages/capstone/core/deps.json`: `capstone.dll` (Win64) with SHA-1 and SHA-256.
  - `packages/java/jjit/deps.json`: `ecj-3.26.0.jar` (Java 8), `ecj-3.46.100.jar` (Java 17+), and `tiny-remapper-0.14.1-fat.jar`.
- **On-Demand First-Use Download:** When a tool requiring an external binary is invoked (`findCapstoneDll()`, `resolveEcjJarPath()`, `resolveTinyRemapperJarPath()`), `resolveOrDownloadDepSync()` checks the persistent cache. If missing, it downloads from the verified URL, validates SHA-1/SHA-256 hashes, performs surgical extraction if in a zip archive, and stores it in the central cache for subsequent zero-latency access.
- **SHA Verification in `exoproc doctor`:** `runDoctor()` invokes `inspectAllDeps()`, computing hashes on all existing binaries and comparing against expected SHA-1/SHA-256 values. If any binary is modified or corrupted, `status: 'mismatch'` is triggered with an `error` health status.

### Independent Package Versioning

Packages in the monorepo version independently using `scripts/bump-changed.ts`:

- **Command:** `bun run bump:changed` (or `bun run bump:changed --dry-run`).
- **Intelligence:** Inspects `git status --porcelain` and `git diff HEAD~1 HEAD`, mapping changed source files and package-specific test suites (`tests/<package>/*`) to their owning package.
- **Surgical Bumps:** Only packages with real code or test changes have their version bumped (`patch`, or `--type=minor|major`). Untouched packages keep their current stable version. The Monorepo Root version tracks root workspace configuration changes.
- **CI / Publishing:** Direct publish via `changeset publish` respects each package's independent version.

### Testing

- Tests live in `tests/<package>/`.
- `tests/setup.ts` is the global prelude (loaded via bun config); loads `.env` via `dotenv` and provides an `afterAll` grace period for thread cleanup.
- `tests/helpers.ts` provides `TestProcess` (spawns `ping.exe` directly in its constructor via `bun-nshm`'s de-elevated `spawnDeElevatedProcess` -- the same `CreateProcessAsUserA` mechanism `nshm`'s own dummy relay process uses, not `child_process.spawn` -- fixed 60s duration; `pid`/`handle` are plain instance fields, no `start`/`startPing` methods). **Must stay `ping.exe`** (or another process whose threads periodically return to user mode on their own): `nthread`'s hijack redirects RIP via `SetThreadContext`, which only takes effect once the hijacked thread actually returns to user mode, so it requires a target thread that does so on a short cycle (`ping.exe`'s ~1s timer wait between echoes). A thread parked in an indefinite, event-driven kernel wait -- e.g. `cmd.exe`'s main thread blocked in `ReadConsoleInput` with nothing ever typed into it -- never returns on its own, so the hijack times out waiting for it to land at the sleep stub. `TestNotepadProcess` (spawns `notepad.exe`) is a separate case, for tests/examples needing a real visible window.
- **Commits:** Husky hooks are fully active and passing cleanly. Pre-commit runs `bun fmt --staged`. Commit messages must follow Conventional Commits format (e.g. `feat(scope): message` or `fix(scope): message`) checked by `commitlint`.

#### Systems Programming Gotchas & Best Practices

- **Thread Hijacking Execution:** Never run heavy WinAPI/CRT calls directly on an unstable or freshly-spawned thread — drive them through `IndirectNThreadHostAccessor(pid, tid)` on an existing thread of a target process (`TestProcess`) instead.
- **Remote Thread Parameters:** `RemoteCallableMemoryAccessor.call()`/`callSync()` delivers a single pointer/argument via `CreateRemoteThread`'s `lpParameter` — multi-argument calls require stub trampoline chains or `nthread`.
- **Cross-Package Builds:** Every package exports from `./dist/index.js`. After modifying a `packages/*/src/` file consumed cross-package, run `bun run build` so that consuming packages see the updated build artifacts and types.
- **Cross-Package Type Identity:** When checking instances across package boundaries, assert by `instance.constructor.name` rather than `instanceof` to prevent cross-module symbol duplication mismatches.
- **Process Cleanup:** Ensure test processes (`TestProcess`, spawned target instances) terminate cleanly after test suites complete to prevent dangling handles from blocking subsequent runs.

### Adding a new workspace package

When creating a package under `packages/<name>`:

1. Add `"<name>": ["packages/<name>/src/index.ts"]` to `paths` in the root `tsconfig.json`.
2. Add `{ "path": "./packages/<name>" }` to `references` in the root `tsconfig.json`.
3. Create `packages/<name>/tsconfig.json` extending `../../tsconfig.json` (copy from an existing package).
4. If any test files import it by package name, the steps above are required — Bun uses tsconfig paths for workspace resolution.

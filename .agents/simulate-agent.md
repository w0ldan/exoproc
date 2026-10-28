---
name: simulate-agent
description: Expert agent — focused on packages/simulate/** and tests/simulate/**. Recognizes the x64 simulation engine, virtual OS runtime, builtin binary compiler, Win32 DLL shims, and C-subset compiler work. Does not touch apps/docs/**; routes to frontend-agent instead.
scope: packages/simulate/**, tests/simulate/**
subagent_type: general
tools: [read, write, edit, bash, glob, grep]
---

# Simulate Agent — `@exoproc/simulate` Expert

The full responsibility for `packages/simulate/**` belongs to this agent. It **recognizes, plans, implements, and verifies** the tasks below on its own. When work falls outside its scope, it hands off **explicitly** to the orchestrator.

## Area map

| Path                                                                | Content                                  | Notable symbols                                                                                                                                                                                                                            |
| ------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/runtime/`                                                      | Virtual OS kernel                        | `Win64Machine`, `Win64Process`, `X64Cpu`, `Win64AddressSpace`, `PhysicalMemory`, `Programs` (scheduler), `Win32Dlls`, `FileSystem`, `Network`, `Console`, `VideoOutput`, `Environment`, `MemoryScanner`, `CommandPrompt`, `Heap`, `BunFfi` |
| `src/runtime/win64-machine.ts`                                      | Main runtime orchestrator (deg=82)       | `registerKernelHandlers`, syscall dispatch, `bindWin64Process`                                                                                                                                                                             |
| `src/bin/compiler.ts`                                               | x64 Assembler + instruction emit         | `X64Assembler`, `mov`, `qword`, `byte`, `word`, `isRegister`, `assertSameWidth`, `encodedWord`                                                                                                                                             |
| `src/bin/{ls,cd,cat,echo,cls,cmd,ping,set,where,whois,pwd,path}.ts` | Built-in commands                        | Each compiled via its own `compile*Exe`                                                                                                                                                                                                    |
| `src/bin/dll/{msvcrt,kernel32,user32,gdi32,psapi,advapi32}.ts`      | Win32 DLL compile-stream implementations | `compileStreamIo`, `compilePrintf`, …                                                                                                                                                                                                      |
| `src/bin/system32.ts`                                               | `system32` aggregate (deg=30)            | Combines all DLLs into a single binary                                                                                                                                                                                                     |
| `src/worker/c-subset-compiler.ts`                                   | C-subset → x86_64 compiler               | `CType`, type system, AST lowering                                                                                                                                                                                                         |
| `src/worker/c-subset-codegen.ts`                                    | C-subset code generator                  | `FunctionCompiler`                                                                                                                                                                                                                         |
| `src/worker/cc-shim.ts`                                             | `cc`/`gcc` shim                          | cross-compile entry                                                                                                                                                                                                                        |
| `src/worker/bundler.ts`                                             | Bundle pipeline                          | Joins multiple .c/.h sources into a single ELF/PE                                                                                                                                                                                          |
| `src/worker/enter-simulated-process.ts`                             | Simulated process entry                  | First RIP setup                                                                                                                                                                                                                            |
| `src/worker/lifecycle.ts`                                           | Process lifecycle                        | start/stop/exit                                                                                                                                                                                                                            |
| `src/worker/node-*-shim.ts`                                         | node:* shims (fs, os, crypto)            | Prevents host API leakage                                                                                                                                                                                                                  |

| `src/host/console-screen-presenter.ts`, `node-console-screen.ts` | xterm-based output | For `Win64Screen` consumers |
| `src/index.ts` | Public exports | See below |
| `scripts/inspect-artifacts.ts` | ELF/PE disassembler (deg=63) | `AnnotatedLlRelocation`, `ProgramSectionLayout`, `BranchSize`, `Disassemble` |
| `scripts/cli.ts`, `scripts/run-cmd.ts` | CLI runners | Interactive prompt and simulated command execution |

Public export order (`src/index.ts`): `types`, `address-space`, `physical-memory`, `x64-cpu`, `video-output`, `console`, `network`, `file-system`, `environment`, `programs`, `scheduler`, `bin`, `win32-dlls`, `win64-machine`, `memory-scanner`, `command-prompt`, `bun-ffi`, `console-screen-presenter`.

## Recognized tasks (automatic dispatch)

| Trigger signal                                   | Work to do                                                                                                                                                                       |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New syscall / kernel handler under `runtime/`    | Add handler in `win64-machine.ts`, route to the right module in `Win32Dlls`/`FileSystem`/`Network`/`Environment`/`Console`, follow the existing `registerKernelHandlers` pattern |
| New builtin under `bin/` (e.g. `whoami`, `date`) | Single file, `compile*Exe` function, export from `bin/index.ts`, add to the `bin/system32.ts` aggregate if applicable                                                            |
| New function in `bin/dll/*`                      | `compile*` factory, dispatch table in `Win32Dlls`, runtime counterpart in `win32-dlls.ts` if needed                                                                              |
| `worker/c-subset-*` change                       | C grammar, lowering, codegen — `c-subset-compiler.ts` + `c-subset-codegen.ts` pair, fixtures under `tests/simulate`                                                              |
| `worker/bundler` change                          | Section layout, link, entry selection — coordinate with `inspect-artifacts.ts`                                                                                                   |
| New analysis in `scripts/inspect-*`              | Add command to `inspect-artifacts.ts`, parse CLI args                                                                                                                            |
| Output issue in `host/`                          | `console-screen-presenter.ts` / `node-console-screen.ts` — xterm integration                                                                                                     |
| **New test**                                     | Add it under `tests/simulate`; Bun runs source tests, while `npm test` runs only the `*.node.test.ts` subset after `tests:build`                                                 |
| Build error                                      | `bun run build` and `bun --filter @exoproc/simulate build`                                                                                                                       |
| Lint error                                       | `bun run lint` and `bun --filter @exoproc/simulate lint`                                                                                                                         |

## Unrecognized tasks → handoff

- **Any change under `apps/docs/**`** → tell orchestrator "delegate to frontend-agent". If simulate's public API changed and consumer sites need updating, use this format:
  ```
  NEXT_ACTION: handoff:frontend-agent
  CONTEXT: <public API change in simulate>
  CONSUMERS: <file paths in apps/docs that need updating>
  ```
- **Other packages** (`nhook`, `minhook`, `nthread`, …) → hand off to orchestrator.
- **Test infrastructure** (`tests/`) → hand off to orchestrator.

## Boundary rules (STRICT)

1. **Never** write or edit anything under `apps/docs/**`. (Only when simulate's public API changed and consumer sites must be updated, notify the orchestrator using the handoff format above.)
2. `packages/simulate/dist/**` and `packages/simulate/artifacts/**` are build artifacts — do not edit them by hand. Change the build pipeline and run the build.
3. `packages/simulate/scratch/**` is a working area — you may place temporary files there; they will not be deleted without the user's consent.
4. Cross-package imports: `win32-abi` is allowed; imports from other packages are **forbidden** (simulate is a consumer, not a producer).
5. If a public API change (`src/index.ts` exports) is breaking, you **MUST** notify via handoff.

## Working protocol

1. **Plan**: Summarize the task in 1-3 steps. Do not start a large refactor without user approval.
2. **Search**: Use targeted symbol and path searches under `packages/simulate/**` and `tests/simulate/**` before editing.
3. **Write**: Keep all writes under `packages/simulate/`.
4. **Verify**:
   - `bun --filter @exoproc/simulate build`
   - `bun --filter @exoproc/simulate test` (Bun)
   - `bun --filter @exoproc/simulate test:node` (Node fallback, C subset compatibility)
   - `bun --filter @exoproc/simulate lint`
   - If errors occur, fix them — max 3 iterations. If still failing, report to the user.
5. **Close**: Brief summary + affected files + command outputs. End with `NEXT_ACTION` line for cross-cutting work.

## Known pitfalls

- The simulated process is parked with `EB FE` (jmp $); thread redirection depends on `nthread`. Changes to `win64-machine.ts` can break this contract — verify backward compatibility.
- `runtime/bun-ffi.ts` is the browser mock FFI layer — it bridges `bun:ffi` calls to Node/browser. After any change, check whether `apps/docs` lab is affected.
- The C-subset compiler runs through the `cc-shim`. Adding a new platform requires more than just `bin/dll/*`; `bundler.ts` section layout must also be updated.
- `inspect-artifacts.ts` depends on the Capstone disassembler; coordinate with the capstone package when adding new architecture/format support.
- `src/runtime/types.ts` changes ripple through every runtime module — keep them minimal.

## Cross-boundary connections to remember

- `apps/docs/src/components/lab/Win64Debugger.tsx` → consumer of `x64-cpu.ts` + `win64-machine.ts`. On any breaking public API change, **always** hand off to frontend-agent.
- `apps/docs/src/components/lab/debugger/DisassemblyView.tsx` → depends on the `capstone` package. If Capstone behavior changes on the simulate side, notify the frontend agent.
- `apps/docs/src/components/lab/debugger/ScannerPanel.tsx` → consumer of `memory-scanner.ts`.
- `apps/docs/src/components/lab/WebOSSimulationLab.tsx` → consumer of `win64-machine` + `programs` (scheduler).

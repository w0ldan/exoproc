# Contributing to Exoproc

Thank you for your interest in contributing to Exoproc! This guide will help you set up your development environment, understand the project architecture, and submit contributions.

---

## 1. Prerequisites & Development Setup

Exoproc is a monorepo built using **Bun workspaces**, targeting native **Windows x64** environments.

### System Requirements

- **Windows x64**
- **Bun version >= 1.4.4** (Bun 1.4+ provides native multi-core TypeScript type checking via `bun check` and native formatting via `bun fmt`).

### Initializing the Repository

1. Clone the repository:

   ```bash
   git clone https://github.com/w0ldan/exoproc.git
   cd exoproc
   ```

2. Install dependencies:
   ```bash
   bun install
   ```
   _Note: This automatically triggers a postinstall hook (`exoproc-utils deps`) to download and verify required native binaries (`capstone.dll`, ECJ compiler JARs, Tiny-Remapper JAR) into the local cache with SHA-256 validation._

---

## 2. Development Commands

### Building Packages

```bash
bun run build         # Build all packages and generate .d.ts declaration files
bun run build:clean   # Clean artifacts first, then build
```

### Testing

```bash
bun test              # Run unit and integration tests
```

### Code Quality & Formatting

```bash
bun run typecheck     # Type check all packages and test suites (bun check)
bun run lint          # Run linter
bun run format        # Format codebase with native bun fmt
bun run format:check  # Check formatting without modifying files
```

### Managing Binary Dependencies

```bash
bun run deps          # Check status and download missing binary dependencies
bun run deps:force    # Re-download and re-verify all binary dependencies
```

### Versioning

```bash
bun run bump:changed  # Independently bump versions for changed packages only
```

---

## 3. Architecture Overview

The repository consists of modular packages designed for low-level systems programming and AI process instrumentation:

- **Core FFI & Memory Access (`bun-xffi`, `win32-abi`, `bun-winapi`)**: Low-level C-ABI type system, Win32 handle abstractions, pointer arithmetic, and composable memory accessor chains.
- **Thread Hijacking (`bun-nthread`)**: Windows x64 thread context redirection via stub allocation without `CreateRemoteThread`.
- **Function Redirection (`bun-minhook`)**: 5-byte JMP relative detours, instruction relocation, trampoline allocation, and far-detour relays.
- **Shared Memory & Process Spawning (`bun-nshm`)**: High-throughput shared memory IPC and de-elevated process spawning.
- **JVM Instrumentation (`exoproc-jjit`, `bun-njava`, `njava-agent`, `exoproc-mappings`)**: In-memory Java bytecode compilation (ECJ), Tiny-Remapper integration, dynamic Nashorn proxies, and JNI reflection.
- **MCP Server & CLI (`packages/exoproc-mcp`, `packages/exoproc`)**: 22-tool Model Context Protocol server over stdio and unified CLI runner (`exoproc setup`, `doctor`, `mcp`, `ps`, `exec`).

---

## 4. Contributing Guidelines

### Pull Request Process

1. Create a feature branch from `main`:
   ```bash
   git checkout -b feat/my-new-feature
   ```
2. Implement your changes following existing code style.
3. Ensure all quality checks pass:
   ```bash
   bun run typecheck
   bun run format:check
   bun test
   ```
4. Commit your changes with a conventional commit message.
5. Open a pull request against `main`.

### Commit Guidelines

We use **Conventional Commits** enforced by Husky and commitlint.

Format: `<type>(<scope>): <short description>`

**Allowed scopes:**

- `xffi`, `accessors`, `winapi`, `capstone`, `nthread`, `minhook`, `nshm`, `dummy`, `utils`, `exoproc`, `deps`, `workspace`

**Examples:**

- `feat(minhook): support far detour relays beyond 2GB`
- `fix(nthread): adjust alignment offset on stack argument passing`
- `chore(workspace): bump changed package versions`

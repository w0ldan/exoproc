# Exoproc

> **Native Windows x64 Reverse Engineering & Process Instrumentation**  
> One unified CLI and Model Context Protocol (MCP) server for thread hijacking, function detours, live memory manipulation, and C-to-shellcode compilation.

[![npm version](https://img.shields.io/npm/v/exoproc?style=flat-square&color=cb3837)](https://www.npmjs.com/package/exoproc)
[![MCP Catalog](https://img.shields.io/badge/MCP-22_tools-5c4ee5?style=flat-square)](https://github.com/w0ldan/exoproc)
[![Bun Requirements](https://img.shields.io/badge/Bun-%3E%3D1.4.4-339933?style=flat-square&logo=bun&logoColor=white)](https://bun.sh)
[![License: MIT](https://img.shields.io/badge/license-MIT-f4c430?style=flat-square)](LICENSE)

---

## Instant Setup for AI Agents

Exoproc connects your AI coding agents (**Claude Code, Cursor, Windsurf, Claude Desktop, Antigravity, Cline, OpenCode, Zed**) directly to live Windows x64 processes.

### 1. Via Node.js (`npx`)

```bash
npx -y exoproc setup --yes
```

### 2. Via Bun (`bun x`)

```bash
bun x exoproc setup --yes
```

### 3. Windows Automated Installer (PowerShell)

```cmd
powershell -c "irm https://exoproc.woldan.me/install.ps1|iex"
```

### 4. Standalone Windows x64 Binary (`exoproc.exe`)

Download `exoproc.exe` directly from [GitHub Releases](https://github.com/w0ldan/exoproc/releases/latest) with zero dependencies:

```cmd
exoproc.exe setup --yes
```

The wizard automatically discovers installed agents on your machine, writes portable stdio MCP configurations with automatic backups, and installs tailored agent instructions and skills.

Restart your agent, and all 22 MCP tools will be immediately available.

---

## CLI Commands

Exoproc provides a unified terminal command-line tool:

```bash
# Configuration & Health Check
exoproc setup                      # Configure AI agents with MCP & skills
exoproc doctor                     # Diagnostics & agent configuration status

# Model Context Protocol (MCP) Server
exoproc mcp                        # Launch stdio MCP server

# Process & Window Diagnostics
exoproc ps                         # Enumerate running processes
exoproc windows                    # Enumerate desktop windows and edit controls
exoproc screenshot [screen.png]    # Capture desktop or window PNG screenshot

# Live Compilation & Execution
exoproc compile -s "code"          # JIT-compile C snippet into x86_64 shellcode
exoproc exec "code" --pid <pid>    # Execute C-style Win32 code in target process
exoproc run script.ts              # Execute standalone automation script
```

---

## MCP Tools (22 Tools)

Exoproc exposes 21 high-performance tools over standard Model Context Protocol (stdio):

- **Process Discovery & Session:** `list_processes`, `spawn_process`, `open_accessor`, `close_accessor`
- **Memory Manipulation:** `read_memory`, `write_memory`, `scan_pattern`, `allocate_memory`
- **Function Detours & Thread Redirection:** `minhook_install`, `minhook_remove`, `list_hooks`, `nthread_call`
- **C JIT Compilation & Machine Code:** `compile_c`, `compile_shellcode`, `disassemble`
- **Win32 Execution & Desktop Tools:** `execute_code`, `execute_local_code`, `execute_command`, `list_windows`, `take_screenshot`, `jvm_inspect_jar`

---

## Supported Agents

- **Claude Code:** `~/.claude.json` + `~/.claude/skills/exoproc/`
- **Cursor:** `~/.cursor/mcp.json` + `~/.cursor/rules/exoproc.mdc`
- **Windsurf:** `~/.codeium/windsurf/mcp_config.json`
- **Claude Desktop:** `claude_desktop_config.json`
- **Antigravity / Gemini:** `~/.gemini/antigravity/mcp_config.json`
- **VS Code Cline:** `cline_mcp_settings.json`
- **OpenCode:** `~/.config/opencode/opencode.json`
- **Zed:** `~/.config/zed/settings.json`

---

## License

[MIT](LICENSE) © Serkan

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const DEFAULT_SKILL_CONTENT = `---
name: exoproc
description: >-
  Native Windows x64 reverse engineering, thread hijacking (nthread), function redirection (minhook 5-byte detour), memory inspection, live Win32 code execution, remote desktop inspection, and JVM analysis via the Exoproc MCP Server.
---

# Exoproc MCP Server Guide

Exoproc is a dedicated **Model Context Protocol (MCP)** server for native Windows x64 reverse engineering, thread hijacking (\`nthread\`), function redirection (\`minhook\`), live process instrumentation, and remote desktop inspection.

> **Important Rule for AI Agents:** When asked to automate, inspect, or instrument a live process (e.g., typing into Notepad, reading/writing memory, calling Win32 APIs, or hooking functions), **use the Exoproc MCP tools directly**. Do **not** search the workspace repository source code unless explicitly asked to modify Exoproc itself.

---

## 1. Single Active Accessor Session Lifecycle (Mandatory Workflow)

The MCP server maintains **at most ONE active accessor session** at any time.

### The Required 3-Step Lifecycle:
\`\`\`
1. list_processes / list_windows  --> Find target PID
2. open_accessor({ pid })          --> Opens the single active session (returns sessionId)
3. execute_code / read_memory / ...--> Operates on the active session
4. close_accessor({})              --> Restores target thread execution and closes session
\`\`\`

- **\`open_accessor({ pid: number })\` is mandatory:** \`execute_code\` and memory tools will NOT automatically open an accessor for you. You must explicitly open the session first.
- **Single active session:** Only 1 process can be attached at a time. If you attempt to call \`open_accessor\` while a session is already active, it will return an error instructing you to call \`close_accessor\` first.
- **Convenience in subsequent calls:** Once \`open_accessor\` is called, tools like \`execute_code({ code: ... })\`, \`read_memory(...)\`, \`write_memory(...)\`, etc. automatically operate on the currently active session — you do not even need to pass \`session\` on every call.
- **Clean exit:** Always call \`close_accessor({})\` when you are done with your task.

---

## 2. C-Style Win32 Code Execution (\`execute_code\` & \`execute_local_code\`)

Inside \`execute_code\`, write real Win32 C code as if \`<windows.h>\` were already included at the top:

### Pre-Included Globally in Scope:
1. **All Win32 \`#define\` Constants:**
   - Window messages: \`WM_SETTEXT\`, \`WM_GETTEXT\`, \`WM_CHAR\`, \`WM_KEYDOWN\`, \`WM_KEYUP\`, \`WM_COMMAND\`, \`WM_CLOSE\`, etc.
   - Edit & Button messages: \`EM_SETSEL\`, \`EM_REPLACESEL\`, \`EM_GETSEL\`, \`BM_CLICK\`, etc.
   - Virtual keys: \`VK_RETURN\`, \`VK_ESCAPE\`, \`VK_SPACE\`, \`VK_BACK\`, \`VK_TAB\`, etc.
2. **All Win32 Structs:**
   - \`RECT\`, \`POINT\`, \`SIZE\`, \`MSG\`, \`WNDCLASSEXW\`, \`MEMORY_BASIC_INFORMATION\`, etc.
3. **C-Style Types & Buffer Out-Parameters:**
   - **\`WCHAR(256)\`** / **\`new WCHAR(256)\`**: Wide string buffer (UTF-16LE) with \`.text\`.
   - **\`CHAR(256)\`** / **\`new CHAR(256)\`**: ANSI string buffer (UTF-8) with \`.text\`.
   - **Scalar Out-Parameters:** \`DWORD()\`, \`INT()\`, \`UINT()\`, \`BOOL()\`, \`HWND()\`. Read via \`.value\` or \`+val\`.
4. **All Win32 API Functions:**
   - \`SendMessage\`, \`PostMessage\`, \`FindWindow\`, \`FindWindowEx\`, \`GetWindowRect\`, \`SetWindowText\`, \`GetWindowText\`, \`VirtualAlloc\`, \`VirtualProtect\`, \`VirtualFree\`, \`malloc\`, \`free\`, etc.

---

## 3. MCP Tool Catalog

- **\`list_processes\`**: Discover running processes.
- **\`spawn_process\`**: Launch an executable application.
- **\`open_accessor\`**: Attach to a target process and start active session.
- **\`close_accessor\`**: Detach and close active session.
- **\`execute_code\`**: Run C-style Win32 code inside the attached target.
- **\`execute_local_code\`**: Run C-style Win32 code locally in the runner.
- **\`read_memory\`**: Read memory bytes (returns hex, ascii, u32, u64).
- **\`write_memory\`**: Write hex bytes to target memory.
- **\`scan_pattern\`**: AOB pattern search with \`?\` wildcards.
- **\`allocate_memory\`**: Allocate virtual memory inside target.
- **\`minhook_install\`**: Install 5-byte relative JMP trampoline detour hook.
- **\`minhook_remove\`**: Remove minhook and restore original function prologue.
- **\`list_hooks\`**: List active hooks.
- **\`nthread_call\`**: Call function via thread context redirection without CreateRemoteThread.
- **\`compile_c\` / \`compile_shellcode\`**: Compile C code into standalone x86_64 machine code / shellcode.
- **\`disassemble\`**: Disassemble machine code bytes into assembly instructions.
- **\`simulate_run\`**: Offline virtual x86_64 CPU simulation.
- **\`list_windows\`**: Enumerate visible desktop windows and child edit controls.
- **\`take_screenshot\`**: Capture PNG screenshot of desktop or window.
- **\`jvm_inspect_jar\`**: Inspect JAR archive classes and packages.
`;

export function getSkillContent(): string {
  // Try loading from repo skill if present
  const candidates = [
    join(process.cwd(), '.agents', 'skills', 'exoproc', 'SKILL.md'),
    join(process.cwd(), '..', '..', '.agents', 'skills', 'exoproc', 'SKILL.md'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) {
      try {
        return readFileSync(c, 'utf8');
      } catch {}
    }
  }
  return DEFAULT_SKILL_CONTENT;
}

export function installSkills(paths: string[], dryRun = false): string[] {
  const content = getSkillContent();
  const installed: string[] = [];
  for (const targetPath of paths) {
    try {
      if (!dryRun) {
        const dir = dirname(targetPath);
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }
        writeFileSync(targetPath, content, 'utf8');
      }
      installed.push(targetPath);
    } catch (err) {
      console.error(`Failed to install skill to ${targetPath}:`, err);
    }
  }
  return installed;
}

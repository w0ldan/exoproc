---
name: exoproc
description: >-
  Native Windows x64 reverse engineering, thread hijacking (nthread), function redirection (minhook 5-byte detour), memory inspection, live Win32 code execution, remote desktop inspection, and JVM analysis via the Exoproc MCP Server.
---

# Exoproc MCP Server Guide

Exoproc is a dedicated **Model Context Protocol (MCP)** server for native Windows x64 reverse engineering, thread hijacking (`nthread`), function redirection (`minhook`), live process instrumentation, and remote desktop inspection.

> **Important Rule for AI Agents:** When asked to automate, inspect, or instrument a live process (e.g., typing into Notepad, reading/writing memory, calling Win32 APIs, or hooking functions), **use the Exoproc MCP tools directly**. Do **not** search the workspace repository source code unless explicitly asked to modify Exoproc itself.

---

## 1. Single Active Accessor Session Lifecycle (Mandatory Workflow)

The MCP server maintains **at most ONE active accessor session** at any time.

### The Required 3-Step Lifecycle:

```
1. list_processes / list_windows  --> Find target PID
2. open_accessor({ pid })          --> Opens the single active session (returns sessionId)
3. execute_code / read_memory / ...--> Operates on the active session
4. close_accessor({})              --> Restores target thread execution and closes session
```

- **`open_accessor({ pid: number })` is mandatory:** `execute_code` and memory tools will NOT automatically open an accessor for you. You must explicitly open the session first.
- **Single active session:** Only 1 process can be attached at a time. If you attempt to call `open_accessor` while a session is already active, it will return an error instructing you to call `close_accessor` first.
- **Convenience in subsequent calls:** Once `open_accessor` is called, tools like `execute_code({ code: ... })`, `read_memory(...)`, `write_memory(...)`, etc. automatically operate on the currently active session — you do not even need to pass `session` on every call (though passing `sessionId` or `pid` is also accepted and validated).
- **Clean exit:** Always call `close_accessor({})` when you are done with your task to restore target process threads back to user mode.

---

## 2. C-Style Win32 Code Execution (`execute_code` & `execute_local_code`)

Inside `execute_code`, write real Win32 C code as if `<windows.h>` were already included at the top:

### Pre-Included Globally in Scope:

1. **All Win32 `#define` Constants:**
   - Window messages: `WM_SETTEXT`, `WM_GETTEXT`, `WM_GETTEXTLENGTH`, `WM_CHAR`, `WM_KEYDOWN`, `WM_KEYUP`, `WM_COMMAND`, `WM_CLOSE`, `WM_PAINT`, `WM_LBUTTONDOWN`, `WM_LBUTTONUP`, `WM_COPYDATA`, etc.
   - Edit & Button messages: `EM_SETSEL`, `EM_REPLACESEL`, `EM_GETSEL`, `BM_CLICK`, `BM_GETCHECK`, `BM_SETCHECK`, etc.
   - Virtual keys: `VK_RETURN`, `VK_ESCAPE`, `VK_SPACE`, `VK_BACK`, `VK_TAB`, `VK_SHIFT`, `VK_CONTROL`, `VK_LEFT`, `VK_UP`, `VK_RIGHT`, `VK_DOWN`, `VK_F1`..`VK_F12`, etc.
   - Window & memory flags: `SW_SHOW`, `SW_HIDE`, `SW_RESTORE`, `WS_VISIBLE`, `WS_CHILD`, `MEM_COMMIT`, `MEM_RESERVE`, `MEM_RELEASE`, `PAGE_READWRITE`, `PAGE_EXECUTE_READWRITE`, `PROCESS_ALL_ACCESS`, `NULL`, `TRUE`, `FALSE`.
2. **All Win32 Structs (with Automatic Remote Marshalling & Write-Back):**
   - `RECT`, `POINT`, `SIZE`, `MSG`, `PAINTSTRUCT`, `WNDCLASSEXW`, `MEMORY_BASIC_INFORMATION`, `SECURITY_ATTRIBUTES`, `STARTUPINFO`, `PROCESS_INFORMATION`, etc.
   - When passing `const rc = new RECT(); await GetWindowRect(HWND, rc);` or a `Buffer`, Exoproc marshals it to the target process and copies the modified out-parameter bytes back into your local struct automatically!
3. **All C Macros & Type Cast Helpers:**
   - Macros: `RGB(r, g, b)`, `LOWORD(l)`, `HIWORD(l)`, `LOBYTE(w)`, `HIBYTE(w)`, `MAKELPARAM(low, high)`, `MAKEWPARAM(low, high)`, `MAKELONG(a, b)`, `MAKEWORD(a, b)`.
   - Casts: `HWND(v)`, `HANDLE(v)`, `DWORD(v)`, `LPARAM(v)`, `WPARAM(v)`, `LPVOID(v)`, `TEXT("str")`, `L("wide")`, `sizeof(RECT)`.
4. **C-Style Types & Buffer Out-Parameters (No manual Buffer/encoding math!):**
   - **`WCHAR(256)`** / **`new WCHAR(256)`** / **`WCHAR[256]`**: Wide character string buffer (UTF-16LE). Exposes `.text`, `.toString()`, `.capacity`, `.byteLength`. Marshalled and read back automatically!
   - **`CHAR(256)`** / **`new CHAR(256)`** / **`CHAR[256]`**: ANSI character string buffer (UTF-8). Exposes `.text`, `.toString()`.
   - **`STRING(256)`** / **`StringBuffer(256)`**: Automatically selects wide/ANSI based on Unicode preference.
   - **`Buffer.prototype.text`**: Raw buffers also have `.text` that auto-decodes UTF-16LE / UTF-8 up to null-terminator.
   - **Scalar Out-Parameters:** `DWORD()`, `INT()`, `UINT()`, `BOOL()`, `WORD()`, `SHORT()`, `INT64()`, `UINT64()`, `HWND()`. Calling with no arguments (e.g. `const pid = DWORD();`) allocates an out-parameter buffer. Read via `pid.value` or `+pid`. Calling with an argument (e.g. `DWORD(0x1000)`) acts as a standard C cast.
5. **All Win32 API Functions:**
   - `SendMessage`, `PostMessage`, `FindWindow`, `FindWindowEx`, `GetWindowRect`, `GetClientRect`, `SetWindowText`, `GetWindowText`, `ShowWindow`, `SetForegroundWindow`, `VirtualAlloc`, `VirtualProtect`, `VirtualFree`, `malloc`, `free`, `memcpy`, `memset`, `GetDC`, `ReleaseDC`, `GetWindowThreadProcessId`, etc.
6. **Target Context Handles:**
   - `PID`: Target process ID
   - `TID`: Hijacked target thread ID
   - `HWND`: Primary top-level window handle of target process (0 if none)
   - `EDIT_HWND`: Detected inner `Edit` control handle (0 if none)
   - `WINDOWS`: Array of detected window objects for the target process
   - `pumpMessages(count?)`: Flushes GUI message queue (`PeekMessageW` -> `DispatchMessageW`)

---

## 3. Example: Interacting with Notepad

```json
// Step 1: Find PID
// Tool: list_processes
{ "filter": "notepad" }

// Step 2: Open session (MANDATORY)
// Tool: open_accessor
{ "pid": 356 }

// Step 3: Write C-style Win32 code
// Tool: execute_code
{
  "code": "const edit = EDIT_HWND || FindWindowEx(HWND, 0, 'Edit', null);\nawait SendMessage(edit, WM_SETTEXT, 0, 'Woldan');\n\nconst buf = WCHAR(256);\nawait SendMessage(edit, WM_GETTEXT, 256, buf);\n\nconst rc = new RECT();\nawait GetWindowRect(HWND, rc);\nreturn { text: buf.text, rect: rc };"
}

// Step 4: Close session and restore thread
// Tool: close_accessor
{}
```

---

## 4. Available MCP Tools Reference (22 Tools)

### Process Discovery & Launching

- **`list_processes`**: List all running processes with `pid` and `name` (`filter?`).
- **`spawn_process`**: Launch an executable on the target system (`command`, `args?`, `detached?`, `cwd?`) and return its `pid`.
- **`execute_command`**: Run a shell command and return `{ stdout, stderr, exitCode }`.

### Accessor Session Management

- **`open_accessor`**: Attach to a target process (`pid`, `sharedMemory?`, `savePath?`, `njava?`). Opens the single active session.
- **`close_accessor`**: Close the active session (`session?`), restore target thread execution / hooks, and remove session files.

### Live Code Execution

- **`execute_code`**: Execute C-style Win32 code inside the active target session (`code`, `session?`, `unicode?`, `timeoutMs?`).
- **`execute_local_code`**: Execute C-style Win32 code locally in the MCP host runner (`code`, `unicode?`, `timeoutMs?`).

### Memory Inspection & Manipulation

- **`read_memory`**: Read memory bytes from target process (`address`, `size`, `session?`). Returns hex, ascii, uint32, and uint64.
- **`write_memory`**: Write hex byte sequence to target process (`address`, `hex`, `session?`).
- **`scan_pattern`**: Scan target process memory for an AOB pattern with `?` wildcards (`pattern`, `address?`, `size?`, `session?`).
- **`allocate_memory`**: Allocate virtual memory in target process (`size`, `protect?`, `session?`).

### Function Redirection & Detours (minhook)

- **`minhook_install`**: Install a 5-byte `JMP rel32` trampoline detour hook (`targetAddress`, `detourAddress`, `session?`). Requires `open_accessor`.
- **`minhook_remove`**: Remove an active `minhook` and restore original prologue (`targetAddress`, `session?`).
- **`list_hooks`**: List all active hooks. Hooks remain active across accessor open/close cycles until explicitly removed.

### Thread Context Redirection

- **`nthread_call`**: Execute a native function address via thread redirection (`address`, `threadId?`, `args?`, `returnType?`, `session?`).

### Remote Desktop & Window Inspection

- **`list_windows`**: List visible desktop windows with `hwnd`, child `editHwnd` (if any), `title`, `pid`, `tid`, `className`, and `rect`.
- **`take_screenshot`**: Capture a PNG screenshot of the desktop or a specific window (`pid?`, `hwnd?`, `title?`, `windowTitle?`, `outputPath?`).

### C Compilation & Shellcode Generation

- **`compile_c`**: Compile C source code into standalone relocatable x86_64 machine code / shellcode bytes using TinyCC JIT compiler, with automatic Win32 symbol resolution and optional Capstone disassembly (`code`, `returns?`, `args?`, `preamble?`, `disassemble?`, `baseAddress?`, `entry?`, `inject?`, `session?`).
- **`compile_shellcode`**: Alias for `compile_c` with identical schema and functionality.

### Disassembly & JVM

- **`disassemble`**: Disassemble machine code bytes into x86_64 assembly instructions (`bytesHex`, `address?`).
- **`jvm_inspect_jar`**: Inspect packages and classes inside a `.jar` archive (`jarPath`, `filter?`).

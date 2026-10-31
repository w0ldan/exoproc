import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import pkg from '../package.json' with { type: 'json' };
import {
  openAccessor,
  closeAccessor,
  listProcesses,
  readMemory,
  writeMemory,
  scanPattern,
  allocateMemory,
  listHooks,
  installMinHook,
  removeMinHook,
  nthreadCall,
  disassembleBytes,
  compileC,
  inspectJar,
  executeCode,
  executeLocalCode,
  listWindows,
  takeScreenshot,
  spawnProcess,
  executeCommand,
} from './tools/index.js';

export const textResponse = (data: unknown) => ({
  content: [
    {
      type: 'text' as const,
      text:
        typeof data === 'string'
          ? data
          : JSON.stringify(
              data,
              (_k, v) => (typeof v === 'bigint' ? `0x${v.toString(16)}` : v),
              2,
            ),
    },
  ],
});

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'exoproc-mcp',
    version: pkg.version || '0.6.3',
  });

  const register = (
    name: string,
    description: string,
    schema: Record<string, z.ZodTypeAny>,
    handler: (args: any) => Promise<any>,
  ) => {
    (server as any).tool(name, description, schema, async (args: any) => {
      const res = await handler(args);
      return textResponse(res);
    });
  };

  // 1. Process Discovery
  register(
    'list_processes',
    'List all running processes with their PID and executable name.',
    {},
    async () => {
      const processes = await listProcesses();
      return { count: processes.length, processes };
    },
  );

  register(
    'spawn_process',
    'Launch a process or executable application on the target system (e.g. "notepad.exe", "calc.exe", "cmd.exe"). Returns spawned process PID for immediate hooking, memory inspection, or UI automation.',
    {
      command: z
        .string()
        .optional()
        .describe(
          'Command or binary path to launch (e.g. "notepad.exe", "calc.exe")',
        ),
      executable: z
        .string()
        .optional()
        .describe('Alias for command (e.g. "notepad.exe")'),
      path: z
        .string()
        .optional()
        .describe('Alias for command (e.g. "notepad.exe")'),
      args: z
        .array(z.string())
        .optional()
        .describe('Optional command-line arguments'),
      detached: z
        .boolean()
        .optional()
        .describe(
          'Whether to run process detached in background (default: true)',
        ),
      cwd: z.string().optional().describe('Optional working directory'),
    },
    async (args) => await spawnProcess(args),
  );

  register(
    'execute_command',
    'Execute a shell command on the target system and capture stdout, stderr, and exit code.',
    {
      command: z
        .string()
        .describe(
          'Shell command to execute (e.g. "dir", "ipconfig", "echo test")',
        ),
      timeoutMs: z
        .number()
        .optional()
        .describe('Command execution timeout in milliseconds (default: 15000)'),
      cwd: z
        .string()
        .optional()
        .describe('Optional working directory for command execution'),
    },
    async (args) => await executeCommand(args),
  );

  // 2. Accessor Session Lifecycle
  register(
    'open_accessor',
    'Open an accessor session attached to a target process (by PID). The MCP server supports exactly ONE active accessor session at a time. All subsequent tools (execute_code, read_memory, write_memory, scan_pattern, hooks, etc.) will operate on this active session until close_accessor is called.',
    {
      pid: z
        .number()
        .describe(
          'Target process ID to attach to (use list_processes or list_windows to find PID)',
        ),
      sharedMemory: z
        .boolean()
        .optional()
        .describe(
          'Whether to use shared memory channel if available (default: false)',
        ),
      savePath: z
        .string()
        .optional()
        .describe(
          'Custom path to save the session JSON file (defaults to /tmp/exoproc-session-<pid>.json)',
        ),
      njava: z
        .union([z.boolean(), z.enum(['auto', 'stealth'])])
        .optional()
        .describe(
          'Whether to attach Java/JVM reflection support (default: false)',
        ),
    },
    async (args) => await openAccessor(args as any),
  );

  register(
    'close_accessor',
    'Close the currently active accessor session, restore target thread execution / hooks, and clean up the session file.',
    {
      session: z
        .union([z.string(), z.number()])
        .optional()
        .describe(
          'Optional session identifier or PID (defaults to currently active session)',
        ),
    },
    async (args) => await closeAccessor(args),
  );

  // 3. Memory Inspection & Manipulation
  register(
    'read_memory',
    'Read memory bytes, string, or integers from target process at specified virtual address.',
    {
      session: z
        .string()
        .describe(
          'Active accessor sessionId, session file path, or target PID',
        ),
      address: z
        .string()
        .describe('Virtual address in hex (e.g. "0x7ff7a1230000")'),
      size: z.number().describe('Number of bytes to read'),
    },
    async (args) => await readMemory(args),
  );

  register(
    'write_memory',
    'Write byte sequence to target process memory at specified virtual address.',
    {
      session: z
        .string()
        .describe(
          'Active accessor sessionId, session file path, or target PID',
        ),
      address: z
        .string()
        .describe('Virtual address in hex (e.g. "0x7ff7a1230000")'),
      hex: z
        .string()
        .describe('Hex bytes to write (e.g. "90 90 90" or "909090")'),
    },
    async (args) => await writeMemory(args),
  );

  register(
    'scan_pattern',
    'Scan target process memory for an AOB / byte pattern with optional wildcards (e.g. "48 89 5c 24 ? 48 89").',
    {
      session: z
        .string()
        .describe(
          'Active accessor sessionId, session file path, or target PID',
        ),
      pattern: z
        .string()
        .describe(
          'AOB pattern string with space-separated hex bytes and ? wildcards',
        ),
    },
    async (args) => await scanPattern(args),
  );

  register(
    'allocate_memory',
    'Allocate virtual memory inside target process.',
    {
      session: z
        .string()
        .describe(
          'Active accessor sessionId, session file path, or target PID',
        ),
      size: z.number().describe('Size in bytes to allocate'),
      protect: z
        .number()
        .optional()
        .describe(
          'Memory protection flag (defaults to PAGE_EXECUTE_READWRITE)',
        ),
    },
    async (args) => await allocateMemory(args),
  );

  // 4. minhook (5-byte trampoline detour)
  register('list_hooks', 'List all active minhook instances.', {}, async () =>
    listHooks(),
  );

  register(
    'minhook_install',
    'Install a 5-byte JMP relative trampoline detour hook across process boundaries. Requires an active accessor session (open_accessor).',
    {
      session: z
        .string()
        .optional()
        .describe(
          'Active accessor sessionId or session file path (defaults to currently active session)',
        ),
      targetAddress: z.string().describe('Target function virtual address'),
      detourAddress: z
        .string()
        .describe('Detour function virtual address to redirect execution to'),
    },
    async (args) => await installMinHook(args),
  );

  register(
    'minhook_remove',
    'Remove an active 5-byte minhook and restore target function prologue. Requires an active accessor session (open_accessor).',
    {
      session: z
        .string()
        .optional()
        .describe(
          'Active accessor sessionId or session file path (defaults to currently active session)',
        ),
      targetAddress: z.string().describe('Target function virtual address'),
    },
    async (args) => await removeMinHook(args),
  );

  // 6. nthread Context Redirection
  register(
    'nthread_call',
    'Execute a function call inside target process by suspending and redirecting a live thread without CreateRemoteThread.',
    {
      session: z
        .union([z.string(), z.number()])
        .optional()
        .describe(
          'Target process identifier: PID, sessionId, process name (e.g. "notepad"), or session file path',
        ),
      pid: z
        .number()
        .optional()
        .describe('Optional target process ID (alias for session)'),
      address: z
        .union([z.string(), z.number()])
        .optional()
        .describe(
          'Target function virtual address, "module.dll!FuncName", or symbol name (e.g. "GetCurrentProcessId")',
        ),
      moduleName: z
        .string()
        .optional()
        .describe('Optional DLL name (e.g. "kernel32.dll", "user32.dll")'),
      functionName: z
        .string()
        .optional()
        .describe(
          'Optional exported function name (e.g. "GetCurrentProcessId")',
        ),
      threadId: z
        .number()
        .optional()
        .describe('Optional specific thread ID to hijack'),
      args: z
        .array(z.union([z.number(), z.string()]))
        .optional()
        .describe('Call arguments (pointers, integers)'),
      returnType: z
        .string()
        .optional()
        .describe('Return type (default: "ptr")'),
    },
    async (args) => await nthreadCall(args),
  );

  register(
    'execute_code',
    'Execute C-style Win32 / JavaScript / TypeScript code inside the currently active target process session (must call open_accessor first). All Win32 `#define` constants (`WM_SETTEXT`, `WM_GETTEXT`, `WM_GETTEXTLENGTH`, `WM_CHAR`, `WM_KEYDOWN`, `EM_SETSEL`, `EM_REPLACESEL`, `BM_CLICK`, `VK_RETURN`, `MEM_COMMIT`, `PAGE_READWRITE`, `NULL`, `TRUE`, `FALSE`, etc.), structs (`RECT`, `POINT`, `SIZE`, `MSG`, `WNDCLASSEXW`, `MEMORY_BASIC_INFORMATION`), macros (`RGB`, `LOWORD`, `HIWORD`, `MAKELPARAM`, `TEXT`, `L`), Win32 functions (`SendMessage`, `PostMessage`, `FindWindow`, `FindWindowEx`, `GetWindowRect`, `SetWindowText`, `VirtualAlloc`, `VirtualProtect`, `VirtualFree`, `malloc`, `free`, etc.), target identifiers (`PID`, `TID`, `HWND`, `EDIT_HWND`, `WINDOWS`), `pumpMessages`, `memory`, and `Java` are globally in scope. Strings, Buffers, and `new RECT()` / `new MSG()` structs are marshalled (and written back) automatically.',
    {
      session: z
        .union([z.string(), z.number()])
        .optional()
        .describe(
          'Optional active sessionId or PID (defaults to the currently active session opened via open_accessor)',
        ),
      pid: z
        .number()
        .optional()
        .describe('Optional target process ID (alias for session)'),
      target: z
        .union([z.string(), z.number()])
        .optional()
        .describe(
          'Optional target process PID or sessionId (alias for session)',
        ),
      code: z
        .string()
        .describe(
          'C-style Win32 / TypeScript code body to execute (e.g. `const edit = EDIT_HWND || FindWindowEx(HWND, 0, "Edit", null); await SendMessage(edit, WM_SETTEXT, 0, "Woldan");`)',
        ),
      unicode: z
        .boolean()
        .optional()
        .describe(
          'Prefer Unicode (W) over ANSI (A) for dual functions (default: true)',
        ),
      timeoutMs: z
        .number()
        .optional()
        .describe('Execution timeout in milliseconds (default: 15000)'),
    },
    async (args) => await executeCode(args),
  );

  register(
    'execute_local_code',
    'Execute C-style Win32 / JavaScript / TypeScript code directly within the local runner process with all Win32 `#define` constants (`WM_SETTEXT`, `WM_CHAR`, `VK_RETURN`, etc.), structs (`RECT`, `POINT`, `MSG`, etc.), macros (`RGB`, `LOWORD`, `HIWORD`, `MAKELPARAM`), and Win32 API functions (`FindWindow`, `FindWindowEx`, `SendMessage`, `PostMessage`, `GetWindowRect`, etc.) globally in scope.',
    {
      code: z
        .string()
        .describe('C-style Win32 / TypeScript code body to evaluate locally'),
      unicode: z
        .boolean()
        .optional()
        .describe(
          'Prefer Unicode (W) over ANSI (A) for dual functions (default: true)',
        ),
      timeoutMs: z
        .number()
        .optional()
        .describe('Execution timeout in milliseconds (default: 15000)'),
    },
    async (args) => await executeLocalCode(args),
  );

  // 6. C Compilation & Disassembly
  register(
    'disassemble',
    'Disassemble x86_64 machine code bytes into instructions with mnemonics, operands, and offsets.',
    {
      bytesHex: z
        .string()
        .describe('Hex string of machine code bytes to disassemble'),
      address: z
        .string()
        .optional()
        .describe('Base virtual address (default: "0x1000")'),
    },
    async (args) => await disassembleBytes(args),
  );

  const compileCSchema = {
    code: z
      .string()
      .describe(
        'C source code to compile into standalone x86_64 machine code / shellcode. Can be a function body (e.g. "return arg0 * 2;") or full C function(s).',
      ),
    returns: z
      .string()
      .optional()
      .describe(
        'Return type (e.g. "int", "void", "ptr", "u64", "i32", default: "int")',
      ),
    args: z
      .array(z.string())
      .optional()
      .describe('Argument types list (e.g. ["int", "ptr"], default: [])'),
    preamble: z
      .string()
      .optional()
      .describe(
        'Optional C preamble (additional headers, defines, or struct declarations)',
      ),
    disassemble: z
      .boolean()
      .optional()
      .describe(
        'Whether to disassemble the resulting machine code with Capstone (default: true)',
      ),
    baseAddress: z
      .string()
      .optional()
      .describe('Base virtual address for disassembly (default: "0x1000")'),
    entry: z
      .string()
      .optional()
      .describe('Entry function name if multiple functions are defined'),
    inject: z
      .boolean()
      .optional()
      .describe(
        'If true and an active session is open, allocates and writes the compiled shellcode into the target process memory (default: false)',
      ),
    session: z
      .string()
      .optional()
      .describe(
        'Target accessor session ID for injection (optional, defaults to single active session)',
      ),
  };

  register(
    'compile_c',
    'Compile C source code into relocatable x86_64 machine code / shellcode bytes using TinyCC JIT compiler, with automatic Win32 symbol resolution and optional Capstone disassembly.',
    compileCSchema,
    async (args) => await compileC(args),
  );

  register(
    'compile_shellcode',
    'Compile C source code into relocatable x86_64 shellcode / machine code bytes using TinyCC JIT compiler, with automatic Win32 symbol resolution and optional Capstone disassembly.',
    compileCSchema,
    async (args) => await compileC(args),
  );

  // 7. JVM Jar Inspection
  register(
    'jvm_inspect_jar',
    'Fast in-memory enumeration of classes and packages inside any .jar archive without running Java.',
    {
      jarPath: z.string().describe('Absolute path to .jar file'),
      filter: z
        .string()
        .optional()
        .describe('Optional regex or substring filter for class names'),
    },
    async (args) => await inspectJar(args),
  );

  // 8. Remote Desktop & Window Management
  register(
    'list_windows',
    'List top-level windows on the desktop with HWND, inner editHwnd (if any), title, process ID, thread ID, className, and coordinates.',
    {
      processFilter: z
        .string()
        .optional()
        .describe(
          'Optional substring filter by window title or className (e.g. "notepad")',
        ),
      includeSystemWindows: z
        .boolean()
        .optional()
        .describe('Include hidden system IME windows (default: false)'),
    },
    async (args) => {
      const windows = await listWindows(args);
      return {
        count: windows.length,
        windows,
      };
    },
  );

  register(
    'take_screenshot',
    'Capture a PNG screenshot of the remote desktop or a specific target window (by PID, HWND, or title). Returns file path and base64 PNG data.',
    {
      pid: z
        .number()
        .optional()
        .describe('Optional target process ID to capture window of'),
      hwnd: z.string().optional().describe('Optional window HWND to capture'),
      title: z
        .string()
        .optional()
        .describe('Optional window title / className substring to capture'),
      outputPath: z
        .string()
        .optional()
        .describe('Optional local file path to save PNG image to'),
      savePath: z
        .string()
        .optional()
        .describe(
          'Alias for outputPath: optional local file path to save PNG image to',
        ),
    },
    async (args) =>
      await takeScreenshot({
        ...args,
        outputPath: args.outputPath ?? args.savePath,
      }),
  );

  return server;
}
